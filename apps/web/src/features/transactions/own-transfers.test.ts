import type { AccountRow, CardRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { buildRows, dayTotal, EMPTY_FILTERS, filterRows, type ListFilters, sharedTransferRow, totals, transferReach } from './list-model';
import { DEFAULT_SORT, sortFilterCount } from './SortFilterMenu';
import { jointWithPockets } from '../sharing/joint-pockets';

/*
 * Own transfers off Cashflow (owner, 2026-11-13, option C): a display rule only. A transfer between the viewer's own
 * accounts is listed in no workspace's Cashflow; one touching a joint account or the partner's is listed in the shared
 * workspace alone; the Transfers filter brings them back. Every name and figure here is invented.
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
  account('jointUsd', 'asset', 'bank', { name: 'Joint Contoh · USD', parentId: 'joint', currency: 'USD' }),
  account('rdn', 'asset', 'fund', { name: 'Broker cash' }),
  account('stock', 'asset', 'investment', { name: 'Contoh shares' }),
  account('loan', 'liability', 'loan', { name: 'Car loan' }),
  account('friend', 'asset', 'receivable', { name: 'Sari' }),
  account('fees', 'expense', 'category', { name: 'Fees & charges' }),
  account('groceries', 'expense', 'category', { name: 'Groceries' }),
  account('fx', 'equity', 'equity', { name: 'Currency exchange', systemKey: 'currency_exchange' }),
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

const cardPayment = tx('Card payment', [['card', 6_400_000_00], ['bank', -6_400_000_00]]);
const topUp = tx('Dompet top-up', [['wallet', 500_000_00], ['bank', -500_000_00]]);
const toBroker = tx('To broker cash', [['rdn', 1_000_000_00], ['bank', -1_000_000_00]]);
const exchange = tx('Money changer', [['cashUsd', 100_00, 'USD'], ['fx', -100_00, 'USD'], ['fx', 1_600_000_00], ['cash', -1_600_000_00]]);
const toJoint = tx('Into the joint account', [['joint', 3_000_000_00], ['bank', -3_000_000_00]]);
const toPartner = tx('To the partner', [['partner', 250_000_00], ['bank', -250_000_00]]);
const withFee = tx('Top-up with fee', [['wallet', 1_000_000_00], ['fees', 10_000_00], ['bank', -1_010_000_00]]);
const groceries = tx('Pasar Contoh', [['groceries', 410_000_00], ['card', -410_000_00]], { cardId: 'c1' });
const buy = tx('Buy Contoh shares', [['stock', 2_000_000_00], ['rdn', -2_000_000_00]]);
const loanPayment = tx('Car loan', [['loan', 1_500_000_00], ['bank', -1_500_000_00]]);
const lent = tx('Lent to Sari', [['friend', 100_000_00], ['bank', -100_000_00]]);

const all = [cardPayment, topUp, toBroker, exchange, toJoint, toPartner, withFee, groceries, buy, loanPayment, lent];
const rows = buildRows(all, [], accounts, cards);
const joint = new Set(['joint']);
const shownIn = (shared: boolean, f: Partial<ListFilters> = {}) =>
  filterRows(rows, { ...EMPTY_FILTERS, ...f }, accounts, { shared, jointIds: joint }).map((row) => row.description);

describe('which transfers Cashflow keeps where (transferReach)', () => {
  const reach = (t: TransactionView) => transferReach(rows.find((row) => row.id === t.id)!, new Set(accounts.map((a) => a.id)), joint);

  it('calls a transfer between own money accounts own: a card payment, a top-up, broker cash, a cash exchange', () => {
    for (const own of [cardPayment, topUp, toBroker, exchange]) expect(reach(own)).toBe('own');
  });

  it('calls one into a joint account’s pocket the household’s, the pocket read as joint (jointWithPockets)', () => {
    const intoPocket = tx('Into the joint USD pocket', [['jointUsd', 100_00, 'USD'], ['fx', -100_00, 'USD'], ['fx', 1_600_000_00], ['bank', -1_600_000_00]]);
    const [row] = buildRows([intoPocket], [], accounts, cards);
    const known = new Set(accounts.map((a) => a.id));
    expect(transferReach(row!, known, jointWithPockets(joint, accounts))).toBe('household');
    // Without the pockets read in, the bare switch alone would have called it own.
    expect(transferReach(row!, known, joint)).toBe('own');
  });

  it('calls one touching a joint account or the partner’s account the household’s', () => {
    expect(reach(toJoint)).toBe('household');
    expect(reach(toPartner)).toBe('household');
  });

  it('leaves everything else as it is listed today: a fee, spending, a holding bought, a loan paid, money lent', () => {
    for (const kept of [withFee, groceries, buy, loanPayment, lent]) expect(reach(kept)).toBeNull();
  });
});

describe('Cashflow in a private workspace (Personal, Business)', () => {
  it('lists no own transfer and no household one', () => {
    const shown = shownIn(false);
    for (const gone of [cardPayment, topUp, toBroker, exchange, toJoint, toPartner]) expect(shown).not.toContain(gone.description);
  });

  it('keeps a transfer with a typed fee (its fee is spending), spending, a buy, a loan payment and lending', () => {
    expect(shownIn(false)).toEqual([withFee, groceries, buy, loanPayment, lent].map((t) => t.description));
  });
});

describe('Cashflow in the shared workspace (Family)', () => {
  it('lists the household’s transfers and still no own one', () => {
    const shown = shownIn(true);
    expect(shown).toEqual(expect.arrayContaining([toJoint.description, toPartner.description]));
    for (const gone of [cardPayment, topUp, toBroker, exchange]) expect(shown).not.toContain(gone.description);
  });

  it('keeps the partner’s redacted transfers', () => {
    const redacted = sharedTransferRow({ transferId: 'x1', bookId: 'family', occurredOn: '2026-10-25', amountMinor: 75_000_00, currency: 'IDR', description: 'Savings', recordedBy: 'm2', fromName: null, toName: null, name: null });
    expect(filterRows([redacted], EMPTY_FILTERS, accounts, { shared: true, jointIds: joint })).toHaveLength(1);
  });
});

describe('the Transfers filter', () => {
  it('is off at rest', () => expect(EMPTY_FILTERS.showTransfers).toBe(false));

  it('brings every hidden transfer back, in either workspace', () => {
    for (const shared of [false, true]) expect(shownIn(shared, { showTransfers: true })).toEqual(all.map((t) => t.description));
  });

  it('is what the Transfers & lending type asks for too', () => {
    expect(shownIn(false, { type: 'transfer' })).toEqual(expect.arrayContaining([cardPayment.description, topUp.description, lent.description]));
  });

  it('is counted on the Sort and filter button, and Reset takes it off', () => {
    expect(sortFilterCount({ sortValue: DEFAULT_SORT, paid: '', transfers: true })).toBe(1);
    expect(sortFilterCount({ sortValue: DEFAULT_SORT, paid: '', transfers: false })).toBe(0);
  });
});

describe('what the rule never touches', () => {
  it('an account’s own history (no Cashflow context) lists every transfer', () => {
    expect(filterRows(rows, EMPTY_FILTERS, accounts).map((row) => row.description)).toEqual(all.map((t) => t.description));
  });

  it('a draft waiting to be recorded is never hidden', () => {
    const draft = buildRows([], [{ id: 'd1', source: 'sms', kind: 'transfer', status: 'pending', rawPayload: null, occurredOn: '2026-10-25', description: 'Card payment', amountMinor: 100_00, currency: 'IDR', accountId: 'bank', toAccountId: 'card', categoryAccountId: null, cardId: null, sourceId: null, captureIds: [], imageFile: null, reading: null, mergedInto: null, confidence: null, externalRef: null, transactionId: null } as never], accounts, cards);
    expect(filterRows(draft, EMPTY_FILTERS, accounts, { shared: false, jointIds: joint })).toHaveLength(1);
  });

  it('the day’s and the month’s totals: transfers counted nothing before, and still count nothing', () => {
    const before = filterRows(rows, EMPTY_FILTERS, accounts);
    const after = filterRows(rows, EMPTY_FILTERS, accounts, { shared: false, jointIds: joint });
    expect(dayTotal(after)).toBe(dayTotal(before));
    expect(totals(after).spentMinor).toBe(totals(before).spentMinor);
    expect(totals(after).incomeMinor).toBe(totals(before).incomeMinor);
    // The fee is the one part of a transfer that is spending, and it stays.
    expect(after.find((row) => row.id === withFee.id)?.spentMinor).toBe(10_000_00);
  });
});
