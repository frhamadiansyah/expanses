import { evaluateAmount } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { addPart, assignment, assignmentLine, barShares, editAmount, editOriginal, hasRest, removePart, restIndex, settleRest, splitTotal } from './split-rest';
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

describe('a split bought in another currency: both figures on every part', () => {
  // An invented hotel bill: USD 120,00 charged Rp 1.944.000 on an IDR card, 16.200 rupiah to the dollar.
  const total = 1_944_000;
  const usd = { currency: 'USD', total: 12_000 };
  const read = (text: string | undefined, currency: string) => (text && /^0(,0+)?$/.test(text) ? 0 : text ? evaluateAmount(text, currency) : null);
  const both = (rows: readonly SplitRow[]) => rows.map((r) => [read(r.amount, 'IDR'), read(r.original, 'USD')]);
  const start = () => addPart([], { categoryId: 'hotel', amount: '120' }, false, total, 'IDR', usd);

  it('starts with part one holding the whole charge in both figures, never the foreign amount read as rupiah', () => {
    expect(both(start())).toEqual([
      [1_944_000, 12_000],
      [0, 0],
    ]);
  });

  it('works out rupiah from a part typed in USD, and the Rest takes what is left in both', () => {
    const next = edited(editOriginal(start(), 0, '80', total, 'IDR', usd));
    expect(both(next)).toEqual([
      [1_296_000, 8_000],
      [648_000, 4_000],
    ]);
    expect(next[0]).toMatchObject({ typedOriginal: true, original: '80' });
    expect(next[1]).toMatchObject({ rest: true });
  });

  it('works out USD from a part typed in rupiah', () => {
    const next = edited(editAmount(start(), 0, '1.296.000', total, 'IDR', usd));
    expect(both(next)).toEqual([
      [1_296_000, 8_000],
      [648_000, 4_000],
    ]);
    expect(next[0]?.typedOriginal).toBeUndefined();
  });

  it('lets the last figure typed win: typing over the worked-out one makes it the typed one', () => {
    const inUsd = edited(editOriginal(start(), 0, '80', total, 'IDR', usd));
    const inRupiah = edited(editAmount(inUsd, 0, '1.300.000', total, 'IDR', usd));
    expect(inRupiah[0]?.typedOriginal).toBeUndefined();
    // 1.300.000 ÷ 16.200 = 80,246… → USD 80,25.
    expect(both(inRupiah)).toEqual([
      [1_300_000, 8_025],
      [644_000, 3_975],
    ]);
  });

  it('takes one part in USD and another in rupiah (mixed), the Rest closing both', () => {
    const three = addPart(start(), { categoryId: '', amount: '' }, false, total, 'IDR', usd);
    const a = edited(editOriginal(three, 0, '50', total, 'IDR', usd));
    const b = edited(editAmount(a, 1, '400.000', total, 'IDR', usd));
    expect(both(b)).toEqual([
      [810_000, 5_000],
      [400_000, 2_469],
      [734_000, 4_531],
    ]);
    const sums = both(b).reduce((s, [r, u]) => [s[0]! + r!, s[1]! + u!], [0, 0]);
    expect(sums).toEqual([1_944_000, 12_000]);
  });

  it('lands rounding on the Rest so the parts add up exactly, at an uneven rate', () => {
    // USD 123,45 charged Rp 2.017.523: 16.342,83… to the dollar.
    const odd = { currency: 'USD', total: 12_345 };
    const parts = addPart(addPart([], { categoryId: 'a', amount: '' }, false, 2_017_523, 'IDR', odd), { categoryId: '', amount: '' }, false, 2_017_523, 'IDR', odd);
    const next = edited(editOriginal(edited(editOriginal(parts, 0, '33.33', 2_017_523, 'IDR', odd)), 1, '33.33', 2_017_523, 'IDR', odd));
    const figures = both(next);
    expect(figures[0]).toEqual(figures[1]);
    expect(figures.reduce((s, [r]) => s + r!, 0)).toBe(2_017_523);
    expect(figures.reduce((s, [, u]) => s + u!, 0)).toBe(12_345);
  });

  it('refuses a USD figure past the whole, in the currency it was typed in', () => {
    const refused = editOriginal(start(), 0, '121', total, 'IDR', usd);
    expect('refusal' in refused && plain(refused.refusal)).toMatch(/^Over by US\$\s?1,00$/);
  });

  it('typing into the Rest fixes it in both, and the part before it becomes the Rest', () => {
    const next = edited(editOriginal(start(), 1, '20', total, 'IDR', usd));
    expect(restIndex(next)).toBe(0);
    expect(both(next)).toEqual([
      [1_620_000, 10_000],
      [324_000, 2_000],
    ]);
  });

  it('reprices parts typed in USD when the charged figure moves, the parts typed in rupiah staying', () => {
    const typed = edited(editOriginal(start(), 0, '80', total, 'IDR', usd));
    expect(both(settleRest(typed, 1_950_000, 'IDR', usd))).toEqual([
      [1_300_000, 8_000],
      [650_000, 4_000],
    ]);
    const inRupiah = edited(editAmount(start(), 0, '1.296.000', total, 'IDR', usd));
    expect(both(settleRest(inRupiah, 1_950_000, 'IDR', usd))).toEqual([
      [1_296_000, 7_975],
      [654_000, 4_025],
    ]);
  });

  it('leaves a settled split as it is (opening the sheet changes nothing)', () => {
    const typed = edited(editOriginal(start(), 0, '80', total, 'IDR', usd));
    expect(settleRest(typed, total, 'IDR', usd)).toEqual(typed);
  });

  it('works the Rest out afresh in both when a part is removed', () => {
    const three = addPart(edited(editOriginal(start(), 0, '80', total, 'IDR', usd)), { categoryId: '', amount: '' }, false, total, 'IDR', usd);
    const typed = edited(editOriginal(three, 1, '10', total, 'IDR', usd));
    expect(both(removePart(typed, 1, total, 'IDR', usd))).toEqual([
      [1_296_000, 8_000],
      [648_000, 4_000],
    ]);
  });
});
