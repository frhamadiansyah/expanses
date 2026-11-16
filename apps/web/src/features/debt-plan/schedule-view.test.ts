import { instalmentDates, instalmentStanding, type LoanTerms, loanSchedule } from '@expanses/core';
import type { BillMonthRow, CardStatement, LoanPlanFact } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { account, card, kreditFact, loanRow, readings } from './plan-fixtures';
import { planDebts } from './plan-inputs';
import { billPay, cardPay, loanPay } from './pay-target';
import { billCover, type CardMonth, dueItems, dueRow, dueThisMonthCount, type MonthInput, monthItems, monthSections, monthTotals } from './schedule-view';

/**
 * November 2026: the paylater's 4/6 (due 1 Nov) unpaid, BCA Visa's October statement due 18 Nov, Electricity pay-by
 * 20 Nov, and the mortgage's 63/120 paid on 1 Nov from a bank message.
 */
const KPR_TERMS: LoanTerms = { originalMinor: 300_000_000, firstPaymentOn: '2021-09-01', tenorMonths: 120, method: 'annuity', paymentDay: 1 };
const KPR_PERIODS = [{ fromOn: '2021-09-01', rateBps: 750, kind: 'fixed' as const, paymentMinor: 2_480_000 }];

function kprFact(today: string): LoanPlanFact {
  const dues = instalmentDates(KPR_TERMS, '2026-11-01', '2026-11-30');
  return {
    accountId: 'KPR',
    owedMinor: 180_000_000,
    trackFrom: '2026-11-01',
    instalments: instalmentStanding(dues, [{ id: 'k1', occurredOn: '2026-11-01', totalMinor: 2_480_000, fromMessage: true }], today),
    scheduleFrom: '2026-12-01',
    schedule: loanSchedule(180_000_000, KPR_TERMS, KPR_PERIODS, '2026-12-01'),
  };
}

const statement = (closingMinor: number, leftToPayMinor: number | null, closed = true, o: Partial<CardStatement> = {}) =>
  ({
    cycle: { start: '2026-10-01', end: '2026-10-31' },
    currency: 'IDR',
    openingMinor: 0,
    chargesMinor: closingMinor,
    creditsMinor: 0,
    closingMinor,
    lines: [],
    closed,
    paidSinceMinor: leftToPayMinor === null ? 0 : closingMinor - leftToPayMinor,
    leftToPayMinor,
    ...o,
  }) as CardStatement;

const visa = (closingMinor = 6_214_300, left: number | null = 6_214_300): CardMonth => ({ cardId: 'C1', name: 'BCA Visa', currency: 'IDR', dueOn: '2026-11-18', statement: statement(closingMinor, left) });

const electricity = (state: BillMonthRow['state'] = 'open', paid: Partial<BillMonthRow> = {}): BillMonthRow =>
  ({
    month: '2026-11',
    window: { month: '2026-11', opensOn: '2026-11-10', payBy: '2026-11-20' },
    state,
    days: 0,
    paidOn: null,
    paidMinor: null,
    paidCurrency: null,
    chargedMinor: null,
    chargedCurrency: null,
    paymentId: null,
    paidFromAccountId: null,
    payments: [],
    bill: { id: 'B1', name: 'Electricity', categoryAccountId: 'cat', moneyAccountId: 'bank', amountMinor: 780_000, dayOfMonth: 10, active: true, payByDay: 20, startsMonth: '2026-09', currency: null, repeat: 'monthly', repeatMonth: null, repeatEvery: null },
    estimateMinor: 780_000,
    ...paid,
  }) as BillMonthRow;

function input(today: string, o: { kredit?: LoanPlanFact; month?: string; show?: MonthInput['show']; cards?: CardMonth[]; bills?: BillMonthRow[] } = {}): MonthInput {
  const base = readings();
  const r = readings({
    accounts: [...base.accounts.filter((a) => a.id !== 'L2' && a.id !== 'L3'), account({ id: 'KPR', name: 'KPR BCA', subtype: 'loan' })],
    balances: { ...base.balances, KPR: -180_000_000 },
    loans: [loanRow({ accountId: 'L1' }), loanRow({ accountId: 'KPR', lenderName: 'BCA', ...KPR_TERMS, periods: [{ id: 'k', accountId: 'KPR', ...KPR_PERIODS[0]! }] })],
    loanFacts: [o.kredit ?? kreditFact(today), kprFact(today)],
    cards: { C1: card({ billedMinor: 6_214_300, leftToPayMinor: 6_214_300, dueOn: '2026-11-18' }) },
  });
  const debts = planDebts(r, today);
  return {
    month: o.month ?? '2026-11',
    today,
    debts,
    loanFacts: r.loanFacts,
    cards: o.cards ?? [visa()],
    bills: (o.bills ?? [electricity()]).map((row) => ({ row, currency: 'IDR' })),
    show: o.show ?? { loans: true, cards: true, bills: true },
    baseCurrency: 'IDR',
    ratesToBase: {},
  };
}

const kreditNov = (today: string) => kreditFact(today).schedule.find((r) => r.onDate.startsWith('2026-11'))!.paymentMinor;
const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe('monthItems and monthSections', () => {
  it('late, coming up and paid, each with its own words and Pay', () => {
    const items = monthItems(input('2026-11-04'));
    const s = monthSections(items, '2026-11', '2026-11-04');
    expect(titles(s.late)).toEqual(['Kredit · 4/6']);
    expect(titles(s.comingUp)).toEqual(['BCA Visa', 'Electricity']);
    expect(titles(s.paid)).toEqual(['KPR BCA · 63/120']);
    expect(s.paid[0]).toMatchObject({ fromMessage: true, paidOn: '2026-11-01', minor: 2_480_000, pay: null });
    expect(s.late[0]).toMatchObject({ daysLate: 3, pay: loanPay('L1'), minor: kreditNov('2026-11-04') });
    expect(s.comingUp[0]).toMatchObject({ detail: 'Statement · 18 Nov', pay: cardPay('C1'), minor: 6_214_300 });
    expect(s.comingUp[1]).toMatchObject({ detail: 'Bill · 20 Nov', pay: billPay('B1'), minor: 780_000, kind: 'bill', debtKey: null });
  });

  it('totals: due, paid and late; the switches take items out of both', () => {
    const items = monthItems(input('2026-11-04'));
    expect(monthTotals(items, '2026-11')).toEqual({ dueMinor: kreditNov('2026-11-04') + 6_214_300 + 780_000 + 2_480_000, paidMinor: 2_480_000, lateMinor: kreditNov('2026-11-04'), missing: [] });
    const noBills = monthItems(input('2026-11-04', { show: { loans: true, cards: true, bills: false } }));
    expect(titles(noBills)).not.toContain('Electricity');
    expect(monthTotals(noBills, '2026-11').dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 2_480_000);
  });

  it('a late instalment of an earlier month is in this month’s late section, not in its due', () => {
    const fact = kreditFact('2026-11-04');
    const missedOct = { ...fact, instalments: fact.instalments.map((i) => (i.number === 3 ? { ...i, status: 'late' as const, paidOn: null, paymentId: null, paidMinor: null, fromMessage: false, daysLate: 34 } : i)) };
    const items = monthItems(input('2026-11-04', { kredit: missedOct }));
    const s = monthSections(items, '2026-11', '2026-11-04');
    expect(s.late.map((i) => [i.title, i.detail])).toEqual([
      ['Kredit · 3/6', 'Oct instalment'],
      ['Kredit · 4/6', 'Instalment · 1 Nov'],
    ]);
    const totals = monthTotals(items, '2026-11');
    expect(totals.dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 780_000 + 2_480_000);
    expect(totals.lateMinor).toBe(2 * kreditNov('2026-11-04'));
  });

  it('a statement that billed nothing is not an item; one not yet closed says so far', () => {
    expect(titles(monthItems(input('2026-11-04', { cards: [visa(0, 0)] })))).not.toContain('BCA Visa');
    const open = monthItems(input('2026-11-04', { cards: [{ ...visa(), statement: statement(6_214_300, null, false) }] })).find((i) => i.title === 'BCA Visa')!;
    expect(open).toMatchObject({ approximate: true, status: 'upcoming' });
  });

  it('a paid statement and a paid bill are paid; a skipped bill is not listed', () => {
    const items = monthItems(input('2026-11-21', { cards: [visa(6_214_300, 0)], bills: [electricity('paid', { paidOn: '2026-11-19', paidMinor: 812_000, paidCurrency: 'IDR' })] }));
    const s = monthSections(items, '2026-11', '2026-11-21');
    expect(s.paid.find((i) => i.title === 'Electricity')).toMatchObject({ paidOn: '2026-11-19', minor: 812_000, pay: null });
    expect(s.paid.some((i) => i.title === 'BCA Visa')).toBe(true);
    expect(titles(monthItems(input('2026-11-04', { bills: [electricity('skipped')] })))).not.toContain('Electricity');
  });

  it('a bill belongs to the month its pay-by day falls in; an earlier month’s overdue one is carried into this one', () => {
    const outLate = electricity('upcoming', { month: '2026-11', window: { month: '2026-11', opensOn: '2026-11-28', payBy: '2026-12-05' } });
    expect(titles(monthItems(input('2026-11-04', { bills: [outLate] })))).not.toContain('Electricity');
    const october = electricity('overdue', { month: '2026-10', window: { month: '2026-10', opensOn: '2026-10-10', payBy: '2026-10-20' } });
    const items = monthItems(input('2026-11-04', { bills: [october, electricity()] }));
    const s = monthSections(items, '2026-11', '2026-11-04');
    expect(s.late.find((i) => i.kind === 'bill')).toMatchObject({ title: 'Electricity', dueOn: '2026-10-20', daysLate: 15 });
    expect(monthTotals(items, '2026-11').dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 780_000 + 2_480_000);
    // Looking back at October, the same bill is October's.
    expect(titles(monthItems(input('2026-11-04', { month: '2026-10', cards: [], bills: [october] })))).toContain('Electricity');
  });

  it('a month ahead shows scheduled instalments as upcoming, numbered from the first', () => {
    const items = monthItems(input('2026-11-04', { month: '2026-12', cards: [], bills: [] }));
    expect(items.find((i) => i.title.startsWith('KPR BCA'))).toMatchObject({ title: 'KPR BCA · 64/120', status: 'upcoming', dueOn: '2026-12-01' });
    expect(items.every((i) => i.status === 'upcoming')).toBe(true);
  });

  it('counts what is still due this month', () => {
    expect(dueThisMonthCount(monthItems(input('2026-11-04')), '2026-11')).toBe(3);
  });
});

describe('a card statement part paid, or carried from month to month', () => {
  it('a late statement asks for what is left — the figure Pay next asks — and counts what was paid', () => {
    // Closed at 10.000.000, due 5 Nov, 6.000.000 paid since; today 11 Nov.
    const part = { ...visa(10_000_000, 4_000_000), dueOn: '2026-11-05' };
    const items = monthItems(input('2026-11-11', { cards: [part], bills: [] }));
    const card = items.find((i) => i.kind === 'card')!;
    expect(card).toMatchObject({ status: 'late', minor: 4_000_000, daysLate: 6 });
    const t = monthTotals(items.filter((i) => i.kind === 'card'), '2026-11');
    expect(t).toMatchObject({ dueMinor: 10_000_000, paidMinor: 6_000_000, lateMinor: 4_000_000 });
    expect(dueRow(items.filter((i) => i.kind === 'card'), '2026-11-11')!.item.minor).toBe(4_000_000);
  });

  it('a balance carried through three statements and cleared by one payment is paid once across the months', () => {
    // Aug closes at 10m, Sep at 15m (10m carried + 5m new), Oct at 18m (15m carried + 3m new); 18m paid on 5 Nov.
    const card = (month: string, dueOn: string, opening: number, charges: number) => ({
      cardId: 'C1',
      name: 'BCA Visa',
      currency: 'IDR',
      dueOn,
      statement: statement(opening + charges, 0, true, { openingMinor: opening, chargesMinor: charges, paidSinceMinor: 18_000_000, cycle: { start: `${month}-01`, end: `${month}-28` } }),
    });
    const months = [
      { month: '2026-09', card: card('2026-08', '2026-09-14', 0, 10_000_000) },
      { month: '2026-10', card: card('2026-09', '2026-10-14', 10_000_000, 5_000_000) },
      { month: '2026-11', card: card('2026-10', '2026-11-14', 15_000_000, 3_000_000) },
    ];
    const totals = months.map(({ month, card: c }) => monthTotals(monthItems(input('2026-11-20', { month, cards: [c], bills: [], show: { loans: false, cards: true, bills: true } })), month));
    expect(totals.reduce((s, t) => s + t.paidMinor, 0)).toBe(18_000_000);
    expect(totals.reduce((s, t) => s + t.dueMinor, 0)).toBe(18_000_000);
    expect(totals.map((t) => t.lateMinor)).toEqual([0, 0, 0]);
  });
});

describe('a loan paid off', () => {
  it('keeps its months behind, paid, and never shows late or ahead', () => {
    // Bank (in the fixtures): paid off on 15 Sep 2026; instalments 1/6 (1 Aug) and 2/6 (1 Sep) paid.
    const bankTerms = { firstPaymentOn: '2026-08-01', paymentDay: 1, tenorMonths: 6 };
    const bank: LoanPlanFact = {
      accountId: 'L3',
      owedMinor: 0,
      trackFrom: '2026-08-01',
      instalments: instalmentStanding(instalmentDates(bankTerms, '2026-08-01', '2026-09-15'), [
        { id: 'b1', occurredOn: '2026-08-01', totalMinor: 400_000, fromMessage: false },
        { id: 'b2', occurredOn: '2026-09-15', totalMinor: 1_600_000, fromMessage: false },
      ], '2026-11-04'),
      scheduleFrom: '2026-09-15',
      schedule: [],
    };
    const base = input('2026-11-04', { month: '2026-09', cards: [], bills: [] });
    const all = planDebts(readings(), '2026-11-04');
    const september = monthItems({ ...base, debts: all, loanFacts: [...base.loanFacts, bank] });
    expect(september.find((i) => i.debtKey === 'L3')).toMatchObject({ title: 'Bank · 2/6', status: 'paid', paidOn: '2026-09-15', minor: 1_600_000 });
    const november = monthItems({ ...base, month: '2026-11', debts: all, loanFacts: [...base.loanFacts, bank] });
    expect(november.some((i) => i.debtKey === 'L3')).toBe(false);
  });
});

describe('a bill paid from a credit card', () => {
  it('keeps its row, says which card, and stays out of the totals the statement already counts', () => {
    const items = monthItems({ ...input('2026-11-04'), bills: [{ row: electricity(), currency: 'IDR', cover: { card: 'BCA Visa' } }] });
    const bill = items.find((i) => i.kind === 'bill')!;
    expect(bill).toMatchObject({ detail: 'Bill · 20 Nov · on BCA Visa', inTotals: false });
    expect(monthTotals(items, '2026-11').dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 2_480_000);
    expect(dueRow(items, '2026-11-18')?.item.kind).not.toBe('bill');
  });
});

describe('who answers for a bill (billCover)', () => {
  const accounts = [
    { id: 'bank', subtype: 'bank', name: 'Own Bank' },
    { id: 'card', subtype: 'credit_card', name: 'Own Card' },
  ];
  it("a credit card on this phone's list is the card, by name; any other own account is nobody's but this phone's", () => {
    expect(billCover('card', accounts, new Map())).toEqual({ card: 'Own Card' });
    expect(billCover('bank', accounts, new Map())).toBeNull();
  });
  it("an account this phone does not hold is another member's: by the member's name when it is their placeholder", () => {
    expect(billCover('ph-1', accounts, new Map([['ph-1', { name: 'Sari', self: false }]]))).toEqual({ member: 'Sari' });
    expect(billCover('gone', accounts, new Map())).toEqual({ member: null });
  });
  it("a placeholder for this phone's own member (a restored phone's own bill) is this phone's own to pay", () => {
    expect(billCover('ph-me', accounts, new Map([['ph-me', { name: 'Bima', self: true }]]))).toBeNull();
  });
});

describe("a bill on one member's own card, seen from both phones", () => {
  // The payer's phone holds the card; the partner's holds only a placeholder for her (packages/db bill-member-payer.test).
  const payerPhone = [{ id: 'card-sari', subtype: 'credit_card', name: 'Sari Card' }];
  const partnerPhone = [{ id: 'bank-bima', subtype: 'bank', name: 'Bima Bank' }];
  const onPayer = billCover('card-sari', payerPhone, new Map());
  const onPartner = billCover('ph-sari', partnerPhone, new Map([['ph-sari', { name: 'Sari', self: false }]]));
  const late = electricity('overdue');
  const row = (cover: ReturnType<typeof billCover>) => ({ bill: { ...late.bill, window: late.window, state: late.state, estimateMinor: late.estimateMinor }, currency: 'IDR', cover });

  it('neither Cashflow row asks for it', () => {
    for (const cover of [onPayer, onPartner]) {
      expect(dueItems({ debts: [], loanFacts: [], bills: [row(cover)], today: '2026-12-04' })).toEqual([]);
    }
  });
  it("both plans list it out of the totals, the payer's by card and the partner's by member", () => {
    const plan = (cover: ReturnType<typeof billCover>) => monthItems({ ...input('2026-11-04'), bills: [{ row: electricity(), currency: 'IDR', cover }] });
    const mine = plan(onPayer);
    const theirs = plan(onPartner);
    expect(mine.find((i) => i.kind === 'bill')).toMatchObject({ detail: 'Bill · 20 Nov · on Sari Card', inTotals: false });
    expect(theirs.find((i) => i.kind === 'bill')).toMatchObject({ detail: 'Bill · 20 Nov · paid by Sari', inTotals: false });
    expect(monthTotals(theirs, '2026-11')).toEqual(monthTotals(mine, '2026-11'));
    expect(dueRow(theirs, '2026-11-18')).toEqual(dueRow(mine, '2026-11-18'));
  });
  it("late on a restored phone's own placeholder, it is asked for, as on the phone it was made on", () => {
    const own = billCover('ph-me', partnerPhone, new Map([['ph-me', { name: 'Bima', self: true }]]));
    const items = dueItems({ debts: [], loanFacts: [], bills: [row(own)], today: '2026-12-04' });
    expect(items).toMatchObject([{ kind: 'bill', status: 'late', title: 'Electricity' }]);
    expect(items).toEqual(dueItems({ debts: [], loanFacts: [], bills: [row(billCover('bank-bima', partnerPhone, new Map()))], today: '2026-12-04' }));
    const plan = monthItems({ ...input('2026-11-04'), bills: [{ row: electricity(), currency: 'IDR', cover: own }] });
    expect(plan.find((i) => i.kind === 'bill')).toMatchObject({ detail: 'Bill · 20 Nov', inTotals: true });
  });
  it('a member not known by name reads as another member', () => {
    const items = monthItems({ ...input('2026-11-04'), bills: [{ row: electricity(), currency: 'IDR', cover: { member: null } }] });
    expect(items.find((i) => i.kind === 'bill')).toMatchObject({ detail: 'Bill · 20 Nov · paid by another member', inTotals: false });
  });
});

describe('the Cashflow row from what is already read', () => {
  it('says what the month model says, without reading a month', () => {
    for (const day of ['2026-11-16', '2026-11-17']) {
      const full = input(day);
      const bills = full.bills.map(({ row, currency }) => ({ bill: { ...row.bill, window: row.window, state: row.state, estimateMinor: row.estimateMinor }, currency, cover: null }));
      const pick = (row: ReturnType<typeof dueRow>) => row && { title: row.title, subtitle: row.subtitle, tone: row.tone, rest: row.rest, key: row.item.key, minor: row.item.minor, pay: row.item.pay };
      expect(pick(dueRow(dueItems({ debts: full.debts, loanFacts: full.loanFacts, bills, today: day }), day))).toEqual(pick(dueRow(monthItems(full), day)));
    }
  });
  it('a bill on a card and a paid bill are not asked for', () => {
    const full = input('2026-11-18');
    const row = full.bills[0]!.row;
    const bill = { ...row.bill, window: row.window, state: 'dueSoon' as const, estimateMinor: 780_000 };
    const items = dueItems({ debts: [], loanFacts: [], bills: [{ bill, currency: 'IDR', cover: { card: 'BCA Visa' } }, { bill: { ...bill, id: 'B2', state: 'paid' as const }, currency: 'IDR', cover: null }], today: '2026-11-18' });
    expect(dueRow(items, '2026-11-18')).toBeNull();
  });
});

describe('dueRow', () => {
  const on = (day: string, kredit?: LoanPlanFact) => monthItems(input(day, kredit ? { kredit } : {}));
  it('the most late first, then what falls due within three days', () => {
    expect(dueRow(on('2026-11-16'), '2026-11-16')).toMatchObject({ title: 'Kredit instalment', subtitle: '15 days late · +1 due in 2 days', tone: 'alarm', rest: 1 });
    expect(dueRow(on('2026-11-17'), '2026-11-17')).toMatchObject({ subtitle: '16 days late · +2 more', rest: 2 });
  });
  it('one more late item reads +1 late', () => {
    const fact = kreditFact('2026-11-04');
    const missedOct = { ...fact, instalments: fact.instalments.map((i) => (i.number === 3 ? { ...i, status: 'late' as const, paidOn: null, paymentId: null, paidMinor: null, fromMessage: false, daysLate: 34 } : i)) };
    const items = monthItems(input('2026-11-04', { kredit: missedOct })).filter((i) => i.kind === 'loan');
    expect(dueRow(items, '2026-11-04')).toMatchObject({ title: 'Kredit instalment', subtitle: '34 days late · +1 late' });
  });
  it('nothing late: the soonest due', () => {
    const paid = kreditFact('2026-11-17');
    const allPaid = { ...paid, instalments: paid.instalments.map((i) => ({ ...i, status: 'paid' as const, paidOn: i.dueOn, paymentId: `p${i.number}`, paidMinor: 1, daysLate: 0 })) };
    expect(dueRow(on('2026-11-17', allPaid), '2026-11-17')).toMatchObject({ title: 'BCA Visa statement', subtitle: 'Due tomorrow · +1 due in 3 days', tone: 'warn' });
    expect(dueRow(on('2026-11-04', allPaid).filter((i) => i.kind !== 'loan'), '2026-11-04')).toBeNull();
  });
});

describe('a card statement with an instalment inside it (option C)', () => {
  const instalmentLine = { key: 'p1#1', transactionId: 't1', occurredOn: '2026-10-18', postedOn: null, statementOn: '2026-10-18', description: 'Laptop', cardId: null, owedMinor: 1_000_000, countedMinor: 1_000_000, instalment: { planId: 'p1', number: 1, of: 12 }, convertedTo: null, spending: true, originalCurrency: null, originalAmountMinor: null, paidBy: null, settles: 0, paidOff: false, balancing: false };

  it('says which instalment the statement holds', () => {
    const withLaptop: CardMonth = { ...visa(), statement: statement(6_214_300, 6_214_300, true, { lines: [instalmentLine] }) };
    const row = monthItems(input('2026-11-04', { cards: [withLaptop] })).find((i) => i.title === 'BCA Visa')!;
    expect(row.includes).toBe('incl. Laptop 1/12');
  });

  it('says nothing when it holds none', () => {
    const row = monthItems(input('2026-11-04', { cards: [visa()] })).find((i) => i.title === 'BCA Visa')!;
    expect(row.includes).toBeUndefined();
  });
});
