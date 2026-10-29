import { evaluateAmount } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { addPart, assignment, assignmentLine, barShares, editAmount, hasRest, removePart, restIndex, settleRest, splitTotal } from './split-rest';
import type { SplitRow } from './tx-form';

const row = (categoryId: string, amount: string, extra: Partial<SplitRow> = {}): SplitRow => ({ categoryId, amount, ...extra });
const plain = (text: string | null) => text?.replace(/\u00a0/g, ' ') ?? null;
const minors = (rows: readonly SplitRow[], currency: string) => rows.map((r) => (r.amount === '0' ? 0 : r.amount ? evaluateAmount(r.amount, currency) : null));
const edited = (r: ReturnType<typeof editAmount>): SplitRow[] => {
  if ('refusal' in r) throw new Error(`refused: ${r.refusal}`);
  return r.splits;
};

describe('the total a split divides', () => {
  it('is the purchase amount when it reads and is more than nothing', () => {
    expect(splitTotal('250.000', 'IDR')).toBe(250_000);
    expect(splitTotal('', 'IDR')).toBeNull();
    expect(splitTotal('0', 'IDR')).toBeNull();
  });
});

describe('the Rest', () => {
  const three = [row('groceries', '120.000'), row('household', '80.000'), row('dining', '50.000')];

  it('is the last part unless one is marked, and is worked out as total less the others', () => {
    expect(restIndex(three)).toBe(2);
    expect(restIndex([row('a', '1', { rest: true }), row('b', '2')])).toBe(0);
    const settled = settleRest([row('a', '120.000'), row('b', '80.000'), row('c', '')], 250_000, 'IDR');
    expect(settled[2]).toMatchObject({ amount: '50.000', rest: true });
    expect(hasRest(settled)).toBe(true);
  });

  it('follows another part: Groceries 120.000 to 150.000 leaves Dining 20.000', () => {
    const next = edited(editAmount(settleRest(three, 250_000, 'IDR'), 0, '150.000', 250_000, 'IDR'));
    expect(minors(next, 'IDR')).toEqual([150_000, 80_000, 20_000]);
    expect(restIndex(next)).toBe(2);
  });

  it('refuses an edit that would take the Rest below nothing, in words, changing nothing', () => {
    const start = settleRest(three, 250_000, 'IDR');
    const refused = editAmount(start, 0, '200.000', 250_000, 'IDR');
    expect('refusal' in refused && plain(refused.refusal)).toBe('Over by Rp 30.000');
    // The edge: exactly the whole of what is left is allowed, and leaves the Rest at nothing.
    expect(minors(edited(editAmount(start, 0, '170.000', 250_000, 'IDR')), 'IDR')).toEqual([170_000, 80_000, 0]);
  });

  it('is fixed by typing into it, and the part before it becomes the Rest', () => {
    const start = settleRest(three, 250_000, 'IDR');
    const next = edited(editAmount(start, 2, '60.000', 250_000, 'IDR'));
    expect(restIndex(next)).toBe(1);
    expect(minors(next, 'IDR')).toEqual([120_000, 70_000, 60_000]);
    expect(next[2]!.rest).toBeUndefined();
    // Then the part that fixed stays put while another changes.
    expect(minors(edited(editAmount(next, 0, '100.000', 250_000, 'IDR')), 'IDR')).toEqual([100_000, 90_000, 60_000]);
  });

  it('fixing the first part, when it is the Rest, hands the Rest to the next', () => {
    const start = settleRest([row('a', '', { rest: true }), row('b', '30.000')], 100_000, 'IDR');
    const next = edited(editAmount(start, 0, '10.000', 100_000, 'IDR'));
    expect(restIndex(next)).toBe(1);
    expect(minors(next, 'IDR')).toEqual([10_000, 90_000]);
  });

  it('refuses a hand-fix too large for what the others leave', () => {
    const start = settleRest(three, 250_000, 'IDR');
    expect(plain((editAmount(start, 2, '140.000', 250_000, 'IDR') as { refusal: string }).refusal)).toBe('Over by Rp 10.000');
  });

  it('takes the figure as typed with no total or a single part', () => {
    expect(edited(editAmount([row('a', ''), row('b', '')], 0, '5', null, 'IDR'))[0]!.amount).toBe('5');
    expect(edited(editAmount([row('a', '')], 0, '5', 100, 'IDR'))[0]!.amount).toBe('5');
  });

  it('leaves the figures alone with no total, and a right figure exactly as typed', () => {
    expect(settleRest(three, null, 'IDR')).toEqual(three);
    const same = settleRest([row('a', '120000'), row('b', '130000')], 250_000, 'IDR');
    expect(same[1]!.amount).toBe('130000');
  });

  it('follows a changed total, and goes empty (Over by) when the total falls below the other parts', () => {
    const start = settleRest(three, 250_000, 'IDR');
    expect(minors(settleRest(start, 300_000, 'IDR'), 'IDR')).toEqual([120_000, 80_000, 100_000]);
    const shrunk = settleRest(start, 150_000, 'IDR');
    expect(shrunk[2]!.amount).toBe('');
    expect(plain(assignmentLine(assignment(shrunk, 150_000, 'IDR'), 'IDR'))).toBe('Over by Rp 50.000');
  });
});

describe('adding and removing parts', () => {
  it('the first split makes two parts, the first carrying the card’s category and figure, the second the Rest', () => {
    const made = addPart([], { categoryId: 'groceries', amount: '250.000' }, false, 250_000, 'IDR');
    expect(made.map((r) => r.categoryId)).toEqual(['groceries', '']);
    expect(minors(made, 'IDR')).toEqual([250_000, 0]);
    expect(restIndex(made)).toBe(1);
  });

  it('without a total the first split is two plain rows', () => {
    const made = addPart([], { categoryId: 'groceries', amount: '' }, false, null, 'IDR');
    expect(made).toEqual([row('groceries', ''), row('', '')]);
  });

  it('a later part is the new Rest; the old Rest keeps its figure', () => {
    const start = settleRest([row('a', '120.000'), row('b', '')], 250_000, 'IDR');
    expect(start[1]!.amount).toBe('130.000');
    const next = addPart(start, { categoryId: '', amount: '' }, false, 250_000, 'IDR');
    expect(minors(next, 'IDR')).toEqual([120_000, 130_000, 0]);
    expect(restIndex(next)).toBe(2);
    expect(next.filter((r) => r.rest)).toHaveLength(1);
    // Lowering the middle part gives the new Rest the difference.
    expect(minors(edited(editAmount(next, 1, '80.000', 250_000, 'IDR')), 'IDR')).toEqual([120_000, 80_000, 50_000]);
  });

  it('a part added to a purchase excluded whole is excluded with the rest', () => {
    expect(addPart([row('a', '1', { excluded: true })], { categoryId: '', amount: '' }, true, null, 'IDR')[1]!.excluded).toBe(true);
  });

  it('removing a fixed part gives its figure to the Rest; removing the Rest makes the last part the Rest', () => {
    const start = settleRest([row('a', '120.000'), row('b', '80.000'), row('c', '')], 250_000, 'IDR');
    expect(minors(removePart(start, 1, 250_000, 'IDR'), 'IDR')).toEqual([120_000, 130_000]);
    const noRest = removePart(start, 2, 250_000, 'IDR');
    expect(minors(noRest, 'IDR')).toEqual([120_000, 130_000]);
    expect(restIndex(noRest)).toBe(1);
  });

  it('removing parts down to one gives that part the whole total, and down to none leaves none', () => {
    const start = settleRest([row('a', '120.000'), row('b', '')], 250_000, 'IDR');
    expect(minors(removePart(start, 0, 250_000, 'IDR'), 'IDR')).toEqual([250_000]);
    expect(removePart([row('a', '5')], 0, 250_000, 'IDR')).toEqual([]);
  });

  it('keeps the Rest where it is when a part before it goes', () => {
    const start = settleRest(edited(editAmount(settleRest([row('a', '100.000'), row('b', '100.000'), row('c', '')], 300_000, 'IDR'), 2, '50.000', 300_000, 'IDR')), 300_000, 'IDR');
    expect(restIndex(start)).toBe(1);
    const next = removePart(start, 0, 300_000, 'IDR');
    expect(restIndex(next)).toBe(0);
    expect(minors(next, 'IDR')).toEqual([250_000, 50_000]);
  });
});

describe('the sum is the total to the minor unit in every currency', () => {
  it('IDR (0 decimals), USD (2) and KWD (3)', () => {
    for (const [currency, total, first, expected] of [
      ['IDR', 250_000, '120.000', 130_000],
      ['USD', 25_050, '100,10', 15_040],
      ['KWD', 12_345, '4,001', 8_344],
    ] as const) {
      const made = settleRest([row('a', first), row('b', '')], total, currency);
      expect(minors(made, currency)).toEqual([evaluateAmount(first, currency), expected]);
      expect(minors(made, currency).reduce<number>((sum, m) => sum + (m ?? 0), 0)).toBe(total);
      // Editing the other way round lands on the same figures.
      const back = edited(editAmount(made, 0, first, total, currency));
      expect(minors(back, currency).reduce<number>((sum, m) => sum + (m ?? 0), 0)).toBe(total);
    }
  });

  it('a three-decimal Rest written back reads back whole (1.234,567 is not 1234567 thousandths misread)', () => {
    const made = settleRest([row('a', '1'), row('b', '')], 1_234_567, 'KWD');
    expect(evaluateAmount(made[1]!.amount, 'KWD')).toBe(1_234_567 - 1_000);
  });
});

describe('the line under the bar', () => {
  it('says all assigned, left, or over, and nothing without a total', () => {
    expect(plain(assignmentLine(assignment([row('a', '100.000'), row('b', '150.000')], 250_000, 'IDR'), 'IDR'))).toBe('All of it assigned');
    expect(plain(assignmentLine(assignment([row('a', '100.000')], 250_000, 'IDR'), 'IDR'))).toBe('Rp 150.000 left to assign');
    expect(plain(assignmentLine(assignment([row('a', '300.000')], 250_000, 'IDR'), 'IDR'))).toBe('Over by Rp 50.000');
    expect(assignmentLine(assignment([row('a', '1')], null, 'IDR'), 'IDR')).toBeNull();
  });

  it('draws each part as its share of the total', () => {
    expect(barShares([row('a', '120.000'), row('b', '80.000'), row('c', '50.000')], 250_000, 'IDR')).toEqual([0.48, 0.32, 0.2]);
    // Over the total, the bar is scaled to what the parts hold, so it never overflows.
    expect(barShares([row('a', '300.000'), row('b', '100.000')], 200_000, 'IDR')).toEqual([0.75, 0.25]);
  });
});
