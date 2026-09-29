import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveGroup, type Answer, type FilingMode, type Proposal } from '../src/net-worth/group';

/*
 * Spec §6 `deriveGroup`: every device replays the same `Proposal`/`Answer` log and reaches the same
 * `GroupState`, regardless of the order the rows arrived in (convergence). Random proposals/answers,
 * shuffled, must (a) converge to one result independent of array order, (b) keep `active.members` at
 * >= 2 with `joint` always exactly 2, (c) keep `waitingFor` a subset of `pending.members`.
 */
const RUNS = 300;
const SEED = 20260929;

const memberArb = fc.constantFrom('rina', 'andi', 'sari', 'budi');
const hlcArb = fc.integer({ min: 0, max: 20 }).map((n) => String(n).padStart(3, '0'));
const modeArb: fc.Arbitrary<FilingMode> = fc.constantFrom('joint', 'separate');

const proposalArb: fc.Arbitrary<Proposal> = fc.record({
  proposalId: fc.constantFrom('p1', 'p2', 'p3', 'p4'),
  mode: modeArb,
  members: fc.uniqueArray(memberArb, { minLength: 1, maxLength: 4 }),
  proposedBy: memberArb,
  createdHlc: hlcArb,
  cancelled: fc.boolean(),
});

// Each proposalId names one immutable proposal (created once): a valid input array has at most
// one Proposal per id, so dedupe as fast-check may otherwise draw two different records sharing an id.
const proposalsArb: fc.Arbitrary<Proposal[]> = fc.array(proposalArb, { maxLength: 4 }).map((proposals) => {
  const byId = new Map<string, Proposal>();
  for (const proposal of proposals) byId.set(proposal.proposalId, proposal);
  return [...byId.values()];
});

const answerArb: fc.Arbitrary<Answer> = fc.record({
  proposalId: fc.constantFrom('p1', 'p2', 'p3', 'p4'),
  memberId: memberArb,
  answer: fc.constantFrom('confirm', 'decline', 'left'),
});

// `Answer` carries no ordering field: by the time deriveGroup sees the log, the last writer for
// each (proposalId, memberId) has already been resolved to a single row (see the brief's Note),
// so a valid input array has at most one Answer per pair. Enforce that here.
const answersArb: fc.Arbitrary<Answer[]> = fc
  .array(answerArb, { maxLength: 12 })
  .map((answers) => {
    const byKey = new Map<string, Answer>();
    for (const ans of answers) byKey.set(`${ans.proposalId}\u0000${ans.memberId}`, ans);
    return [...byKey.values()];
  });

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  const rand = () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state / 0xffffffff;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

describe('deriveGroup convergence', () => {
  it(`derives the same state from any order of the same rows (${RUNS} runs)`, () => {
    fc.assert(
      fc.property(
        proposalsArb,
        answersArb,
        fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        (proposals, answers, shuffleSeed) => {
          const base = deriveGroup(proposals, answers);
          const shuffledResult = deriveGroup(shuffled(proposals, shuffleSeed), shuffled(answers, shuffleSeed + 1));
          expect(shuffledResult).toEqual(base);

          if (base.active) {
            expect(base.active.members.length).toBeGreaterThanOrEqual(2);
            if (base.active.mode === 'joint') expect(base.active.members.length).toBe(2);
          }
          if (base.pending) {
            for (const waiting of base.waitingFor) expect(base.pending.members).toContain(waiting);
          } else {
            expect(base.waitingFor).toEqual([]);
          }
        },
      ),
      { numRuns: RUNS, seed: SEED, endOnFailure: true },
    );
  });

  it('two proposals by different members, both fully confirmed: the greater HLC wins on every permutation', () => {
    const p1: Proposal = { proposalId: 'p1', mode: 'joint', members: ['rina', 'andi'], proposedBy: 'rina', createdHlc: '001', cancelled: false };
    const p2: Proposal = { proposalId: 'p2', mode: 'separate', members: ['rina', 'andi', 'sari'], proposedBy: 'sari', createdHlc: '002', cancelled: false };
    const answers: Answer[] = [
      { proposalId: 'p1', memberId: 'rina', answer: 'confirm' },
      { proposalId: 'p1', memberId: 'andi', answer: 'confirm' },
      { proposalId: 'p2', memberId: 'rina', answer: 'confirm' },
      { proposalId: 'p2', memberId: 'andi', answer: 'confirm' },
      { proposalId: 'p2', memberId: 'sari', answer: 'confirm' },
    ];
    const proposalOrders = [
      [p1, p2],
      [p2, p1],
    ];
    for (const proposals of proposalOrders) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const state = deriveGroup(proposals, shuffled(answers, seed));
        expect(state.active).toEqual({ proposalId: 'p2', mode: 'separate', members: ['rina', 'andi', 'sari'] });
        expect(state.pending).toBeNull();
      }
    }
  });
});
