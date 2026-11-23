import type { StatementLine } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { earnRateText, statementRowsNote } from './card-desk-v1';
import type { LineCover } from './statement-cover';

/* Invented figures and names. */
const line = (key: string, owedMinor: number, extra: Partial<StatementLine> = {}): StatementLine => ({
  key,
  transactionId: key,
  occurredOn: '2026-08-02',
  postedOn: null,
  statementOn: '2026-08-02',
  description: key,
  cardId: null,
  owedMinor,
  countedMinor: owedMinor,
  instalment: null,
  convertedTo: null,
  spending: true,
  originalCurrency: null,
  originalAmountMinor: null,
  paidBy: null,
  settles: 0,
  paidOff: false,
  balancing: false,
  ...extra,
});
const covered = (key: string): [string, LineCover] => [key, { coveredMinor: 1, leftMinor: 0, whole: true, by: null, creditCount: 1 }];

describe('the statement table note', () => {
  it('counts every row drawn and the charges that show paid: covered whole, paid one by one, or paid off', () => {
    const lines = [
      line('pasar', 318_000),
      line('ojek', 47_500, {
        paidBy: { transactionId: 'p1', paidOn: '2026-08-05' },
      }),
      line('toko', 702_000),
      line('lama', 90_000, { paidOff: true }),
      line('payment', -200_000, { spending: false }),
    ];
    expect(statementRowsNote(lines, new Map([covered('pasar')]), false)).toBe('5 rows · 3 paid');
  });

  it('counts a settled fee row and its money back as paid, as their ✓ says', () => {
    const lines = [line('fee', 0, { countedMinor: 0, feeSettled: true }), line('back', -800_000, { feeSettled: true }), line('kopi', 42_000)];
    expect(statementRowsNote(lines, new Map(), false)).toBe('3 rows · 2 paid');
  });

  it('says the rows alone for all statements, and for a statement with no charges', () => {
    expect(statementRowsNote([line('a', 10_000), line('b', 20_000)], new Map([covered('a')]), true)).toBe('2 rows');
    expect(statementRowsNote([line('payment', -50_000, { spending: false })], new Map(), false)).toBe('1 row');
    expect(statementRowsNote([], new Map(), false)).toBe('0 rows');
  });
});

describe('the earn rate', () => {
  const rule = (over: Partial<Parameters<typeof earnRateText>[0][number]> = {}) => ({
    priority: 0,
    stackable: false,
    match: {},
    rateNum: 1,
    rateDen: 4_000,
    ...over,
  });

  it('prints the rule that earns on every purchase as spend = 1 unit', () => {
    expect(earnRateText([rule()], 'miles', 'IDR')).toMatch(/^Rp\s4\.000 = 1 mile$/);
    expect(earnRateText([rule({ rateDen: 2_500 })], 'points', 'IDR')).toMatch(/^Rp\s2\.500 = 1 point$/);
  });

  it('takes the lowest-priority catch-all over a category rule or a stackable bonus', () => {
    const rules = [
      rule({
        priority: 10,
        match: { categoryIds: ['dining'] },
        rateDen: 1_000,
      }),
      rule({ priority: 5, stackable: true, rateDen: 500 }),
      rule({ priority: 1, rateDen: 5_000 }),
      rule({ priority: 0, rateNum: 2, rateDen: 5_000 }),
    ];
    expect(earnRateText(rules, 'points', 'IDR')).toMatch(/^2 points per Rp\s5\.000$/);
  });

  it('is nothing for cashback, or when every rule picks purchases out', () => {
    expect(earnRateText([rule()], 'cashback', 'IDR')).toBeNull();
    expect(earnRateText([rule({ match: { merchantPatterns: ['grab'] } })], 'miles', 'IDR')).toBeNull();
    expect(earnRateText([], 'miles', 'IDR')).toBeNull();
  });
});
