import type { CardStatement, StatementLine } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { paidCountText, statementCover } from './statement-cover';
import { statementTotals } from './statement-totals';

// Invented figures and names throughout.
let next = 0;
const line = (over: Partial<StatementLine> & { owedMinor: number; statementOn: string }): StatementLine => {
  next += 1;
  const id = over.transactionId ?? `t${next}`;
  return {
    key: id,
    transactionId: id,
    occurredOn: over.statementOn,
    postedOn: null,
    description: id,
    cardId: null,
    countedMinor: over.owedMinor,
    instalment: null,
    convertedTo: null,
    spending: over.owedMinor > 0,
    originalCurrency: null,
    originalAmountMinor: null,
    paidBy: null,
    settles: 0,
    paidOff: false,
    balancing: false,
    ...over,
  };
};

const buy = (transactionId: string, statementOn: string, owedMinor: number, over: Partial<StatementLine> = {}) => line({ transactionId, statementOn, owedMinor, ...over });
const pay = (transactionId: string, statementOn: string, amountMinor: number, over: Partial<StatementLine> = {}) => line({ transactionId, statementOn, owedMinor: -amountMinor, spending: false, ...over });

/** A statement as the ledger reads it: the figures follow from the lines, the way `cardStatement` adds them. */
function statement(input: { lines: StatementLine[]; later?: StatementLine[]; openingMinor?: number; closed: boolean; hidden?: StatementLine[] }): CardStatement {
  const counted = [...input.lines, ...(input.hidden ?? [])];
  const chargesMinor = counted.filter((l) => l.countedMinor > 0).reduce((s, l) => s + l.countedMinor, 0);
  const creditsMinor = -counted.filter((l) => l.countedMinor < 0).reduce((s, l) => s + l.countedMinor, 0);
  const openingMinor = input.openingMinor ?? 0;
  const closingMinor = openingMinor + chargesMinor - creditsMinor;
  const paidSinceMinor = input.closed ? -(input.later ?? []).reduce((s, l) => s + l.countedMinor, 0) : 0;
  return {
    cycle: { start: '2026-09-21', end: '2026-10-20' },
    currency: 'IDR',
    openingMinor,
    chargesMinor,
    creditsMinor,
    closingMinor,
    lines: input.lines,
    closed: input.closed,
    paidSinceMinor,
    leftToPayMinor: input.closed ? Math.max(0, closingMinor - paidSinceMinor) : null,
    laterCredits: input.closed ? (input.later ?? []) : [],
  };
}

const four = () => [buy('market', '2026-10-02', 412_000), buy('ride', '2026-10-03', 185_000), buy('shop', '2026-10-04', 649_000), buy('dinner', '2026-10-06', 280_000)];

describe('which purchases a statement’s payments cover', () => {
  it('a statement paid in full with Pay shows every purchase covered, by that payment', () => {
    const s = statement({ closed: true, lines: four(), later: [pay('lump', '2026-11-10', 1_526_000)] });
    expect(statementTotals(s).totalMinor - statementTotals(s).paidMinor).toBe(0);
    const cover = statementCover(s);
    for (const key of ['market', 'ride', 'shop', 'dinner']) expect(cover.get(key)).toMatchObject({ whole: true, by: { transactionId: 'lump' } });
  });

  it('a part payment covers the oldest first, and the rest of the bill is what the rows say is left', () => {
    const s = statement({ closed: true, lines: four(), later: [pay('lump', '2026-11-10', 600_000)] });
    const cover = statementCover(s);
    expect(cover.get('market')!.whole).toBe(true);
    expect(cover.get('ride')!.whole).toBe(true);
    expect(cover.get('shop')).toMatchObject({ whole: false, coveredMinor: 3_000, leftMinor: 646_000 });
    expect(cover.get('dinner')).toMatchObject({ whole: false, coveredMinor: 0, leftMinor: 280_000 });
    const left = [...cover.values()].reduce((sum, c) => sum + c.leftMinor, 0);
    expect(left).toBe(statementTotals(s).leftMinor);
  });

  it('a purchase paid one by one keeps its own payment, which covers nothing else', () => {
    const lines = [
      buy('market', '2026-10-02', 412_000),
      buy('ride', '2026-10-03', 185_000, { paidBy: { transactionId: 'own', paidOn: '2026-10-05' } }),
      pay('own', '2026-10-05', 185_000, { settles: 1 }),
      buy('shop', '2026-10-04', 649_000),
      buy('dinner', '2026-10-06', 280_000),
    ];
    const cover = statementCover(statement({ closed: true, lines, later: [pay('lump', '2026-11-10', 1_061_000)] }));
    expect(cover.has('ride')).toBe(false);
    expect(cover.get('market')).toMatchObject({ whole: true, by: { transactionId: 'lump' } });
    expect(cover.get('shop')).toMatchObject({ whole: true, by: { transactionId: 'lump' } });
    expect(cover.get('dinner')).toMatchObject({ whole: false, leftMinor: 280_000 });
  });

  it('after a part-covered purchase is paid for what was left, the rest still matches the bill', () => {
    // Rp 600.000 by Pay, then Shop's Rp 646.000 paid one by one.
    const lines = [...four().map((l) => (l.transactionId === 'shop' ? { ...l, paidBy: { transactionId: 'own', paidOn: '2026-11-12' } } : l))];
    const s = statement({ closed: true, lines, later: [pay('lump', '2026-11-10', 600_000), pay('own', '2026-11-12', 646_000, { settles: 1 })] });
    const cover = statementCover(s);
    expect(cover.get('market')!.whole).toBe(true);
    expect(cover.get('ride')!.whole).toBe(true);
    expect(cover.get('dinner')).toMatchObject({ whole: false, leftMinor: 280_000 });
    expect(statementTotals(s).leftMinor).toBe(280_000);
  });

  it('on an open statement, a payment clears the previous bill first and only what is over covers this cycle', () => {
    const s = statement({ closed: false, openingMinor: 500_000, lines: [...four(), pay('lump', '2026-10-10', 1_100_000)] });
    const cover = statementCover(s);
    expect(cover.get('market')).toMatchObject({ whole: true, by: { transactionId: 'lump' } });
    expect(cover.get('ride')).toMatchObject({ whole: true });
    expect(cover.get('shop')).toMatchObject({ coveredMinor: 3_000, leftMinor: 646_000 });
    expect([...cover.values()].reduce((sum, c) => sum + c.leftMinor, 0)).toBe(statementTotals(s).unbilledLeftMinor);
  });

  it('money back covers purchases as a payment does, since it takes as much off the bill', () => {
    const s = statement({ closed: true, lines: [...four(), buy('refund', '2026-10-08', -280_000)], later: [pay('lump', '2026-11-10', 1_246_000)] });
    const cover = statementCover(s);
    expect([...cover.values()].every((c) => c.whole)).toBe(true);
    expect(statementTotals(s).leftMinor).toBe(0);
  });

  it('a refund marked settled before the app covers nothing: its balancing charge took its money', () => {
    const refund = buy('refund', '2026-10-08', -100_000, { paidOff: true });
    const balancing = line({ transactionId: 'balancing', statementOn: '2026-10-08', owedMinor: 100_000, balancing: true, spending: false });
    const cover = statementCover(statement({ closed: true, lines: [buy('market', '2026-10-02', 412_000), refund], hidden: [balancing] }));
    expect(cover.get('market')).toMatchObject({ whole: false, coveredMinor: 0, leftMinor: 412_000 });
  });

  it('a purchase marked paid off before the app is skipped, its balancing credit spent on it', () => {
    const settled = buy('old', '2026-10-01', 100_000, { paidOff: true });
    const balancing = line({ transactionId: 'balancing', statementOn: '2026-10-01', owedMinor: -100_000, balancing: true, spending: false });
    const cover = statementCover(statement({ closed: true, lines: [settled, buy('market', '2026-10-02', 412_000)], hidden: [balancing] }));
    expect(cover.has('old')).toBe(false);
    expect(cover.get('market')).toMatchObject({ coveredMinor: 0 });
  });

  it('nothing is covered until a payment is made, and deleting it takes the cover away again', () => {
    const cover = statementCover(statement({ closed: true, lines: four() }));
    expect([...cover.values()].every((c) => c.coveredMinor === 0 && c.by === null)).toBe(true);
  });

  it('whenever the bill is down to nothing, every purchase shows paid', () => {
    // Many shapes of the same story: some paid one by one, some lump payments in the cycle and after, an older bill.
    for (let seed = 1; seed <= 200; seed += 1) {
      let r = seed;
      const rand = (n: number) => {
        r = (r * 1_103_515_245 + 12_345) % 2_147_483_648;
        return r % n;
      };
      const closed = rand(2) === 0;
      const openingMinor = rand(3) === 0 ? 0 : rand(5) * 100_000;
      const purchases = Array.from({ length: 1 + rand(6) }, (_, i) => buy(`p${seed}-${i}`, `2026-10-${String(1 + rand(19)).padStart(2, '0')}`, (1 + rand(50)) * 10_000));
      const lines: StatementLine[] = [];
      let owed = openingMinor;
      for (const p of purchases) {
        if (rand(3) === 0) {
          lines.push({ ...p, paidBy: { transactionId: `own-${p.key}`, paidOn: '2026-10-19' } }, pay(`own-${p.key}`, '2026-10-19', p.owedMinor, { settles: 1 }));
        } else {
          lines.push(p);
          owed += p.owedMinor;
        }
      }
      // Pay whatever is still owed in one or two lumps, in the cycle or after it.
      const first = rand(owed + 1);
      const credits = [pay(`lump-a${seed}`, closed ? '2026-11-01' : '2026-10-19', first), pay(`lump-b${seed}`, closed ? '2026-11-05' : '2026-10-20', owed - first)].filter((l) => l.owedMinor < 0);
      const s = closed ? statement({ closed, openingMinor, lines, later: credits }) : statement({ closed, openingMinor, lines: [...lines, ...credits] });
      const t = statementTotals(s);
      expect(t.totalMinor - (t.closed ? t.paidMinor : 0)).toBe(0);
      const cover = statementCover(s);
      for (const l of s.lines.filter((x) => x.countedMinor > 0)) expect(l.paidBy !== null || cover.get(l.key)?.whole).toBe(true);
    }
  });
});

describe('the count beside a statement’s heading', () => {
  it('says All paid when every purchase is ticked either way, otherwise how many of them', () => {
    expect(paidCountText(4, 4)).toBe('All paid');
    expect(paidCountText(2, 4)).toBe('2 of 4 paid');
    expect(paidCountText(0, 3)).toBe('0 of 3 paid');
    expect(paidCountText(0, 0)).toBeNull();
  });
});
