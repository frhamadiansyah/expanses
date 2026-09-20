import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import type { ListRow } from './list-model';
import { billTagOf, buildRows, dayTotal, draftNeeds, EMPTY_FILTERS, filterRows, groupByDay, sortRows, totals , groupByCategory } from './list-model';

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency: kind === 'expense' || kind === 'income' ? null : 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const accounts = [
  account('bca', 'asset', 'bank', { name: 'BCA Tahapan' }),
  account('octo', 'liability', 'credit_card', { name: 'CIMB Octo' }),
  account('friend', 'asset', 'receivable', { name: 'Dina' }),
  account('food', 'expense', 'category', { name: 'Food & Beverage', systemKey: 'food_beverage' }),
  account('groceries', 'expense', 'category', { name: 'Groceries', parentId: 'food', systemKey: 'groceries' }),
  account('salary', 'income', 'category', { name: 'Salary', systemKey: 'salary' }),
  account('electronics', 'expense', 'category', { name: 'Electronics', systemKey: 'electronics' }),
];
const byId = new Map(accounts.map((a) => [a.id, a]));
const cards: CardRow[] = [
  { id: 'c1', accountId: 'octo', last4: '1467', holderName: 'Fandrian', isPrimary: true },
  { id: 'c2', accountId: 'octo', last4: '8802', holderName: 'Aisyah', isPrimary: false },
];

let seq = 0;
function tx(date: string, description: string, lines: [string, number, number?][], extra: Partial<TransactionView> = {}): TransactionView {
  seq += 1;
  return {
    id: `t${seq}`, occurredOn: date, description, source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null,
    createdAt: `2026-09-01T00:00:${String(seq).padStart(2, '0')}Z`,
    entries: lines.map(([accountId, amountMinor, base], i) => ({
      id: `t${seq}e${i}`, accountId, accountName: byId.get(accountId)!.name, accountKind: byId.get(accountId)!.kind, amountMinor, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: base ?? amountMinor, memo: null, spendCategoryId: null,
    })),
    ...extra,
  };
}

function draft(extra: Partial<DraftRow>): DraftRow {
  return {
    id: 'd1', source: 'csv', status: 'pending', rawPayload: null, occurredOn: '2026-09-12', description: 'APOTEK K24', amountMinor: 8500000, currency: 'IDR', accountId: 'octo', categoryAccountId: null, cardId: null, confidence: null, externalRef: null, transactionId: null,
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

  it('calls money lent to a person lending, not a transfer, and gives it no base amount', () => {
    expect(find(lend.id)).toMatchObject({ type: 'debt', baseMinor: 0 });
    expect(find(pay.id)).toMatchObject({ type: 'transfer', accountLabel: 'CIMB Octo → BCA Tahapan' });
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

  it('files lending with transfers', () => {
    expect(ids({ type: 'transfer' })).toEqual(expect.arrayContaining([pay.id, lend.id]));
    expect(ids({ type: 'income' })).toEqual([salary.id]);
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

describe('billTagOf', () => {
  it('names the bill month of a payment made in another month, and nothing else', () => {
    const food: [string, number][] = [['food', 100], ['bca', -100]];
    expect(billTagOf(tx('2026-09-03', 'Biznet', food, { billMonth: '2026-08' }))).toBe('Aug bill');
    expect(billTagOf(tx('2026-09-03', 'Rent', food, { billMonth: '2026-09' }))).toBeNull();
    expect(billTagOf(tx('2026-09-03', 'Coffee', food, { billMonth: null }))).toBeNull();
    expect(billTagOf(tx('2026-09-03', 'Coffee', food))).toBeNull();
  });
});
