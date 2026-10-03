import type { CheckDraftRow, PreparedCheck } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { canRecordAll, missingByDay, needsCategory, recordLabel, statementMonth, summaryOf, takenByOthers, unchosenTied } from './check-model';

let next = 0;
function row(patch: Partial<CheckDraftRow> & Pick<CheckDraftRow, 'outcome'>): CheckDraftRow {
  const index = patch.index ?? next++;
  return {
    on: '2026-05-06',
    postedOn: null,
    description: 'KURASU KISSATEN',
    amountMinor: 100,
    direction: 'out',
    isFee: false,
    image: 0,
    categoryId: null,
    categorySource: null,
    ...patch,
    index,
  };
}
const missing = (patch: Partial<CheckDraftRow> = {}) => row({ outcome: { row: 0, status: 'missing', as: 'purchase' }, ...patch });
const matched = (patch: Partial<CheckDraftRow> = {}) => row({ outcome: { row: 0, status: 'matched', candidateIds: ['t1'] }, ...patch });

function prepared(patch: Partial<PreparedCheck>): PreparedCheck {
  return {
    cardAccountId: 'card',
    period: { start: '2026-05-11', end: '2026-06-10' },
    currency: 'IDR',
    rows: [],
    flagged: [],
    closingMinor: null,
    previousMinor: null,
    emptyImages: [],
    untrackedPaymentsMinor: 0,
    untrackedPaymentsCount: 0,
    cardBalanceAtEndMinor: 0,
    startsAfterPeriod: false,
    alreadyChecked: false,
    today: '2026-06-15',
    ...patch,
  };
}

describe('summaryOf', () => {
  it('counts each outcome, the flagged and the payments not tracked', () => {
    const p = prepared({
      rows: [
        matched(),
        matched(),
        row({ outcome: { row: 2, status: 'differs', candidateId: 't9', statementMinor: 105, recordedMinor: 100 } }),
        missing(),
        row({ outcome: { row: 4, status: 'payment-untracked' }, direction: 'in' }),
        row({ outcome: { row: 5, status: 'ask', candidateIds: ['a', 'b'] } }),
      ],
      flagged: [{ transactionId: 'x', on: '2026-05-20', description: 'Bakmi', amountMinor: 85 }],
      untrackedPaymentsCount: 1,
      untrackedPaymentsMinor: 500,
    });
    expect(summaryOf(p).counts).toEqual({ matched: 2, differs: 1, missing: 1, flagged: 1, payments: 1, ask: 1 });
  });

  it('says there is nothing to compare without the summary', () => {
    expect(summaryOf(prepared({ rows: [missing()] })).headline).toEqual({ kind: 'no-summary' });
  });

  it('is reconciled when the statement and the card agree', () => {
    expect(summaryOf(prepared({ closingMinor: 1000, cardBalanceAtEndMinor: 1000 })).headline).toEqual({ kind: 'reconciled' });
  });

  it('blames the missing rows when recording them (and the payments line) closes the gap', () => {
    const p = prepared({
      rows: [missing({ amountMinor: 300 }), missing({ amountMinor: 200 }), missing({ amountMinor: 50, direction: 'in', outcome: { row: 2, status: 'missing', as: 'refund' } })],
      closingMinor: 1000,
      cardBalanceAtEndMinor: 1100,
      untrackedPaymentsMinor: 550,
      untrackedPaymentsCount: 1,
    });
    // 1000 − 1100 = −100; recording adds 300 + 200 − 50 and the payments line takes 550: −100.
    expect(summaryOf(p).headline).toEqual({ kind: 'differs', differenceMinor: -100, likely: 'the 3 missing rows' });
  });

  it('blames a flagged transaction when its amount is what is left', () => {
    const p = prepared({
      rows: [missing({ amountMinor: 300 })],
      flagged: [
        { transactionId: 'x', on: '2026-05-20', description: 'Bakmi', amountMinor: 70 },
        { transactionId: 'y', on: '2026-05-21', description: 'Coffee', amountMinor: 85 },
      ],
      closingMinor: 1300,
      cardBalanceAtEndMinor: 1085,
    });
    expect(summaryOf(p).headline).toEqual({ kind: 'differs', differenceMinor: 215, likely: 'a flagged transaction' });
  });

  it('otherwise says rows were not matched', () => {
    const p = prepared({ rows: [missing({ amountMinor: 300 })], closingMinor: 2000, cardBalanceAtEndMinor: 1000 });
    expect(summaryOf(p).headline).toEqual({ kind: 'differs', differenceMinor: 1000, likely: 'rows not matched' });
  });

  it('names the payments when they alone close the gap', () => {
    const p = prepared({ closingMinor: 500, cardBalanceAtEndMinor: 1000, untrackedPaymentsMinor: 500, untrackedPaymentsCount: 2 });
    expect(summaryOf(p).headline).toEqual({ kind: 'differs', differenceMinor: -500, likely: 'the payments not tracked' });
  });
});

describe('canRecordAll', () => {
  it('waits for every missing row needing a category', () => {
    expect(canRecordAll([missing({ categoryId: 'food' }), missing()], {})).toBe(false);
    expect(canRecordAll([missing({ categoryId: 'food' }), missing({ categoryId: 'fees' })], {})).toBe(true);
  });

  it('never waits on a card payment, which needs no category', () => {
    expect(canRecordAll([row({ outcome: { row: 0, status: 'missing', as: 'payment' }, direction: 'in' })], {})).toBe(true);
  });

  it('waits for every ask to be answered with one of its own candidates, each taken once', () => {
    const a = row({ index: 10, outcome: { row: 10, status: 'ask', candidateIds: ['t1', 't2'] } });
    const b = row({ index: 11, outcome: { row: 11, status: 'ask', candidateIds: ['t1', 't2'] } });
    expect(canRecordAll([a, b], { 10: 't1' })).toBe(false);
    expect(canRecordAll([a, b], { 10: 't1', 11: 'zz' })).toBe(false);
    expect(canRecordAll([a, b], { 10: 't1', 11: 't1' })).toBe(false);
    expect(canRecordAll([a, b], { 10: 't1', 11: 't2' })).toBe(true);
  });
});

describe('asks', () => {
  const a = row({ index: 20, outcome: { row: 20, status: 'ask', candidateIds: ['t1', 't2', 't3'] } });
  const b = row({ index: 21, outcome: { row: 21, status: 'ask', candidateIds: ['t1', 't2', 't3'] } });

  it('disables a candidate another row already chose', () => {
    expect(takenByOthers([a, b], { 20: 't1' }, 21)).toEqual(new Set(['t1']));
    expect(takenByOthers([a, b], { 20: 't1' }, 20)).toEqual(new Set());
  });

  it('lists the tied candidates nobody chose', () => {
    expect(unchosenTied([a, b], { 20: 't1', 21: 't3' })).toEqual(['t2']);
    expect(unchosenTied([a, b], {})).toEqual(['t1', 't2', 't3']);
  });
});

describe('missingByDay', () => {
  it('groups the missing rows by day in statement order, with what each day came to', () => {
    const rows = [
      missing({ index: 0, on: '2026-05-06', amountMinor: 127 }),
      matched({ index: 1, on: '2026-05-06' }),
      missing({ index: 2, on: '2026-05-06', amountMinor: 113 }),
      missing({ index: 3, on: '2026-05-24', amountMinor: 50, direction: 'in', outcome: { row: 3, status: 'missing', as: 'refund' } }),
      missing({ index: 4, on: '2026-05-24', amountMinor: 108 }),
    ];
    const days = missingByDay(rows);
    expect(days.map((d) => [d.date, d.rows.map((r) => r.index), d.net])).toEqual([
      ['2026-05-06', [0, 2], -240],
      ['2026-05-24', [3, 4], -58],
    ]);
  });
});

describe('copy', () => {
  it('labels Record all with what still needs a category', () => {
    expect(recordLabel(9, 0)).toBe('Record all 9');
    expect(recordLabel(9, 1)).toBe('Record all 9 · 1 still needs a category');
    expect(recordLabel(9, 3)).toBe('Record all 9 · 3 still need a category');
  });

  it('names a statement by the month it starts in', () => {
    expect(statementMonth({ start: '2026-05-11', end: '2026-06-10' })).toBe('May');
  });

  it('knows which rows want a category', () => {
    expect(needsCategory(missing())).toBe(true);
    expect(needsCategory(row({ outcome: { row: 0, status: 'missing', as: 'payment' } }))).toBe(false);
    expect(needsCategory(matched())).toBe(false);
  });
});
