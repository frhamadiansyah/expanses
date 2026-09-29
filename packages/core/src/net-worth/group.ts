/**
 * The net-worth group and its filing mode (spec §6). State is derived, never stored: every device
 * replays the same `Proposal` and `Answer` log and arrives at the same `GroupState`.
 */
export type FilingMode = 'joint' | 'separate';

export interface Proposal {
  proposalId: string;
  mode: FilingMode;
  members: string[];
  proposedBy: string;
  createdHlc: string;
  cancelled: boolean;
}

export interface Answer {
  proposalId: string;
  memberId: string;
  answer: 'confirm' | 'decline' | 'left';
}

export interface GroupState {
  active: { proposalId: string; mode: FilingMode; members: string[] } | null;
  pending: Proposal | null;
  waitingFor: string[];
}

/** `joint` needs exactly two distinct members; any mode needs at least two distinct members. */
export function canPropose(mode: FilingMode, members: readonly string[]): boolean {
  const distinct = new Set(members).size;
  if (distinct !== members.length) return false;
  if (distinct < 2) return false;
  if (mode === 'joint' && distinct !== 2) return false;
  return true;
}

/** The final answer recorded for each (proposalId, memberId) pair — last writer wins. */
function finalAnswers(answers: readonly Answer[]): Map<string, Answer> {
  const byKey = new Map<string, Answer>();
  for (const ans of answers) byKey.set(`${ans.proposalId}\u0000${ans.memberId}`, ans);
  return byKey;
}

function answerFor(final: Map<string, Answer>, proposalId: string, memberId: string): Answer['answer'] | undefined {
  return final.get(`${proposalId}\u0000${memberId}`)?.answer;
}

/**
 * Whether a proposal is activated by these answers (the last per member wins): not cancelled, `canPropose`, and every
 * listed member confirmed or left. Once so, only `left` may follow it (task 2 review).
 */
export function isActivated(proposal: Proposal, answers: readonly Answer[]): boolean {
  return activatedBy(proposal, finalAnswers(answers));
}

/** A proposal is activated when not cancelled, `canPropose`, and every listed member confirmed or left. */
function activatedBy(proposal: Proposal, final: Map<string, Answer>): boolean {
  if (proposal.cancelled) return false;
  if (!canPropose(proposal.mode, proposal.members)) return false;
  return proposal.members.every((member) => {
    const ans = answerFor(final, proposal.proposalId, member);
    return ans === 'confirm' || ans === 'left';
  });
}

export function deriveGroup(proposals: readonly Proposal[], answers: readonly Answer[]): GroupState {
  const final = finalAnswers(answers);
  const sorted = [...proposals].sort((a, b) => (a.createdHlc < b.createdHlc ? -1 : a.createdHlc > b.createdHlc ? 1 : 0));

  let active: Proposal | null = null;
  for (const proposal of sorted) {
    if (activatedBy(proposal, final)) active = proposal;
  }

  let activeState: GroupState['active'] = null;
  if (active) {
    const members = active.members.filter((member) => answerFor(final, active!.proposalId, member) !== 'left');
    if (members.length >= 2) {
      activeState = { proposalId: active.proposalId, mode: active.mode, members };
    }
  }

  const activeHlc = active?.createdHlc ?? null;
  let pending: Proposal | null = null;
  for (const proposal of sorted) {
    if (proposal.cancelled) continue;
    if (activeHlc !== null && !(proposal.createdHlc > activeHlc)) continue;
    if (activatedBy(proposal, final)) continue;
    const declined = proposal.members.some((member) => answerFor(final, proposal.proposalId, member) === 'decline');
    if (declined) continue;
    if (!pending || proposal.createdHlc > pending.createdHlc) pending = proposal;
  }

  const waitingFor = pending
    ? pending.members.filter((member) => answerFor(final, pending!.proposalId, member) === undefined)
    : [];

  return { active: activeState, pending, waitingFor };
}
