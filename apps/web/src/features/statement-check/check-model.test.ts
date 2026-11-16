import { type AccountRow, type CheckDraftRow, fillSameMerchant, type PreparedCheck } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  canRecordAll,
  plasticChoice,
  corrected,
  isTopUpRow,
  mayBeOnNextStatement,
  missingByDay,
  needsCategory,
  needsWallet,
  originalLabel,
  recordLabel,
  statementMonth,
  summaryOf,
  takenByOthers,
  topUpFigures,
  unchosenTied,
  withOwnCategory,
  withTopUp,
} from './check-model';

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
    needsPreviousBalance: false,
    alreadyChecked: false,
    trackPayments: false,
    today: '2026-06-15',
    instalments: [],
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
    // An instalment row is worked out from its plan: never a recorded transaction to keep or delete.
    const c = row({ index: 22, outcome: { row: 22, status: 'ask', candidateIds: ['t4', 'instalment:p1#2'] } });
    expect(unchosenTied([c], { 22: 't4' })).toEqual([]);
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

describe('mayBeOnNextStatement', () => {
  it('is said of a transaction dated in the last three days of the period, not earlier', () => {
    const period = { start: '2026-05-11', end: '2026-06-10' };
    expect(['2026-06-10', '2026-06-08', '2026-06-07', '2026-06-06', '2026-05-20'].map((on) => mayBeOnNextStatement(on, period))).toEqual([true, true, true, false, false]);
    expect(mayBeOnNextStatement('', period)).toBe(false);
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

describe('originalLabel', () => {
  it('names a foreign row\'s own currency by its code and the amount in it, and nothing for a row without one', () => {
    expect(originalLabel(missing({ original: { currency: 'TRY', amountMinor: 41_200 } }))).toBe('TRY\u00a0412,00');
    expect(originalLabel(missing({ original: { currency: 'USD', amountMinor: 2_040 } }))).toBe('USD\u00a020,40');
    expect(originalLabel(missing({ original: { currency: 'JPY', amountMinor: 1_300 } }))).toBe('JPY\u00a01.300');
    expect(originalLabel(missing())).toBeNull();
  });
});

describe('corrected', () => {
  const foreign = missing({ amountMinor: 140_492, original: { currency: 'TRY', amountMinor: 41_200 } });

  it('drops the original once the owner changes the amount: it no longer multiplies to it', () => {
    const fixed = corrected(foreign, { on: '2026-05-07', amountMinor: 141_000 });
    expect(fixed).toMatchObject({ on: '2026-05-07', amountMinor: 141_000 });
    expect(fixed.original).toBeUndefined();
    expect(foreign.original).toEqual({ currency: 'TRY', amountMinor: 41_200 });
  });

  it('keeps it when only the date is corrected', () => {
    expect(corrected(foreign, { on: '2026-05-07', amountMinor: 140_492 })).toMatchObject({ on: '2026-05-07', original: { currency: 'TRY', amountMinor: 41_200 } });
  });
});

describe('a missing card row under Top-ups', () => {
  const accounts = [
    { id: 'topups', name: 'Top-ups', kind: 'expense', subtype: 'category', currency: null, systemKey: 'miscellaneous.top_ups' },
    { id: 'groceries', name: 'Groceries', kind: 'expense', subtype: 'category', currency: null, systemKey: 'household.groceries' },
  ] as AccountRow[];
  const charge = () => missing({ description: 'WALLET RELOAD 7731', amountMinor: 1_010_000, categoryId: 'topups', categorySource: 'owner' });

  it('is a top-up that waits for its wallet, then records with what lands and the fee making up the row', () => {
    const r = charge();
    expect(isTopUpRow(r, accounts)).toBe(true);
    expect(needsWallet(r, accounts)).toBe(true);
    expect(canRecordAll([r], {}, accounts)).toBe(false);
    const [done] = withTopUp([r], r.index, { walletAccountId: 'gopay', feeMinor: 10_000 });
    expect(needsWallet(done!, accounts)).toBe(false);
    expect(canRecordAll([done!], {}, accounts)).toBe(true);
    expect(topUpFigures(done!)).toEqual({ landsMinor: 1_000_000, feeMinor: 10_000 });
    // The statement's figure is untouched: the card is still charged the whole row.
    expect(done!.amountMinor).toBe(1_010_000);
  });

  it('turns back into a purchase when another category is chosen for it', () => {
    const r = charge();
    const [done] = withTopUp([r], r.index, { walletAccountId: 'gopay', feeMinor: 10_000 });
    const [back] = fillSameMerchant([done!], done!.index, 'groceries');
    expect(back).toMatchObject({ categoryId: 'groceries', topUp: null });
    expect(isTopUpRow(back!, accounts)).toBe(false);
    expect(canRecordAll([back!], {}, accounts)).toBe(true);
  });

  it('leaves money back under Top-ups, and a card payment, as they are', () => {
    expect(isTopUpRow(missing({ categoryId: 'topups', direction: 'in', outcome: { row: 0, status: 'missing', as: 'refund' } }), accounts)).toBe(false);
    expect(isTopUpRow(missing({ categoryId: 'groceries' }), accounts)).toBe(false);
  });

  it('says a wallet is still needed once every category is chosen', () => {
    expect(recordLabel(3, 0, 1)).toBe('Record all 3 · 1 still needs a wallet');
    expect(recordLabel(3, 1, 1)).toBe('Record all 3 · 1 still needs a category');
    expect(recordLabel(3, 0, 0)).toBe('Record all 3');
  });
});

describe('plasticChoice', () => {
  const a = { id: 'a', last4: '1111', isPrimary: false };
  const b = { id: 'b', last4: '2222', isPrimary: true };
  it('lists the primary first and defaults to it', () => {
    const r = plasticChoice([a, b], undefined);
    expect(r.options.map((o) => o.id)).toEqual(['b', 'a']);
    expect(r.chosen).toBe('b');
    expect(r.choosable).toBe(true);
  });
  it('keeps a pick that is still there, and one plastic is not a choice', () => {
    expect(plasticChoice([a, b], 'a').chosen).toBe('a');
    expect(plasticChoice([a, b], 'gone').chosen).toBe('b');
    expect(plasticChoice([b], undefined).choosable).toBe(false);
    expect(plasticChoice([], undefined).chosen).toBeNull();
  });
});

describe('withOwnCategory', () => {
  it('files one row alone, leaving the same merchant\'s other rows as they were, and takes it out of being a top-up', () => {
    const rows = [missing({ index: 70, categoryId: 'food', topUp: { walletAccountId: 'w', feeMinor: 0 } }), missing({ index: 71 })];
    const after = withOwnCategory(rows, 70, 'unc');
    expect(after.map((r) => [r.categoryId, r.categorySource, r.topUp ?? null])).toEqual([
      ['unc', 'owner', null],
      [null, null, null],
    ]);
    expect(canRecordAll(after, {})).toBe(false);
    expect(canRecordAll(withOwnCategory(after, 71, 'unc'), {})).toBe(true);
  });
});
