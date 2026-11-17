import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { buildRows, countsInOrOut, dayTotal, EMPTY_FILTERS, filterRows, instalmentRows, type ListFilters, markSpread, sharedTransferRow, totals } from './list-model';

/*
 * Cashflow lists only money in and money out (owner, 2026-11-16): one rule, the same in Personal and Family, in the list,
 * the table and the sideways table. A row is listed when it is spending or income, or counts some (a transfer's fee), or
 * is a draft waiting to be reviewed. Everything else — transfers of every reach, corrections, starting balances, lending
 * with no fee, At purchase repayments and saving instalments — is left to the account, card and person pages, which list
 * every row as ever. Every name and figure here is invented.
 */

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency: kind === 'expense' || kind === 'income' ? null : 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const accounts = [
  account('bank', 'asset', 'bank', { name: 'Contoh Payroll' }),
  account('card', 'liability', 'credit_card', { name: 'Contoh Platinum' }),
  account('wallet', 'asset', 'ewallet', { name: 'Dompet' }),
  account('cash', 'asset', 'cash', { name: 'Cash' }),
  account('cashUsd', 'asset', 'cash', { name: 'Cash USD', currency: 'USD' }),
  account('joint', 'asset', 'bank', { name: 'Joint Contoh' }),
  account('rdn', 'asset', 'fund', { name: 'Broker cash' }),
  account('stock', 'asset', 'investment', { name: 'Contoh shares' }),
  account('loan', 'liability', 'loan', { name: 'Car loan' }),
  account('friend', 'asset', 'receivable', { name: 'Sari' }),
  account('fees', 'expense', 'category', { name: 'Fees & charges' }),
  account('groceries', 'expense', 'category', { name: 'Groceries' }),
  account('salary', 'income', 'category', { name: 'Salary' }),
  account('fx', 'equity', 'equity', { name: 'Currency exchange', systemKey: 'currency_exchange' }),
  account('loss', 'expense', 'category', { name: 'Exchange loss', systemKey: 'expense.exchange_loss' }),
  account('gain', 'income', 'category', { name: 'Exchange gain', systemKey: 'income.exchange_gain' }),
  account('fixed', 'equity', 'equity', { name: 'Balance correction', systemKey: 'balance_correction' }),
  account('start', 'equity', 'equity', { name: 'Opening balances', systemKey: 'opening_balance' }),
];
// The partner's account on this phone is a placeholder: posted against, never in the accounts list (spec §4.4).
const placeholder = { id: 'partner', kind: 'asset' as const, subtype: 'ewallet' as const, name: 'Member' };
const byId = new Map<string, { kind: string; subtype: string; name: string; systemKey?: string | null }>([...accounts.map((a) => [a.id, a] as const), ['partner', placeholder]]);
const cards: CardRow[] = [{ id: 'c1', accountId: 'card', last4: '4821', holderName: null, isPrimary: true }];

let seq = 0;
function tx(description: string, lines: [string, number, string?][], extra: Partial<TransactionView> = {}): TransactionView {
  seq += 1;
  return {
    id: `t${seq}`, occurredOn: '2026-10-25', description, source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null,
    createdAt: `2026-10-25T00:00:${String(seq).padStart(2, '0')}Z`,
    entries: lines.map(([accountId, amountMinor, currency], i) => {
      const a = byId.get(accountId)!;
      return { id: `t${seq}e${i}`, accountId, accountName: a.name, accountKind: a.kind, accountSubtype: a.subtype, accountSystemKey: a.systemKey ?? null, amountMinor, currency: currency ?? 'IDR', fxRateToBase: 1, amountBaseMinor: amountMinor, memo: null, spendCategoryId: null } as TransactionView['entries'][number];
    }),
    ...extra,
  };
}

// Money in and out: listed.
const groceries = tx('Pasar Contoh', [['groceries', 410_000_00], ['card', -410_000_00]], { cardId: 'c1' });
const pay = tx('October pay', [['bank', 9_000_000_00], ['salary', -9_000_000_00]]);
const refund = tx('Money back', [['card', 50_000_00], ['groceries', -50_000_00]], { cardId: 'c1' });
const excluded = tx('Not mine', [['groceries', 70_000_00], ['card', -70_000_00]], { cardId: 'c1', excluded: true });
const withFee = tx('Top-up with fee', [['wallet', 1_000_000_00], ['fees', 10_000_00], ['bank', -1_010_000_00]]);
const lentWithFee = tx('Lent by card', [['friend', 100_000_00], ['fees', 5_000_00], ['card', -105_000_00]]);
const sharedBill = tx('Dinner with Sari', [['groceries', 60_000_00], ['friend', 60_000_00], ['bank', -120_000_00]]);
// Moves of money, and how the books were started: left to the account, card and person pages.
const cardPayment = tx('Card payment', [['card', 6_400_000_00], ['bank', -6_400_000_00]]);
const topUp = tx('Dompet top-up', [['wallet', 500_000_00], ['bank', -500_000_00]]);
const atm = tx('ATM withdrawal', [['cash', 1_000_000_00], ['bank', -1_000_000_00]]);
const exchange = tx('Money changer', [['cashUsd', 100_00, 'USD'], ['fx', -100_00, 'USD'], ['fx', 1_600_000_00], ['cash', -1_600_000_00]]);
const buy = tx('Buy Contoh shares', [['stock', 2_000_000_00], ['rdn', -2_000_000_00]]);
const loanPayment = tx('Car loan', [['loan', 1_500_000_00], ['bank', -1_500_000_00]]);
const lent = tx('Lent to Sari', [['friend', 100_000_00], ['bank', -100_000_00]]);
const paidBack = tx('Sari paid back', [['bank', 100_000_00], ['friend', -100_000_00]]);
const correction = tx('Balance fixed', [['bank', -35_000_00], ['fixed', 35_000_00]]);
const opening = tx('Starting balance', [['wallet', 250_000_00], ['start', -250_000_00]]);
// Family: the household's money moves, and the partner's purchase posted against their placeholder.
const toJoint = tx('Into the joint account', [['joint', 3_000_000_00], ['bank', -3_000_000_00]]);
const toPartner = tx('To the partner', [['partner', 250_000_00], ['bank', -250_000_00]]);
const partnerBuys = tx('Partner’s groceries', [['groceries', 80_000_00], ['partner', -80_000_00]]);

const draftRow = {
  id: 'd1', source: 'sms', kind: 'transfer', status: 'pending', rawPayload: null, occurredOn: '2026-10-25', description: 'Card payment to review', amountMinor: 100_00, currency: 'IDR', accountId: 'bank', toAccountId: 'card', categoryAccountId: null, cardId: null, sourceId: null, captureIds: [], imageFile: null, reading: null, mergedInto: null, confidence: null, externalRef: null, transactionId: null,
} as unknown as DraftRow;

const plan = { planId: 'p1', cardAccountId: 'card', transactionId: groceries.id, number: 1, of: 6, statementOn: '2026-10-25' };
const instalments = instalmentRows(
  {
    lines: [{ ...plan, description: 'Laptop, 1 of 6', categoryId: 'groceries', amountBaseMinor: 1_000_000_00 }],
    repayments: [
      { ...plan, planId: 'p2', description: 'Phone, 1 of 6', amountMinor: 500_000_00, investment: false },
      { ...plan, planId: 'p3', description: 'Bond, 1 of 6', amountMinor: 1_000_000_00, investment: true },
    ],
  },
  accounts,
  'IDR',
);
const redacted = sharedTransferRow({ transferId: 'x1', bookId: 'family', occurredOn: '2026-10-25', amountMinor: 75_000_00, currency: 'IDR', description: 'Savings', recordedBy: 'm2', fromName: null, toName: null, name: null });

const listedTxs = [groceries, pay, refund, excluded, withFee, lentWithFee, sharedBill];
const offTxs = [cardPayment, topUp, atm, exchange, buy, loanPayment, lent, paidBack, correction, opening];
const familyListed = [partnerBuys];
const familyOff = [toJoint, toPartner];

const personal = [...buildRows([...listedTxs, ...offTxs], [draftRow], accounts, cards), ...instalments];
const family = [...buildRows([...listedTxs, ...offTxs, ...familyListed, ...familyOff], [draftRow], accounts, cards), ...instalments, redacted];
const names = (rows: readonly { description: string }[]) => rows.map((row) => row.description);
const cashflow = (rows: typeof personal, f: Partial<ListFilters> = {}) => filterRows(rows, { ...EMPTY_FILTERS, ...f }, accounts, true);

describe('countsInOrOut: the one rule', () => {
  const row = (t: TransactionView) => buildRows([t], [], accounts, cards)[0]!;

  it('keeps spending, income, a refund and an excluded purchase (grey, to be counted again)', () => {
    for (const t of [groceries, pay, refund, excluded]) expect(countsInOrOut(row(t))).toBe(true);
  });

  it('keeps a transfer or lending row that counts a fee, and a bill shared with a person (its own share)', () => {
    for (const t of [withFee, lentWithFee, sharedBill]) expect(countsInOrOut(row(t))).toBe(true);
    expect(row(withFee).spentMinor).toBe(10_000_00);
    expect(row(lentWithFee).spentMinor).toBe(5_000_00);
  });

  it('keeps a draft waiting to be reviewed, whatever kind it is', () => {
    expect(countsInOrOut(buildRows([], [draftRow], accounts, cards)[0]!)).toBe(true);
  });

  it('keeps each month’s instalment of a spending plan, and a purchase its plan spreads', () => {
    expect(countsInOrOut(instalments.find((r) => r.instalment?.countMode === 'each_month')!)).toBe(true);
    const [spread] = markSpread([row(groceries)], new Map([[groceries.id, 6]]));
    expect(countsInOrOut(spread!)).toBe(true);
  });

  it('leaves out every transfer: a card payment, a top-up, an ATM withdrawal, an exchange, a buy, a loan payment', () => {
    for (const t of [cardPayment, topUp, atm, exchange, buy, loanPayment]) expect(countsInOrOut(row(t))).toBe(false);
  });

  it('leaves out lending and being paid back with no fee, a balance correction and a starting balance', () => {
    for (const t of [lent, paidBack, correction, opening]) expect(countsInOrOut(row(t))).toBe(false);
  });

  it('leaves out a joint or partner transfer, and the partner’s redacted transfer row', () => {
    for (const t of [toJoint, toPartner]) expect(countsInOrOut(row(t))).toBe(false);
    expect(countsInOrOut(redacted)).toBe(false);
  });

  it('leaves out an At purchase repayment and an investment’s saving instalment', () => {
    for (const r of instalments.filter((each) => each.instalment?.countMode === 'at_purchase')) expect(countsInOrOut(r)).toBe(false);
  });

  it('leaves out a deleted transfer even under Show deleted, and keeps a deleted purchase there', () => {
    const gone = (t: TransactionView) => buildRows([{ ...t, status: 'void' }], [], accounts, cards);
    expect(filterRows(gone(topUp), { ...EMPTY_FILTERS, showDeleted: true }, accounts, true)).toEqual([]);
    expect(filterRows(gone(groceries), { ...EMPTY_FILTERS, showDeleted: true }, accounts, true)).toHaveLength(1);
  });
});

describe('Cashflow in Personal', () => {
  it('lists the draft, the money in and out, and the spending instalment — nothing else', () => {
    expect(names(cashflow(personal))).toEqual(['Card payment to review', ...names(listedTxs), 'Laptop, 1 of 6']);
  });

  it('leaves out the money moves whatever the Type asks for', () => {
    for (const type of ['all', 'expense', 'income'] as const) {
      const shown = names(cashflow(personal, { type }));
      for (const t of offTxs) expect(shown).not.toContain(t.description);
    }
  });
});

describe('Cashflow in Family', () => {
  it('lists the same kinds as Personal, plus the partner’s purchase', () => {
    expect(names(cashflow(family))).toEqual(['Card payment to review', ...names(listedTxs), ...names(familyListed), 'Laptop, 1 of 6']);
  });

  it('leaves out the household’s transfers and the partner’s redacted ones', () => {
    const shown = names(cashflow(family));
    for (const t of [...familyOff, ...offTxs]) expect(shown).not.toContain(t.description);
    expect(shown).not.toContain(redacted.description);
  });
});

describe('what the rule never touches', () => {
  it('an account’s or card’s own page (no Cashflow) lists every transfer, lending and correction as ever', () => {
    const page = filterRows(personal, { ...EMPTY_FILTERS, showOpening: true }, accounts);
    expect(names(page)).toEqual(expect.arrayContaining(names([...listedTxs, ...offTxs])));
  });

  it('Cashflow’s figures: the day’s net and the period’s spending and income are what they were with every row', () => {
    for (const rows of [personal, family]) {
      const every = filterRows(rows, EMPTY_FILTERS, accounts);
      const listed = cashflow(rows);
      expect(dayTotal(listed)).toBe(dayTotal(every));
      expect(totals(listed).spentMinor).toBe(totals(every).spentMinor);
      expect(totals(listed).incomeMinor).toBe(totals(every).incomeMinor);
    }
  });

  it('the Type filter narrows to income alone, and to spending alone', () => {
    expect(names(cashflow(personal, { type: 'income' }))).toEqual([pay.description]);
    expect(names(cashflow(personal, { type: 'expense' }))).not.toContain(pay.description);
  });
});

describe('an exchange’s gain or loss counts nowhere (owner, 17 Nov 2026)', () => {
  const row = (t: TransactionView) => buildRows([t], [], accounts, cards)[0]!;
  // US$100 out of the dollar cash for Rp 1.570.000, the withdrawal rate's pair beside it: a loss, then a gain.
  const usdOut = (pair: [string, number][], fee: [string, number, string?][] = []) =>
    tx('Back to rupiah', [['cashUsd', -100_00, 'USD'], ['fx', 100_00, 'USD'], ['cash', 1_570_000_00], ['fx', -1_570_000_00], ...pair.map(([id, amount]): [string, number] => [id, amount]), ...fee]);
  const withLoss = usdOut([['loss', 30_000_00], ['fx', -30_000_00]]);
  const withGain = usdOut([['gain', -20_000_00], ['fx', 20_000_00]]);
  // A typed fee beside it (a partner's edit reposted the pair as two plain lines, final review I3): only the fee counts.
  const withFeeAndLoss = usdOut([['loss', 30_000_00], ['fx', -30_000_00]], [['fees', 2_00, 'USD']]);
  // On a partner's phone a shared Personal exchange arrives as its pair alone, against the payer's placeholder.
  const partnersCopy = tx('Back to rupiah', [['loss', 30_000_00], ['partner', -30_000_00]]);

  it('leaves the transfer off Cashflow, spending nothing and earning nothing', () => {
    for (const t of [withLoss, withGain, partnersCopy]) {
      const r = row(t);
      expect([countsInOrOut(r), r.spentMinor, r.earnedMinor]).toEqual([false, 0, 0]);
    }
  });

  it('counts a typed fee as the fee alone', () => {
    const r = row(withFeeAndLoss);
    expect(countsInOrOut(r)).toBe(true);
    expect(r.spentMinor).toBe(2_00);
    expect(totals([r]).spentMinor).toBe(2_00);
  });
});
