import { readFileSync } from 'node:fs';
import type { AccountRow, CardRow, DraftRow, SharedTransferRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import type { ListRow } from './list-model';
import { categoryButtonLabel, amountExtraParts, amountLook, wholeLeftOut, buildRows, dayTotal, draftNeeds, EMPTY_FILTERS, filterRows, groupByDay, paidWithLook, sortRows, totals , groupByCategory, excludedHere, hasNotCountedPart, outsideEvents, accountsWithTransactions, sharedTransferRow, instalmentRows, markSpread, transferNote } from './list-model';

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency: kind === 'expense' || kind === 'income' ? null : 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const accounts = [
  account('bca', 'asset', 'bank', { name: 'BCA Tahapan' }),
  account('octo', 'liability', 'credit_card', { name: 'CIMB Octo' }),
  account('kantong', 'asset', 'ewallet', { name: 'Kantong' }),
  account('nusa', 'liability', 'credit_card', { name: 'Nusa Voyager Travel' }),
  account('debit', 'asset', 'bank', { name: 'Nusa Payroll' }),
  account('friend', 'asset', 'receivable', { name: 'Dina' }),
  account('ibkr', 'asset', 'investment', { name: 'Interactive Brokers' }),
  account('food', 'expense', 'category', { name: 'Food & Beverage', systemKey: 'food_beverage' }),
  account('groceries', 'expense', 'category', { name: 'Groceries', parentId: 'food', systemKey: 'groceries' }),
  account('salary', 'income', 'category', { name: 'Salary', systemKey: 'salary' }),
  account('electronics', 'expense', 'category', { name: 'Electronics', systemKey: 'electronics' }),
];
const byId = new Map(accounts.map((a) => [a.id, a]));
const cards: CardRow[] = [
  { id: 'c1', accountId: 'octo', last4: '1467', holderName: 'Fandrian', isPrimary: true },
  { id: 'c2', accountId: 'octo', last4: '8802', holderName: 'Aisyah', isPrimary: false },
  { id: 'c3', accountId: 'nusa', last4: '4417', holderName: null, isPrimary: true },
  { id: 'c4', accountId: 'debit', last4: '6630', holderName: null, isPrimary: true },
];

let seq = 0;
function tx(date: string, description: string, lines: [string, number, number?][], extra: Partial<TransactionView> = {}): TransactionView {
  seq += 1;
  return {
    id: `t${seq}`, occurredOn: date, description, source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null,
    createdAt: `2026-09-01T00:00:${String(seq).padStart(2, '0')}Z`,
    entries: lines.map(([accountId, amountMinor, base], i) => ({
      id: `t${seq}e${i}`, accountId, accountName: byId.get(accountId)!.name, accountKind: byId.get(accountId)!.kind, accountSubtype: byId.get(accountId)!.subtype, amountMinor, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: base ?? amountMinor, memo: null, spendCategoryId: null,
    })),
    ...extra,
  };
}

function draft(extra: Partial<DraftRow>): DraftRow {
  return {
    id: 'd1', source: 'csv', kind: 'expense', status: 'pending', rawPayload: null, occurredOn: '2026-09-12', description: 'APOTEK K24', amountMinor: 8500000, currency: 'IDR', accountId: 'octo', toAccountId: null, categoryAccountId: null, cardId: null, sourceId: null, captureIds: [], imageFile: null, reading: null, mergedInto: null, confidence: null, externalRef: null, transactionId: null,
    ...extra,
  };
}

const superindo = tx('2026-09-12', 'Superindo Kebayoran', [['groceries', 45000000], ['octo', -45000000]], { cardId: 'c2' });
const salary = tx('2026-09-12', 'September salary', [['bca', 2000000000], ['salary', -2000000000]]);
const pay = tx('2026-09-11', 'Pay the card', [['octo', 45000000], ['bca', -45000000]]);
const lend = tx('2026-09-10', 'Lent to Dina', [['friend', 10000000], ['bca', -10000000]]);
const voided = tx('2026-09-10', 'Typo', [['groceries', 100], ['bca', -100]], { status: 'void' });
const august = tx('2026-08-30', 'Warung Steak', [['groceries', 30000000], ['bca', -30000000]]);

const rows = buildRows([superindo, salary, pay, lend, voided, august], [draft({})], accounts, cards);
const find = (id: string) => rows.find((row) => row.id === id)!;

describe('buildRows', () => {
  it('reads a purchase with its category, parent and the card it was made on', () => {
    expect(find(superindo.id)).toMatchObject({ kind: 'tx', type: 'expense', amountMinor: 45000000, baseMinor: 45000000, categoryName: 'Groceries', parentName: 'Food & Beverage', accountLabel: 'CIMB Octo', last4: '8802', holderName: 'Aisyah' });
  });

  it('leaves out a statement check’s Payments not tracked adjustment, and nothing else named like it', () => {
    const equity = account('correction', 'equity', 'balance_correction' as AccountRow['subtype'], { systemKey: 'balance_correction' });
    const withEquity = [...accounts, equity];
    const adjustment = tx('2026-09-10', 'Payments not tracked (2 payments)', [['octo', 70000], ['bca', -70000]]);
    adjustment.entries[1] = { ...adjustment.entries[1]!, accountId: 'correction', accountName: 'Balance correction', accountKind: 'equity', accountSystemKey: 'balance_correction' };
    const lookalike = tx('2026-09-10', 'Payments not tracked (a note)', [['octo', 70000], ['bca', -70000]]);
    const shown = buildRows([adjustment, lookalike, superindo], [], withEquity, cards).map((row) => row.id);
    expect(shown).toEqual([lookalike.id, superindo.id]);
  });

  it('calls money lent to a person lending, not a transfer, and gives it no base amount', () => {
    expect(find(lend.id)).toMatchObject({ type: 'debt', baseMinor: 0 });
    // The two-account line reads the way the money went — what lost it first — whatever order the entries were
    // written in: a transfer posts [into, out of] and a buy posts [holding, cash].
    expect(find(pay.id)).toMatchObject({ type: 'transfer', accountLabel: 'BCA Tahapan → 1467' });
    expect(find(lend.id)).toMatchObject({ accountLabel: 'BCA Tahapan → Dina' });
    const flows = buildRows(
      [
        tx('2026-09-10', 'Borrowed from Dina', [['bca', 10000000], ['friend', -10000000]]),
        tx('2026-09-09', 'Bought shares', [['ibkr', 30000000], ['bca', -30100000]]),
      ],
      [],
      accounts,
      cards,
    );
    const label = (description: string) => flows.find((row) => row.description === description)!.accountLabel;
    expect(label('Borrowed from Dina')).toBe('Dina → BCA Tahapan');
    expect(label('Bought shares')).toBe('BCA Tahapan → Interactive Brokers');
  });

  it('carries a draft with what it still needs', () => {
    expect(find('d1')).toMatchObject({ kind: 'draft', needs: ['category'], baseMinor: 0, accountLabel: 'CIMB Octo' });
  });
});

describe('draftNeeds', () => {
  it('lists every missing piece in the order a row is filled in', () => {
    expect(draftNeeds(draft({ occurredOn: '12/9', description: ' ', amountMinor: 0, accountId: null }))).toEqual(['date', 'description', 'amount', 'paid with', 'category']);
    expect(draftNeeds(draft({ categoryAccountId: 'groceries' }))).toEqual([]);
  });
});

describe('filterRows', () => {
  const ids = (f: Partial<typeof EMPTY_FILTERS>) => filterRows(rows, { ...EMPTY_FILTERS, ...f }, accounts).map((row) => row.id);

  it('hides deleted rows until asked', () => {
    expect(ids({})).not.toContain(voided.id);
    expect(ids({ showDeleted: true })).toContain(voided.id);
  });

  it('keeps any period, not only a month', () => {
    expect(ids({ month: '2026-Q3' })).toContain(august.id);
    expect(ids({ month: '2026-09-01..2026-12-31' })).not.toContain(august.id);
  });

  it('keeps a month, but never hides an undated draft or the not-recorded list', () => {
    expect(ids({ month: '2026-08' })).toEqual([august.id]);
    const undated = buildRows([august], [draft({ occurredOn: 'yesterday' })], accounts, cards);
    expect(filterRows(undated, { ...EMPTY_FILTERS, month: '2026-08' }, accounts)).toHaveLength(2);
    expect(ids({ month: '2026-08', onlyDrafts: true })).toEqual(['d1']);
  });

  it('matches a category with everything filed under it', () => {
    expect(ids({ cat: 'food' })).toEqual(expect.arrayContaining([superindo.id, august.id]));
    expect(ids({ cat: 'food' })).not.toContain(salary.id);
  });

  it('tells one card from the account it belongs to', () => {
    expect(ids({ paid: 'card:c2' })).toEqual([superindo.id]);
    expect(ids({ paid: 'acct:octo' })).toEqual(expect.arrayContaining(['d1', superindo.id, pay.id]));
  });

  it('narrows to income alone; an account’s page still lists lending and card payments with every type', () => {
    expect(ids({ type: 'income' })).toEqual([salary.id]);
    expect(ids({})).toEqual(expect.arrayContaining([pay.id, lend.id]));
  });

  it('searches words, parents, card digits and amounts', () => {
    expect(ids({ q: 'food' })).toEqual(expect.arrayContaining([superindo.id, august.id]));
    expect(ids({ q: '8802' })).toEqual([superindo.id]);
    expect(ids({ q: 'aisyah super' })).toEqual([superindo.id]);
  });
});

describe('sorting and days', () => {
  it('puts newest first, drafts ahead of recorded rows on the same day, and undated drafts on top', () => {
    const undated = buildRows([superindo], [draft({ id: 'd2', occurredOn: '' }), draft({})], accounts, cards);
    expect(sortRows(undated, { key: 'date', dir: 'desc' }).map((row) => row.id)).toEqual(['d2', 'd1', superindo.id]);
  });

  it('keeps a day in the order rows were moved to by hand: unplaced newest first, then placed by place, drafts ahead', () => {
    const placed = (description: string, dayOrder: number | null, createdAt: string) =>
      tx('2026-09-20', description, [['groceries', 1000], ['bca', -1000]], { dayOrder, createdAt });
    const one = placed('One', 2, '2026-09-20T00:00:01Z');
    const two = placed('Two', 1, '2026-09-20T00:00:02Z');
    const fresh = placed('Fresh', null, '2026-09-20T00:00:03Z');
    const older = placed('Older', null, '2026-09-20T00:00:00Z');
    const day = buildRows([one, two, fresh, older], [draft({ occurredOn: '2026-09-20' })], accounts, cards);
    expect(sortRows(day, { key: 'date', dir: 'desc' }).map((row) => row.description)).toEqual([expect.anything(), 'Fresh', 'Older', 'Two', 'One']);
    expect(sortRows(day, { key: 'date', dir: 'desc' })[0]!.kind).toBe('draft');
    // Oldest day first or newest, a day reads the same way down.
    expect(sortRows(day, { key: 'date', dir: 'asc' }).filter((row) => row.kind === 'tx').map((row) => row.description)).toEqual(['Fresh', 'Older', 'Two', 'One']);
    // Sorted by amount, a place in the day means nothing: equal amounts fall back to newest first.
    expect(sortRows(day, { key: 'amount', dir: 'desc' }).filter((row) => row.kind === 'tx').map((row) => row.description)).toEqual(['Fresh', 'Two', 'One', 'Older']);
  });

  it('sorts by amount across days', () => {
    const sorted = sortRows(filterRows(rows, EMPTY_FILTERS, accounts), { key: 'amount', dir: 'desc' });
    expect(sorted[0]!.id).toBe(salary.id);
  });

  it('groups by day and nets a day without drafts, transfers or deleted rows', () => {
    const days = groupByDay(sortRows(filterRows(rows, { ...EMPTY_FILTERS, showDeleted: true }, accounts), { key: 'date', dir: 'desc' }));
    expect(days.map((day) => day.date)).toEqual(['2026-09-12', '2026-09-11', '2026-09-10', '2026-08-30']);
    expect(dayTotal(days[0]!.rows)).toBe(2000000000 - 45000000);
    expect(dayTotal(days[1]!.rows)).toBe(0);
    expect(dayTotal(days[2]!.rows)).toBe(0);
  });

  it('counts the fee on a loan as spending, and the loan itself as nothing', () => {
    // Rp 4.000.000 lent to Toko Fandri on the card, with a Rp 100.000 card fee filed under Groceries' neighbour.
    const loan = buildRows([tx('2026-09-12', 'Lent to Toko Fandri', [['friend', 4_000_000], ['groceries', 100_000], ['bca', -4_100_000]])], [], accounts, cards);
    expect(loan[0]).toMatchObject({ type: 'debt', spentMinor: 100_000, earnedMinor: 0 });
    expect(totals(loan)).toEqual({ count: 1, spentMinor: 100_000, incomeMinor: 0 });
    expect(dayTotal(loan)).toBe(-100_000);
    // A loan with no fee still adds nothing at all.
    const plain = buildRows([tx('2026-09-12', 'Lent to Dina', [['friend', 4_000_000], ['bca', -4_000_000]])], [], accounts, cards);
    expect(totals(plain)).toEqual({ count: 1, spentMinor: 0, incomeMinor: 0 });
  });

  it('adds a foreign purchase in the workspace currency', () => {
    const baht = buildRows([tx('2026-09-12', 'Bangkok taxi', [['groceries', 50000, 2250000], ['octo', -50000, -2250000]])], [], accounts, cards);
    expect(totals(baht)).toEqual({ count: 1, spentMinor: 2250000, incomeMinor: 0 });
  });
});

describe('groupByCategory', () => {
  const row = (over: Partial<ListRow>): ListRow => ({
    id: over.id ?? 'r',
    kind: 'tx',
    date: '2026-09-15',
    description: 'row',
    amountMinor: 0,
    currency: 'IDR',
    baseMinor: 0,
    type: 'expense',
    categoryId: null,
    categoryName: null,
    parentName: null,
    accountIds: [],
    accountLabel: '',
    cardId: null,
    last4: null,
    holderName: null,
    deleted: false,
    excluded: false,
    needs: [],
    // As `buildRows` derives them: an expense or an income is spent or earned whole.
    spentMinor: (over.type ?? 'expense') === 'expense' ? (over.baseMinor ?? 0) : 0,
    earnedMinor: over.type === 'income' ? (over.baseMinor ?? 0) : 0,
    ...over,
  });

  it('gathers rows by category, largest first', () => {
    const groups = groupByCategory([
      row({ id: 'a', categoryId: 'fuel', categoryName: 'Fuel cost', baseMinor: 400_000 }),
      row({ id: 'b', categoryId: 'groceries', categoryName: 'Groceries', baseMinor: 900_000 }),
      row({ id: 'c', categoryId: 'fuel', categoryName: 'Fuel cost', baseMinor: 100_000 }),
    ]);
    expect(groups.map((g) => [g.name, g.rows.length, g.totalMinor])).toEqual([
      ['Groceries', 1, 900_000],
      ['Fuel cost', 2, 500_000],
    ]);
  });

  it('keeps what has no category, without letting it count as spending', () => {
    const groups = groupByCategory([
      row({ id: 'a', categoryId: 'fuel', categoryName: 'Fuel cost', baseMinor: 100_000 }),
      row({ id: 'b', type: 'transfer', baseMinor: 5_000_000 }),
      row({ id: 'c', kind: 'draft', baseMinor: 0 }),
    ]);
    expect(groups.map((g) => [g.name, g.rows.length, g.totalMinor])).toEqual([
      ['Fuel cost', 1, 100_000],
      ['Transfers and other', 1, 0],
      ['Uncategorised', 1, 0],
    ]);
  });

  it('leaves a deleted row in its category but out of the total', () => {
    const groups = groupByCategory([
      row({ id: 'a', categoryId: 'fuel', categoryName: 'Fuel cost', baseMinor: 100_000 }),
      row({ id: 'b', categoryId: 'fuel', categoryName: 'Fuel cost', baseMinor: 999_000, deleted: true }),
    ]);
    expect(groups[0]).toMatchObject({ rows: expect.objectContaining({ length: 2 }), totalMinor: 100_000 });
  });
});

describe('a purchase marked "not my spending"', () => {
  it('leaves it out of the day, the totals and the category grouping, without leaving it out of the list', () => {
    const rows = buildRows(
      [
        tx('2026-09-17', 'Superindo', [['groceries', 250_000], ['bca', -250_000]]),
        tx('2026-09-17', 'iPhone for Mama', [['electronics', 18_999_000], ['bca', -18_999_000]], { excluded: true }),
      ],
      [],
      accounts,
      cards,
    );
    const [day] = groupByDay(rows);

    // The row is still there — faded and struck through, but there — and it still says what it cost.
    expect(day!.rows).toHaveLength(2);
    expect(rows.find((row) => row.description === 'iPhone for Mama')).toMatchObject({ excluded: true, baseMinor: 18_999_000 });

    // What it does not do is move a figure.
    expect(dayTotal(day!.rows)).toBe(-250_000);
    expect(totals(rows)).toMatchObject({ count: 1, spentMinor: 250_000 });
    expect(groupByCategory(rows).map((group) => [group.name, group.totalMinor])).toEqual([
      ['Groceries', 250_000],
      ['Electronics', 0],
    ]);
  });
});

describe('money back and rows waiting for a category', () => {
  const uncategorised = account('later', 'expense', 'category', { name: 'Uncategorised', systemKey: 'uncategorised' });
  const laterIn = account('later-in', 'income', 'category', { name: 'Uncategorised', systemKey: 'income.uncategorised' });
  const withLater = [...accounts, uncategorised, laterIn];
  byId.set(uncategorised.id, uncategorised);
  byId.set(laterIn.id, laterIn);

  it('reads a refund as money back: a negative spend that nets the day and the totals', () => {
    const rental = tx('2026-09-12', 'Car rental', [['electronics', 1_000_000], ['octo', -1_000_000]]);
    const back = tx('2026-09-12', 'Deposit back', [['octo', 450_000], ['electronics', -450_000]]);
    const built = buildRows([rental, back], [], accounts, cards);
    const refund = built.find((row) => row.id === back.id)!;
    expect(refund).toMatchObject({ type: 'expense', refund: true, amountMinor: -450_000, spentMinor: -450_000, earnedMinor: 0 });
    expect(built.find((row) => row.id === rental.id)!.refund).toBeFalsy();
    expect(totals(built)).toEqual({ count: 2, spentMinor: 550_000, incomeMinor: 0 });
    expect(dayTotal(built)).toBe(-550_000);
  });

  it('marks what was saved under Uncategorised, and the filter keeps only those', () => {
    const later = tx('2026-09-12', 'Something', [['later', 25_000], ['bca', -25_000]]);
    const laterIncome = tx('2026-09-12', 'Paid back', [['bca', 70_000], ['later-in', -70_000]]);
    const built = buildRows([later, laterIncome, superindo], [], withLater, cards);
    expect(built.filter((row) => row.needsCategory).map((row) => row.id)).toEqual([later.id, laterIncome.id]);
    expect(filterRows(built, { ...EMPTY_FILTERS, needsCategory: true }, withLater).map((row) => row.id)).toEqual([later.id, laterIncome.id]);
    expect(filterRows(built, EMPTY_FILTERS, withLater)).toHaveLength(3);
  });
});

describe('amountLook', () => {
  const one = (t: TransactionView) => buildRows([t], [], accounts, cards)[0]!;

  it('reads a purchase split with a person as spending: the own share, in red, as the day counts it', () => {
    // Rp 80.000 on the card: Rp 40.000 own share, Rp 40.000 that Dina owes.
    const split = one(tx('2026-09-12', 'Lunch', [['groceries', 40_000], ['friend', 40_000], ['octo', -80_000]]));
    expect(split).toMatchObject({ type: 'debt', amountMinor: 40_000, spentMinor: 40_000 });
    expect(amountLook(split)).toEqual({ sign: -1, plus: false, muted: false });
  });

  it('reads money a person paid back as money in, with a plus, muted: it is not income and adds nothing to the day', () => {
    const collection = one(tx('2026-09-12', 'Collection from Dina', [['bca', 40_000], ['friend', -40_000]]));
    expect(amountLook(collection)).toEqual({ sign: 0, plus: true, muted: true });
    expect(dayTotal([collection])).toBe(0);
  });

  it('leaves money lent out plain, and keeps a purchase, an income and a refund as they were', () => {
    expect(amountLook(one(tx('2026-09-12', 'Lent to Dina', [['friend', 40_000], ['bca', -40_000]])))).toEqual({ sign: 0, plus: false, muted: false });
    expect(amountLook(one(tx('2026-09-12', 'Superindo', [['groceries', 40_000], ['bca', -40_000]])))).toEqual({ sign: -1, plus: false, muted: false });
    expect(amountLook(one(tx('2026-09-12', 'Salary', [['bca', 40_000], ['salary', -40_000]])))).toEqual({ sign: 1, plus: false, muted: false });
    expect(amountLook(one(tx('2026-09-12', 'Refund', [['groceries', -40_000], ['bca', 40_000]])))).toEqual({ sign: 1, plus: true, muted: false });
  });
});

describe('paidWithLook', () => {
  const one = (t: TransactionView) => buildRows([t], [], accounts, cards)[0]!;

  it('shows a card only by its last four digits when they are known, not by its account name', () => {
    expect(paidWithLook(one(tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['octo', -40_000]], { cardId: 'c1' })))).toEqual({ name: '', last4: '1467' });
  });

  it('shows a card account’s only card by its digits when the purchase names no card, as Paid with offered it', () => {
    expect(paidWithLook(one(tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['nusa', -40_000]])))).toEqual({ name: '', last4: '4417' });
  });

  it('shows the primary card’s digits when the purchase named neither of an account’s two cards; a bank with a debit card keeps its name', () => {
    expect(paidWithLook(one(tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['octo', -40_000]])))).toEqual({ name: '', last4: '1467' });
    // No primary on record: the first card in use.
    const noPrimary = cards.map((card) => ({ ...card, isPrimary: false }));
    expect(buildRows([tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['octo', -40_000]])], [], accounts, noPrimary)[0]!.last4).toBe('1467');
    // A card named wins over the primary.
    expect(paidWithLook(one(tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['octo', -40_000]], { cardId: 'c2' })))).toEqual({ name: '', last4: '8802' });
    // A bank account is not its debit card: money out of it by transfer or QRIS was never the card's.
    expect(paidWithLook(one(tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['debit', -40_000]])))).toEqual({ name: 'Nusa Payroll', last4: null });
  });

  it('keeps the account name when the last four digits are not known', () => {
    expect(paidWithLook(one(tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['kantong', -40_000]])))).toEqual({ name: 'Kantong', last4: null });
  });

  it('reads money moving between two accounts as the digits alone where they are known', () => {
    expect(paidWithLook(one(tx('2026-09-12', 'Pay the card', [['octo', 40_000], ['bca', -40_000]], { cardId: 'c1' })))).toEqual({ name: 'BCA Tahapan → 1467', last4: null });
  });
});

describe('digits on each side of money moving between accounts', () => {
  // A bank account's own number and a wallet's phone come in by the same map; a card's digits are the card's.
  const digits = { bca: '0917', kantong: '5521' };
  const rows = (...txs: TransactionView[]) => buildRows(txs, [], accounts, cards, digits);

  it('puts each side’s digits alone, with no name: a bank’s number, a wallet’s phone, a card account’s only card', () => {
    const [topUp] = rows(tx('2026-09-12', 'Top up', [['kantong', 40_000], ['bca', -40_000]]));
    expect(topUp).toMatchObject({ accountLabel: '0917 → 5521', last4: null, sidesLast4: ['0917', '5521'] });
    const [byCard] = rows(tx('2026-09-12', 'Top up', [['kantong', 40_000], ['nusa', -40_000]]));
    expect(byCard).toMatchObject({ accountLabel: '4417 → 5521', sidesLast4: ['4417', '5521'] });
  });

  it('leaves a side without digits as its name alone, and a bank is never its debit card', () => {
    const [row] = rows(tx('2026-09-12', 'Move', [['debit', 40_000], ['bca', -40_000]]));
    expect(row).toMatchObject({ accountLabel: '0917 → Nusa Payroll', sidesLast4: ['0917'] });
    expect(paidWithLook(row!)).toEqual({ name: '0917 → Nusa Payroll', last4: null });
  });

  it('gives a named card’s digits to the account it is on, and no other card’s to the other side', () => {
    // CIMB Octo carries two cards: naming one says which; Nusa's only card is still a card, so it is not borrowed.
    const [row] = rows(tx('2026-09-12', 'Balance transfer', [['octo', 40_000], ['nusa', -40_000]], { cardId: 'c2' }));
    expect(row!.accountLabel).toBe('Nusa Voyager Travel → 8802');
    const [bank] = rows(tx('2026-09-12', 'Pay the card', [['octo', 40_000], ['bca', -40_000]], { cardId: 'c2' }));
    expect(bank!.accountLabel).toBe('0917 → 8802');
  });

  it('keeps a side’s name when it has no digits at all, and reads a transfer with neither side known by both names', () => {
    const [one] = rows(tx('2026-09-12', 'Move', [['debit', 40_000], ['kantong', -40_000]]));
    expect(one!.accountLabel).toBe('5521 → Nusa Payroll');
    const [none] = buildRows([tx('2026-09-12', 'Move', [['debit', 40_000], ['bca', -40_000]])], [], accounts, cards);
    expect(none!.accountLabel).toBe('BCA Tahapan → Nusa Payroll');
    expect(none!.accountLabel).toContain(' → ');
    expect(none!.accountLabel).not.toMatch(/\d{4}/);
  });

  it('keeps a row paid from one account as before: its digits alone, none in the label', () => {
    const [row] = rows(tx('2026-09-12', 'Mie Kuah', [['groceries', 40_000], ['bca', -40_000]]));
    expect(row).toMatchObject({ accountLabel: 'BCA Tahapan', last4: '0917' });
    expect(row!.sidesLast4).toBeUndefined();
  });

  it('is found by either side’s digits', () => {
    const built = rows(tx('2026-09-12', 'Top up', [['kantong', 40_000], ['bca', -40_000]]), salary);
    const ids = (q: string) => filterRows(built, { ...EMPTY_FILTERS, q }, accounts).map((row) => row.description);
    expect(ids('5521')).toEqual(['Top up']);
    // The bank's number finds the salary paid into it too: a row paid from one account shows those digits as well.
    expect(ids('0917')).toEqual(['Top up', 'September salary']);
    expect(ids('4417')).toEqual([]);
  });
});

describe('a card put away since', () => {
  const lunch = (cardId: string | null) => tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['octo', -40_000]], { cardId });

  it('keeps the digits and holder of an archived supplementary card on the rows that named it, and finds them by those digits only', () => {
    const withArchived: CardRow[] = [cards[0]!, { ...cards[1]!, archived: true }];
    const rows = buildRows([lunch('c2')], [], accounts, withArchived);
    expect(rows[0]).toMatchObject({ last4: '8802', holderName: 'Aisyah' });
    expect(filterRows(rows, { ...EMPTY_FILTERS, q: '1467' }, accounts)).toEqual([]);
  });

  it('keeps a replaced card’s old digits on the rows that named it, and gives the new card’s only to rows that named none', () => {
    const replaced: CardRow[] = [{ ...cards[2]!, archived: true }, { id: 'c5', accountId: 'nusa', last4: '9051', holderName: null, isPrimary: true }];
    const named = tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['nusa', -40_000]], { cardId: 'c3' });
    const unnamed = tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['nusa', -40_000]]);
    const [first, second] = buildRows([named, unnamed], [], accounts, replaced);
    expect(first!.last4).toBe('4417');
    expect(second!.last4).toBe('9051');
  });

  it('shows no digits at all for a card the list does not know, never another card’s', () => {
    const named = tx('2026-09-12', 'Kedai Mawar', [['groceries', 40_000], ['nusa', -40_000]], { cardId: 'gone' });
    expect(buildRows([named], [], accounts, cards)[0]!.last4).toBeNull();
    expect(buildRows([], [draft({ accountId: 'nusa', cardId: 'gone' })], accounts, cards)[0]!.last4).toBeNull();
  });
});

describe('a wallet’s phone digits on its rows', () => {
  const digits = { kantong: '5521' };
  const lunch = tx('2026-09-12', 'Mie Kuah Bu Ratmi', [['groceries', 40_000], ['kantong', -40_000]]);
  const topUp = tx('2026-09-12', 'Top up', [['kantong', 40_000], ['bca', -40_000]]);

  it('shows a purchase paid from the wallet as "···· 5521", the way a card is shown', () => {
    const [row] = buildRows([lunch], [], accounts, cards, digits);
    expect(row).toMatchObject({ last4: '5521', cardId: null });
    expect(paidWithLook(row!)).toEqual({ name: '', last4: '5521' });
  });

  it('shows a draft paid from the wallet the same way', () => {
    const [row] = buildRows([], [draft({ accountId: 'kantong' })], accounts, cards, digits);
    expect(row).toMatchObject({ last4: '5521' });
  });

  it('reads money moving into the wallet by the wallet’s digits, the other side by its name', () => {
    const [row] = buildRows([topUp], [], accounts, cards, digits);
    expect(paidWithLook(row!)).toEqual({ name: 'BCA Tahapan → 5521', last4: null });
  });

  it('finds the wallet’s rows by its digits, as a card’s are found', () => {
    const built = buildRows([lunch, salary], [], accounts, cards, digits);
    expect(filterRows(built, { ...EMPTY_FILTERS, q: '5521' }, accounts).map((row) => row.id)).toEqual([lunch.id]);
  });
});

describe('a fund account’s number digits on its rows', () => {
  // A broker's cash account: its digits come in by the same map as a bank account's own number (`accountNumberLast4s`).
  const withFund = [...accounts, account('rdn', 'asset', 'fund', { name: 'Sekuritas Contoh' })];
  const digits = { rdn: '5046' };
  // The shared `tx` reads names from the list above, so the fund's side is written over a stand-in bank's.
  const atFund = (t: TransactionView, i: number) => {
    t.entries[i] = { ...t.entries[i]!, accountId: 'rdn', accountName: 'Sekuritas Contoh', accountSubtype: 'fund' };
    return t;
  };
  const dividend = atFund(tx('2026-09-12', 'Dividen', [['debit', 125_000], ['salary', -125_000]]), 0);

  it('shows money received into it as "···· 5046", as a bank account’s is shown', () => {
    const [row] = buildRows([dividend], [], withFund, cards, digits);
    expect(row).toMatchObject({ last4: '5046', cardId: null });
    expect(paidWithLook(row!)).toEqual({ name: '', last4: '5046' });
  });

  it('reads money moved out of it to a bank by both sides’ digits', () => {
    const move = atFund(tx('2026-09-13', 'Tarik dana', [['bca', 500_000], ['debit', -500_000]]), 1);
    const [row] = buildRows([move], [], withFund, cards, { ...digits, bca: '0917' });
    expect(paidWithLook(row!)).toEqual({ name: '5046 → 0917', last4: null });
  });
});

describe('amountExtraParts', () => {
  const foreign = { originalCurrency: 'JPY', originalAmountMinor: 1850 };
  const plain = { originalCurrency: null, originalAmountMinor: null };
  const line = (parts: { text: string }[]) => parts.map((part) => part.text).join(' · ');

  it('puts the foreign amount first and the points after it, on one line', () => {
    const parts = amountExtraParts(foreign, { points: 38, unit: 'pts', approximate: false });
    expect(line(parts)).toBe('JP¥1.850 · +38 pts');
    expect(parts.map((part) => part.tone)).toEqual(['foreign', 'earned']);
  });

  it('shows either part alone when only one applies, and nothing when neither does', () => {
    expect(line(amountExtraParts(foreign, undefined))).toBe('JP¥1.850');
    expect(line(amountExtraParts(plain, { points: 1200, unit: 'miles', approximate: false }))).toBe('+1.200 miles');
    expect(amountExtraParts(plain, undefined)).toEqual([]);
  });

  it('marks points taken back with a minus and estimated points with ≈, as before', () => {
    expect(amountExtraParts(plain, { points: -38, unit: 'pts', approximate: false })).toEqual([{ text: '−38 pts', tone: 'lost' }]);
    expect(amountExtraParts(plain, { points: 38, unit: 'pts', approximate: true })).toEqual([{ text: '≈ 38 pts', tone: 'earned' }]);
  });

  it('reads a transfer’s fee under the amount, muted, before a foreign amount; a row with none says nothing of it', () => {
    expect(amountExtraParts(plain, undefined, { feeMinor: 10_000, currency: 'IDR' })).toEqual([{ text: '+ Rp\u00a010.000', label: 'Fee, Rp\u00a010.000', tone: 'foreign' }]);
    expect(line(amountExtraParts(foreign, { points: 38, unit: 'pts', approximate: false }, { feeMinor: 10_000, currency: 'IDR' }))).toBe('+ Rp\u00a010.000 · JP¥1.850 · +38 pts');
    expect(amountExtraParts(plain, undefined, { currency: 'IDR' })).toEqual([]);
  });
});

describe('a transfer with a fee', () => {
  // GoPay topped up from BCA: Rp 1.000.000 lands, Rp 10.000 is charged on top and filed as spending.
  const topUp = tx('2026-09-12', 'GoPay top-up', [['kantong', 1_000_000], ['groceries', 10_000], ['bca', -1_010_000]]);

  it('names both accounts without the fee, which the row carries for the line under its amount', () => {
    const [row] = buildRows([topUp], [], accounts, cards);
    expect(row).toMatchObject({ type: 'transfer', amountMinor: 1_000_000, accountLabel: 'BCA Tahapan → Kantong', feeMinor: 10_000 });
    expect(buildRows([salary], [], accounts, cards)[0]!.feeMinor).toBeUndefined();
  });

  it('still counts the fee as the day’s spending, and the transfer itself as nothing', () => {
    const rows = buildRows([topUp], [], accounts, cards);
    expect(rows[0]).toMatchObject({ spentMinor: 10_000, earnedMinor: 0 });
    expect(dayTotal(rows)).toBe(-10_000);
  });
});

describe('what the list model is built from', () => {
  it('imports no hooks and nothing from the database at run time: types only, so it stays a plain model', () => {
    const source = readFileSync(new URL('./list-model.ts', import.meta.url), 'utf8');
    const runtime = source.split('\n').filter((line) => line.startsWith('import ') && !line.startsWith('import type '));
    expect(runtime.filter((line) => /useCardPoints|@expanses\/db|purchase-points/.test(line))).toEqual([]);
  });
});

describe('opening balances and past purchases', () => {
  const opening = account('ob', 'equity', 'equity', { name: 'Opening Balances', systemKey: 'opening_balance' });
  const withOpening = [...accounts, opening];
  byId.set(opening.id, opening);

  it('are out of the list unless asked for, and the spending around them stays', () => {
    const start = tx('2026-09-01', 'Opening balance', [['bca', 5_000_000], ['ob', -5_000_000]]);
    const built = buildRows([start, superindo], [], withOpening, cards);
    expect(built.find((row) => row.id === start.id)!.type).toBe('opening');
    expect(filterRows(built, EMPTY_FILTERS, withOpening).map((row) => row.id)).toEqual([superindo.id]);
    expect(filterRows(built, { ...EMPTY_FILTERS, showOpening: true }, withOpening).map((row) => row.id).sort()).toEqual([start.id, superindo.id].sort());
  });
});

describe('a purchase split across workspaces', () => {
  const withOffice = [...accounts, account('office', 'expense', 'category', { name: 'Office supplies' })];
  const books = [
    { id: 'family', name: 'Family', kind: 'family' as const },
    { id: 'business', name: 'Business', kind: 'business' as const },
  ];
  // Invented: Rp 1.350.000 on the card, Rp 900.000 groceries for Family and Rp 450.000 office supplies for Business.
  const market = tx('2026-09-14', 'Pasar Sentosa', [['groceries', 900_000], ['groceries', 450_000], ['octo', -1_350_000]], { splitBooks: books });
  market.entries[0] = { ...market.entries[0]!, bookId: 'family' };
  market.entries[1] = { ...market.entries[1]!, accountId: 'office', accountName: 'Office supplies', bookId: 'business' };

  it('reads as its own part in each workspace, and keeps the whole purchase for the receipt and the edit', () => {
    const [family] = buildRows([market], [], withOffice, cards, {}, 'family');
    expect(family).toMatchObject({ type: 'expense', amountMinor: 900_000, baseMinor: 900_000, spentMinor: 900_000, categoryName: 'Groceries', accountLabel: 'CIMB Octo' });
    expect(family!.splitPart!.map((e) => e.accountId)).toEqual(['groceries', 'octo']);
    expect(family!.tx).toBe(market);
    expect(totals([family!]).spentMinor).toBe(900_000);
    const [business] = buildRows([market], [], withOffice, cards, {}, 'business');
    expect(business).toMatchObject({ amountMinor: 450_000, spentMinor: 450_000, categoryName: 'Office supplies' });
  });

  it('reads whole where no workspace is open: an account’s history, an event', () => {
    const [whole] = buildRows([market], [], withOffice, cards);
    expect(whole).toMatchObject({ amountMinor: 1_350_000, spentMinor: 1_350_000 });
    expect(whole!.splitPart).toBeUndefined();
  });

  it('is out of the totals in the workspace whose part is excluded, and only there (0090)', () => {
    const off = { ...market, splitBooks: [books[0]!, { ...books[1]!, excluded: true }] };
    const [family] = buildRows([off], [], withOffice, cards, {}, 'family');
    const [business] = buildRows([off], [], withOffice, cards, {}, 'business');
    expect(family!.excluded).toBe(false);
    expect(business!.excluded).toBe(true);
    expect(totals([family!]).spentMinor).toBe(900_000);
    expect(totals([business!]).spentMinor).toBe(0);
    // Read owner-wide it is out only once every part is.
    expect(buildRows([off], [], withOffice, cards)[0]!.excluded).toBe(false);
    expect(excludedHere({ splitBooks: books.map((book) => ({ ...book, excluded: true })) })).toBe(true);
  });
});

describe('a purchase with a part Not counted', () => {
  const notCounted = account('nc', 'equity', 'equity', { name: 'Not counted', systemKey: 'not_counted' });
  const withNotCounted = [...accounts, notCounted];
  byId.set(notCounted.id, notCounted);
  // Invented: Rp 4.500.000 on the card at Toko Sinar Jaya, Rp 4.000.000 of it groceries, Rp 500.000 in no workspace.
  const shop = tx('2026-09-15', 'Toko Sinar Jaya', [['groceries', 4_000_000], ['nc', 500_000], ['octo', -4_500_000]]);
  shop.entries[1] = { ...shop.entries[1]!, accountSystemKey: 'not_counted' };

  it('reads as its workspace’s part in that workspace, the Not counted part counted nowhere', () => {
    expect(hasNotCountedPart(shop)).toBe(true);
    const [row] = buildRows([shop], [], withNotCounted, cards, {}, 'family');
    expect(row).toMatchObject({ type: 'expense', amountMinor: 4_000_000, spentMinor: 4_000_000, categoryName: 'Groceries', excluded: false });
    expect(row!.splitPart!.map((e) => e.accountId)).toEqual(['groceries', 'octo']);
    expect(totals([row!]).spentMinor).toBe(4_000_000);
  });

  it('reads as the whole charge where no workspace is open, its spending still the counted part', () => {
    const [row] = buildRows([shop], [], withNotCounted, cards);
    expect(row).toMatchObject({ amountMinor: 4_500_000, spentMinor: 4_000_000 });
  });
});

describe('currency pockets on a row', () => {
  const at = '2026-10-20';
  const acct = (id: string, name: string, subtype: string, extra: Partial<AccountRow> = {}) =>
    ({ id, name, kind: 'asset', subtype, currency: 'IDR', parentId: null, archivedAt: null, systemKey: null, sortOrder: 0, ...extra }) as unknown as AccountRow;
  const accounts = [
    acct('cash', 'Cash', 'cash'), acct('cash-try', 'Cash · TRY', 'cash', { parentId: 'cash', currency: 'TRY' }),
    acct('bank', 'Valas Plus', 'bank'), acct('bank-usd', 'Valas Plus · USD', 'bank', { parentId: 'bank', currency: 'USD' }),
    acct('food', 'Food', 'food'),
  ];
  const spend = (id: string, from: string, fromName: string, currency: string) =>
    ({ id, occurredOn: at, description: 'Lunch', status: 'posted', cardId: null, createdAt: at, billMonth: null,
       entries: [
         { accountId: from, accountName: fromName, accountKind: 'asset', amountMinor: -1000, currency, amountBaseMinor: -1000 },
         { accountId: 'food', accountName: 'Food', accountKind: 'expense', amountMinor: 1000, currency, amountBaseMinor: 1000 },
       ] }) as unknown as TransactionView;
  it('names a cash pocket by its currency alone, and a bank pocket by its currency with the bank account number', () => {
    const rows = buildRows([spend('t1', 'cash-try', 'Cash · TRY', 'TRY'), spend('t2', 'bank-usd', 'Valas Plus · USD', 'USD')], [], accounts, [], { bank: '0917' }) as ListRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(paidWithLook(byId.get('t1')!)).toEqual({ name: 'TRY', last4: null });
    expect(paidWithLook(byId.get('t2')!)).toEqual({ name: 'USD', last4: '0917' });
  });
});

describe('a split with a line left out of the report (0096)', () => {
  const school = [
    ...accounts,
    account('tuition', 'expense', 'category', { name: 'Tuition fees' }),
    account('platform', 'expense', 'category', { name: 'Platform fee' }),
    account('books', 'expense', 'category', { name: 'Books' }),
  ];
  for (const a of school) byId.set(a.id, a);
  const mark = (t: TransactionView, ...ids: string[]): TransactionView => ({ ...t, entries: t.entries.map((e) => (ids.includes(e.accountId) ? { ...e, excluded: true } : e)) });
  // Invented: Rp 2.025.000 on the card, Rp 2.000.000 tuition left out of the report and Rp 25.000 platform fee counted.
  const fees = mark(tx('2026-09-20', 'School', [['tuition', 200_000_000], ['platform', 2_500_000], ['octo', -202_500_000]], { cardId: 'c1' }), 'tuition');

  it('reads as the counted line: its category, its amount, and the sum left out under it', () => {
    const [row] = buildRows([fees], [], school, cards);
    expect(row).toMatchObject({ categoryId: 'platform', categoryName: 'Platform fee', amountMinor: 2_500_000, spentMinor: 2_500_000, baseMinor: 2_500_000, excluded: false, description: 'School' });
    expect(row!.leftOut).toEqual({ names: ['Tuition fees'], amountMinor: 200_000_000 });
    expect(row!.moreCounted).toBe(0);
    expect(amountExtraParts(fees, undefined, row)).toEqual([{ text: '⊘ Rp 200.000.000', label: 'Excluded from report, Rp 200.000.000', tone: 'foreign' }]);
    expect(dayTotal([row!])).toBe(-2_500_000);
    expect(row!.tx).toBe(fees);
  });

  it('names the largest counted category and counts the others, summing every line left out', () => {
    const three = mark(tx('2026-09-20', 'School', [['tuition', 200_000_000], ['platform', 2_500_000], ['books', 30_000_000], ['electronics', 5_000_000], ['octo', -237_500_000]]), 'tuition', 'electronics');
    const [row] = buildRows([three], [], school, cards);
    expect(row).toMatchObject({ categoryName: 'Books', moreCounted: 1, amountMinor: 32_500_000, spentMinor: 32_500_000 });
    expect(row!.leftOut).toEqual({ names: ['Tuition fees', 'Electronics'], amountMinor: 205_000_000 });
    expect(amountExtraParts(three, undefined, row).map((p) => p.text)).toEqual(['⊘ Rp 205.000.000']);
  });

  it('a wholly excluded row reads as one left out entirely: grey, and the whole sum under it with ⊘', () => {
    // Invented: Rp 64.000 on the card, the whole purchase switched to Exclude from report.
    const whole = tx('2026-09-21', 'Dinner for the office', [['groceries', 64_000], ['octo', -64_000]], { cardId: 'c1', excluded: true });
    const [row] = buildRows([whole], [], school, cards);
    expect(row).toMatchObject({ excluded: true, amountMinor: 64_000 });
    expect(amountLook(row!)).toEqual({ sign: 0, plus: false, muted: true });
    expect(amountExtraParts(whole, undefined, row)).toEqual([{ text: '⊘ Rp\u00a064.000', label: 'Excluded from report, Rp\u00a064.000', tone: 'foreign' }]);
    // As a partial: the whole-charge foreign figure gives way to the ⊘ line; points still follow.
    const abroad = { ...whole, originalCurrency: 'JPY', originalAmountMinor: 720 };
    const [abroadRow] = buildRows([abroad], [], school, cards);
    expect(amountExtraParts(abroad, { points: 12, unit: 'pts', approximate: false }, abroadRow).map((p) => p.text)).toEqual(['⊘ Rp\u00a064.000', '+12 pts']);
    // Deleted keeps its own look: no ⊘ line, and the amount stays the amount.
    const gone = { ...whole, status: 'void' as const };
    const [goneRow] = buildRows([gone], [], school, cards);
    expect(amountExtraParts(gone, undefined, goneRow)).toEqual([]);
    expect(amountLook(goneRow!).muted).toBe(false);
    // Still out of the day's figure.
    expect(dayTotal([row!])).toBe(0);
  });

  it('an excluded transfer is never in the report: a plain row, its amount, no ⊘', () => {
    // Invented: Rp 750.000 moved from BCA to Kantong, with Exclude on, and a Rp 6.500 fee.
    const move = tx('2026-09-22', 'Top up', [['kantong', 750_000], ['groceries', 6_500], ['bca', -756_500]], { excluded: true });
    const [row] = buildRows([move], [], school, cards);
    expect(row).toMatchObject({ type: 'transfer', excluded: true, amountMinor: 750_000 });
    expect(wholeLeftOut(row!)).toBe(false);
    expect(amountLook(row!)).toEqual({ sign: 0, plus: false, muted: false });
    expect(amountExtraParts(move, undefined, row).map((p) => p.text)).toEqual(['+ Rp 6.500']);
  });

  it('an excluded refund reads Rp 0 in grey, its ⊘ sum without a minus', () => {
    // Invented: Rp 64.000 back on the card for a returned basket, the whole of it excluded.
    const back = tx('2026-09-23', 'Basket returned', [['groceries', -64_000], ['octo', 64_000]], { cardId: 'c1', excluded: true });
    const [row] = buildRows([back], [], school, cards);
    expect(row).toMatchObject({ refund: true, excluded: true, amountMinor: -64_000 });
    expect(amountLook(row!)).toEqual({ sign: 0, plus: false, muted: true });
    expect(amountExtraParts(back, undefined, row)).toEqual([{ text: '⊘ Rp 64.000', label: 'Excluded from report, Rp 64.000', tone: 'foreign' }]);
  });

  it('a balance list shows an excluded purchase as what it took from the account: full amount, its own colour, no ⊘', () => {
    const whole = tx('2026-09-21', 'Dinner for the office', [['groceries', 64_000], ['octo', -64_000]], { cardId: 'c1', excluded: true });
    const [row] = buildRows([whole], [], school, cards);
    expect(wholeLeftOut(row!, 'balance')).toBe(false);
    expect(amountLook(row!, 'balance')).toEqual({ sign: -1, plus: false, muted: false });
    expect(amountExtraParts(whole, undefined, { ...row!, view: 'balance' })).toEqual([]);
    // The report's view stays Option B.
    expect(wholeLeftOut(row!, 'report')).toBe(true);
  });

  it('keeps today’s look when every line is left out, or none is', () => {
    const all = mark(fees, 'platform');
    const [allRow] = buildRows([all], [], school, cards);
    expect(allRow!.leftOut).toBeUndefined();
    expect(allRow).toMatchObject({ amountMinor: 202_500_000, spentMinor: 0 });
    const whole = { ...fees, entries: fees.entries.map((e) => ({ ...e, excluded: undefined })), excluded: true };
    const [wholeRow] = buildRows([whole], [], school, cards);
    expect(wholeRow).toMatchObject({ excluded: true, amountMinor: 202_500_000 });
    expect(wholeRow!.leftOut).toBeUndefined();
    const none = tx('2026-09-20', 'School', [['tuition', 200_000_000], ['platform', 2_500_000], ['octo', -202_500_000]]);
    const [noneRow] = buildRows([none], [], school, cards);
    expect(noneRow).toMatchObject({ amountMinor: 202_500_000, categoryName: 'Tuition fees' });
    expect(noneRow!.leftOut).toBeUndefined();
  });

  it('reads the lines in their own currency, and hides the whole-charge foreign figure', () => {
    const usd = mark(tx('2026-09-20', 'Course', [['tuition', 10_000, 160_000_000], ['platform', 500, 8_000_000], ['octo', -10_500, -168_000_000]], { originalCurrency: 'USD', originalAmountMinor: 10_500 }), 'tuition');
    usd.entries = usd.entries.map((e) => ({ ...e, currency: 'USD' }));
    const [row] = buildRows([usd], [], school, cards);
    expect(row).toMatchObject({ currency: 'USD', amountMinor: 500, spentMinor: 8_000_000 });
    expect(row!.leftOut!.amountMinor).toBe(10_000);
    expect(amountExtraParts(usd, undefined, row).map((p) => p.text)).toEqual(['⊘ US$100,00']);
  });

  it('a line in another workspace stays that workspace’s part, and a line left out here still tags', () => {
    const two = [{ id: 'family', name: 'Family', kind: 'family' as const }, { id: 'business', name: 'Business', kind: 'business' as const }];
    const mixed = tx('2026-09-20', 'School', [['tuition', 200_000_000], ['platform', 2_500_000], ['books', 30_000_000], ['octo', -232_500_000]], { splitBooks: two });
    mixed.entries[0] = { ...mixed.entries[0]!, bookId: 'family', excluded: true };
    mixed.entries[1] = { ...mixed.entries[1]!, bookId: 'family' };
    mixed.entries[2] = { ...mixed.entries[2]!, bookId: 'business' };
    const [family] = buildRows([mixed], [], school, cards, {}, 'family');
    expect(family).toMatchObject({ categoryName: 'Platform fee', amountMinor: 2_500_000, spentMinor: 2_500_000 });
    expect(family!.leftOut!.names).toEqual(['Tuition fees']);
    const [business] = buildRows([mixed], [], school, cards, {}, 'business');
    expect(business).toMatchObject({ categoryName: 'Books', amountMinor: 30_000_000 });
    expect(business!.leftOut).toBeUndefined();
  });
});

describe('Cashflow history leaves events out', () => {
  const plain = tx('2026-09-05', 'Lunch', [['food', 40_000], ['bca', -40_000]]);
  const trip = tx('2026-09-06', 'Bali hotel', [['food', 900_000], ['bca', -900_000]], { eventId: 'bali' });

  it('drops event-tagged transactions, so the list is what the ring counts', () => {
    expect(outsideEvents([plain, trip], false).map((t) => t.description)).toEqual(['Lunch']);
  });

  it('keeps them when the workspace counts events in its caps (the ring counts them then)', () => {
    expect(outsideEvents([plain, trip], true)).toHaveLength(2);
  });

  it('leaves an event purchase out of a search too, since search reads the same rows', () => {
    const rows = buildRows(outsideEvents([plain, trip], false), [], accounts, cards, {}, undefined);
    expect(filterRows(rows, { ...EMPTY_FILTERS, month: 'all', q: 'hotel' }, accounts)).toEqual([]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, month: 'all', q: 'lunch' }, accounts)).toHaveLength(1);
  });
});

describe('Paid with lists only accounts with transactions', () => {
  const money = [account('cash', 'asset', 'cash', { name: 'Cash IDR' }), account('bca', 'asset', 'bank'), account('kantong', 'asset', 'ewallet')];
  it('hides an account with none, keeps the ones used', () => {
    expect(accountsWithTransactions(money, new Set(['bca', 'kantong'])).map((a) => a.id)).toEqual(['bca', 'kantong']);
  });
  it('keeps the account the filter is on even with none', () => {
    expect(accountsWithTransactions(money, new Set(['bca']), 'cash').map((a) => a.id)).toEqual(['cash', 'bca']);
  });
});

describe('categoryButtonLabel', () => {
  it('names the row, then what the marks on its icon say: workspace, refund, event', () => {
    expect(categoryButtonLabel('Superindo', {})).toBe('Category for Superindo');
    expect(categoryButtonLabel('Lakeside lunch', { eventName: 'Lake trip' })).toBe('Category for Lakeside lunch, Lake trip');
    expect(categoryButtonLabel('Shoes back', { workspace: 'Family', refund: true, eventName: 'Lake trip' })).toBe('Category for Shoes back, Family, refund, Lake trip');
  });
});

describe('a transfer named by its accounts', () => {
  const cash = account('cash', 'asset', 'cash', { name: 'Cash' });
  const cashTry = account('cash-try', 'asset', 'cash', { name: 'Cash · TRY', parentId: 'cash', currency: 'TRY' });
  const all = [...accounts, cash, cashTry, account('savings', 'asset', 'savings', { name: 'Tabungan Contoh' }), account('fee', 'expense', 'category', { name: 'Fees', systemKey: 'fees' })];
  const make = (lines: [string, number, number?][], currencies: Record<string, string> = {}) => {
    const t = tx('2026-10-04', 'Bank Contoh ATM', []);
    t.entries = lines.map(([accountId, amountMinor, base], i) => {
      const a = all.find((x) => x.id === accountId)!;
      return { id: `${t.id}e${i}`, accountId, accountName: a.name, accountKind: a.kind, accountSubtype: a.subtype, amountMinor, currency: currencies[accountId] ?? 'IDR', fxRateToBase: 1, amountBaseMinor: base ?? amountMinor, memo: null, spendCategoryId: null };
    });
    return buildRows([t], [], all, cards)[0]!;
  };

  it('reads a bank into Cash in another currency as a Cash withdrawal, the note and accounts staying in the grey line', () => {
    const row = make([['bca', -95000000], ['cash-try', 250000]], { 'cash-try': 'TRY' });
    expect(row).toMatchObject({ type: 'transfer', transferName: 'Cash withdrawal', description: 'Bank Contoh ATM' });
    expect(row.accountLabel).toContain('→');
  });

  it('keeps the name when a fee sits beside the transfer', () => {
    expect(make([['bca', -95000000], ['cash', 94900000], ['fee', 100000]])).toMatchObject({ transferName: 'Cash withdrawal', feeMinor: 100000 });
  });

  it('reads Cash into Cash in another currency as a Currency exchange, and Cash into a wallet as a Cash deposit', () => {
    expect(make([['cash', -95000000], ['cash-try', 250000]], { 'cash-try': 'TRY' }).transferName).toBe('Currency exchange');
    expect(make([['cash', -5000000], ['kantong', 5000000]]).transferName).toBe('Cash deposit');
  });

  it('reads a bank into a card as a Credit card payment, and a bank into a bank as a Bank transfer', () => {
    expect(make([['octo', 45000000], ['bca', -45000000]]).transferName).toBe('Credit card payment');
    expect(make([['bca', -5000000], ['savings', 5000000]]).transferName).toBe('Bank transfer');
  });

  it('leaves a wallet top-up and an ordinary purchase unnamed', () => {
    expect(make([['bca', -5000000], ['kantong', 5000000]]).transferName).toBeUndefined();
    expect(make([['groceries', 45000000], ['cash', -45000000]]).transferName).toBeUndefined();
  });

  /** A transfer to a partner (joint net worth §7.2): the bank out, the partner's hidden placeholder ('cash', listed nowhere here) in. */
  const toPartner = (placeholder: Partial<TransactionView['entries'][number]>, description = 'Sekolah Contoh') => {
    const t = tx('2026-10-31', description, []);
    t.entries = [
      { id: `${t.id}e0`, accountId: 'bca', accountName: 'BCA Tahapan', accountKind: 'asset', accountSubtype: 'bank', amountMinor: -180000000, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: -180000000, memo: null, spendCategoryId: null },
      { id: `${t.id}e1`, accountId: 'ph-dewi', accountName: 'Dewi', accountKind: 'asset', accountSubtype: 'cash', placeholder: true, amountMinor: 180000000, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: 180000000, memo: null, spendCategoryId: null, ...placeholder },
    ];
    return buildRows([t], [], all, cards)[0]!;
  };

  it('never reads a transfer to a partner as a Cash withdrawal: by the partner’s item when known, else plain Transfer', () => {
    const unknown = toPartner({});
    expect(unknown.transferName).toBeUndefined();
    // the grey line names both sides, the partner by name: nothing left dangling after the note
    expect(unknown.accountLabel).toBe('BCA Tahapan → Dewi');
    expect(toPartner({ partnerSubtype: 'bank' }).transferName).toBe('Bank transfer');
    expect(toPartner({ partnerSubtype: 'credit_card' }).transferName).toBe('Credit card payment');
  });
});

describe('transferNote', () => {
  const row = (type: ListRow['type'], description: string, transferName?: string) => ({ type, description, ...(transferName ? { transferName } : {}) });

  it('leaves off a transfer’s note that repeats its title, in any case, and the default Transfer', () => {
    expect(transferNote(row('transfer', 'Credit card payment', 'Credit card payment'))).toBe('');
    expect(transferNote(row('transfer', 'credit card payment ', 'Credit card payment'))).toBe('');
    expect(transferNote(row('transfer', 'Transfer', 'Cash withdrawal'))).toBe('');
    expect(transferNote(row('transfer', 'Transfer'))).toBe('');
  });

  it('keeps a different note, and every note on anything but a transfer', () => {
    expect(transferNote(row('transfer', 'Pay off October', 'Credit card payment'))).toBe('Pay off October');
    expect(transferNote(row('transfer', 'Credit card payment'))).toBe('Credit card payment');
    expect(transferNote(row('expense', 'Transfer'))).toBe('Transfer');
  });
});

describe('a partner’s transfer row', () => {
  const shared = (extra: Partial<SharedTransferRow> = {}): SharedTransferRow => ({
    transferId: 't1', bookId: 'b', occurredOn: '2026-10-08', amountMinor: 50000000, currency: 'IDR', description: 'Bank Contoh ATM', recordedBy: 'm', fromName: 'Rina Bank', toName: 'Rina Wallet', name: null, ...extra,
  });

  it('carries the name its two shared accounts make it, and none without one', () => {
    expect(sharedTransferRow(shared({ name: 'Cash withdrawal' })).transferName).toBe('Cash withdrawal');
    expect(sharedTransferRow(shared()).transferName).toBeUndefined();
  });
});

describe('card instalments (option C)', () => {
  // Invented: a laptop of Rp 12.000.000 on the CIMB Octo card, 12 × Rp 1.000.000 from December, statement day the 18th.
  const laptop = tx('2026-11-10', 'Laptop', [['electronics', 12_000_000], ['octo', -12_000_000]]);
  const line = { planId: 'p1', cardAccountId: 'octo', transactionId: laptop.id, description: 'Laptop', number: 1, of: 12, statementOn: '2026-12-18', categoryId: 'electronics', amountBaseMinor: 1_000_000 };

  it('counts the purchase nothing on its day when its plan spreads it each month', () => {
    const [row] = markSpread(buildRows([laptop], [], accounts, cards), new Map([[laptop.id, 12]]));
    expect(row).toMatchObject({ amountMinor: 12_000_000, spentMinor: 0, baseMinor: 0, spreadOver: 12 });
    expect(dayTotal([row!])).toBe(0);
    expect(totals([row!]).spentMinor).toBe(0);
  });

  it('lists each month’s instalment as spending in the purchase’s category, on its statement day', () => {
    const [row] = instalmentRows({ lines: [line], repayments: [] }, accounts, 'IDR');
    expect(row).toMatchObject({ date: '2026-12-18', type: 'expense', categoryId: 'electronics', categoryName: 'Electronics', spentMinor: 1_000_000, accountIds: ['octo'] });
    expect(row!.instalment).toEqual({ planId: 'p1', cardAccountId: 'octo', number: 1, of: 12, countMode: 'each_month', purchaseId: laptop.id });
    expect(dayTotal([row!])).toBe(-1_000_000);
    expect(filterRows([row!], { ...EMPTY_FILTERS, cat: 'electronics' }, accounts)).toHaveLength(1);
    expect(filterRows([row!], { ...EMPTY_FILTERS, paid: 'acct:octo' }, accounts)).toHaveLength(1);
    expect(filterRows([row!], { ...EMPTY_FILTERS, type: 'expense' }, accounts)).toHaveLength(1);
  });

  it('reads an investment’s instalment as Saving, never spending, and Cashflow leaves it to the card’s statement', () => {
    const { categoryId: _c, amountBaseMinor: amountMinor, ...rest } = line;
    const [row] = instalmentRows({ lines: [], repayments: [{ ...rest, amountMinor, investment: true }] }, accounts, 'IDR');
    expect(row).toMatchObject({ type: 'transfer', spentMinor: 0, amountMinor: 1_000_000, transferName: 'Saving' });
    expect(row!.instalment).toMatchObject({ investment: true });
    expect(filterRows([row!], EMPTY_FILTERS, accounts, true)).toEqual([]);
    expect(dayTotal([row!])).toBe(0);
  });
});
