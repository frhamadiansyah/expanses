import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import {
  type AccountRow,
  cardStatement,
  createAccount,
  createCardAccount,
  createDatabase,
  createWorkspace,
  listAccounts,
  migrate,
  nativeBalances,
  postTransaction,
  saveCardTerms,
} from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doorOfForm, spendingDoor } from '../goals/set-aside-question';
import { ratesForSave } from '../transactions/tx-save';
import { emptyForm, extraRows, formToPost, seeded } from '../transactions/tx-form';
import { CARD_PAY_NOTE, CARD_PAY_OMITS, cardPayFrom, cardPayLink, cardPaySeed } from './card-pay';
import { statementCover } from './statement-cover';

/*
 * A credit card's Pay used to be a sheet of its own on the card page ("Pay <card>", Record payment). It now opens the
 * Add screen in its Transfer layout, locked to paying the card (owner, 17 Nov 2026). What it records must not change:
 * these tests post the old sheet's call and the Add screen's call side by side and compare what each one wrote.
 *
 * Invented figures and names throughout. A card with a statement on the 20th: August is 21 Jul – 20 Aug.
 */
const AUGUST = statementCycleFor('2026-08-20', 20);
const TODAY = '2026-09-01';

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function setUp() {
  const executor = createNodeExecutor();
  closers.push(() => executor.close());
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const visa = await createCardAccount(database, ws, { name: 'Kartu Satu', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: visa.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Bank Satu', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 9_000_000, openedOn: '2026-07-01' });
  const accounts = await listAccounts(database, ws);
  const groceries = accounts.find((a) => a.systemKey === 'household.groceries')!.id;
  for (const [occurredOn, description, amountMinor] of [
    ['2026-08-02', 'Market', 412_000],
    ['2026-08-03', 'Ride', 185_000],
    ['2026-08-04', 'Shop', 649_000],
  ] as const) {
    await postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  }
  return { database, ws, visa, bank, accounts };
}

type SetUp = Awaited<ReturnType<typeof setUp>>;

/** Exactly what the card page's old Pay sheet sent on Record payment (CardHero's `PaySheet.pay()`, before 17 Nov 2026). */
async function oldRecordPayment({ database, ws, visa, bank }: SetUp, amountMinor: number, paidOn: string) {
  return postTransaction(database, ws, {
    occurredOn: paidOn,
    description: `${visa.name} payment`,
    lines: transferLines({ fromAccountId: bank.id, toAccountId: visa.id, amountMinor, currency: 'IDR' }),
    setAside: null,
    fileTransfer: true,
  });
}

/** What the Add screen's Save sends for a new transfer (`TransactionCard.submit`, its plain `postTransaction` branch). */
async function newPay({ database, ws, visa, bank, accounts }: SetUp, amount: string, paidOn: string) {
  const draft = { ...emptyForm(ws.bookId ?? '', paidOn), mode: 'transfer' as const, ...seeded(cardPaySeed(visa.id, amount), accounts), moneyId: bank.id };
  const post = formToPost(draft, accounts);
  expect(post.kind).toBe('post');
  if (post.kind !== 'post') throw new Error('not a plain post');
  const ratesToBase = await ratesForSave({
    database, ws, draft, post, accounts, rateDate: paidOn, needsRate: null,
    resolveRates: vi.fn(async () => ({ rates: {}, missing: [] })), onMissing: vi.fn(), where: 'Add more details',
  });
  return postTransaction(database, ws, { ...post.input, ratesToBase, setAside: null, settledBeforeApp: false });
}

/** Every table's row count, so a write the one path makes and the other does not (sync's outbox included) shows. */
async function tableCounts(database: SetUp['database']) {
  const tables = (await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).map(([name]) => name);
  const counts: Record<string, number> = {};
  for (const name of tables) counts[name] = (await database.db.values<[number]>(sql.raw(`SELECT COUNT(*) FROM "${name}"`)))[0]![0];
  return counts;
}

/** Rows of a table as objects: `values` reads arrays, `PRAGMA table_info` names their columns. */
async function rowsOf(database: SetUp['database'], table: string, where: string, id: string) {
  const columns = (await database.db.values<[number, string]>(sql.raw(`PRAGMA table_info("${table}")`))).map((column) => column[1]);
  const rows = await database.db.values<unknown[]>(sql`SELECT * FROM ${sql.raw(`"${table}"`)} WHERE ${sql.raw(where)} = ${id}`);
  return rows.map((row) => Object.fromEntries(columns.map((name, i) => [name, row[i]])));
}

/** The payment's own rows, ids and clock times left out: what the ledger holds about it. */
async function written(database: SetUp['database'], id: string) {
  const [tx] = await rowsOf(database, 'transactions', 'id', id);
  const { id: _id, created_at: _c, description, updated_at: _u, ...rest } = tx!;
  const entries = (await rowsOf(database, 'entries', 'transaction_id', id))
    .map(({ id: _e, transaction_id: _t, created_at: _ec, updated_at: _eu, ...line }) => line)
    .sort((a, b) => Number(a.amount_minor) - Number(b.amount_minor));
  return { description, rest, entries };
}

describe('a card’s Pay, now the Add screen, records exactly what Record payment did', () => {
  it('writes the same transaction, the same lines and the same rows everywhere else (sync’s outbox included)', async () => {
    const before = await setUp();
    const after = await setUp();
    expect(await tableCounts(after.database)).toEqual(await tableCounts(before.database));

    const oldId = await oldRecordPayment(before, 1_246_000, '2026-08-28');
    const newId = await newPay(after, '1246000', '2026-08-28');

    const was = await written(before.database, oldId);
    const now = await written(after.database, newId);
    // The one difference is the words: the card's name was the note; the note is now "Credit card payment".
    expect(was.description).toBe('Kartu Satu payment');
    expect(now.description).toBe(CARD_PAY_NOTE);
    const ids = (s: SetUp) => (row: Record<string, unknown>) => ({ ...row, workspace_id: 'ws', account_id: row.account_id === s.bank.id ? 'bank' : row.account_id === s.visa.id ? 'card' : row.account_id });
    expect(now.entries.map(ids(after))).toEqual(was.entries.map(ids(before)));
    expect(now.entries).toHaveLength(2);
    // Workspace-specific ids differ between the two databases; every other column is the same.
    const plain = (row: Record<string, unknown>) => ({ ...row, workspace_id: 'ws' });
    expect(plain(now.rest)).toEqual(plain(was.rest));
    const counts = await tableCounts(after.database);
    expect(counts).toEqual(await tableCounts(before.database));
    expect(Object.keys(counts)).toContain('sync_outbox');
  });

  it('covers the statement and moves the balances the same way, in full and in part', async () => {
    for (const [amountMinor, amount] of [[1_246_000, '1246000'], [500_000, '500000']] as const) {
      const before = await setUp();
      const after = await setUp();
      await oldRecordPayment(before, amountMinor, '2026-08-28');
      await newPay(after, amount, '2026-08-28');
      const statementOf = async (s: SetUp) => {
        const statement = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
        const cover = statementCover(statement);
        return {
          leftToPayMinor: statement.leftToPayMinor,
          cover: statement.lines.map((line) => ({ description: line.description, ...(({ by: _by, ...rest }) => rest)(cover.get(line.key) ?? { by: null }) })),
        };
      };
      expect(await statementOf(after)).toEqual(await statementOf(before));
      const balances = async (s: SetUp) => {
        const all = await nativeBalances(s.database, s.ws);
        return { card: all[s.visa.id], bank: all[s.bank.id] };
      };
      expect(await balances(after)).toEqual(await balances(before));
    }
  });

  it('asks the same set-aside question the sheet asked: the money leaving From, as spending', async () => {
    const s = await setUp();
    const draft = { ...emptyForm(s.ws.bookId ?? '', TODAY), mode: 'transfer' as const, ...seeded(cardPaySeed(s.visa.id, '1246000'), s.accounts), moneyId: s.bank.id };
    const post = formToPost(draft, s.accounts);
    expect(doorOfForm(draft, post, s.accounts, () => true)).toEqual(spendingDoor(s.bank.id, 1_246_000));
  });
});

describe('the Pay screen’s pieces', () => {
  const account = (over: Partial<AccountRow>): AccountRow => ({ id: 'x', name: 'X', kind: 'asset', subtype: 'bank', currency: 'IDR', ...over }) as AccountRow;

  it('opens the Add screen locked to the card, with the figure the card page shows', () => {
    expect(cardPayLink('card-1', 3_200_000, 'IDR')).toEqual({ to: '/transactions/new', search: { pay: 'card-1', amount: '3200000' } });
    // Nothing owed: the amount is left to be typed rather than filled with a nought.
    expect(cardPayLink('card-1', 0, 'IDR')).toEqual({ to: '/transactions/new', search: { pay: 'card-1' } });
  });

  it('fills To with the card and the note with “Credit card payment”, From left empty', () => {
    expect(cardPaySeed('card-1', '3200000')).toEqual({ toId: 'card-1', description: 'Credit card payment', amount: '3200000' });
    expect(cardPaySeed('card-1', undefined)).toEqual({ toId: 'card-1', description: 'Credit card payment' });
    expect(cardPaySeed('card-1', '1').moneyId).toBeUndefined();
  });

  it('offers From only in the card’s own currency, as the sheet did, so a payment never crosses currencies', () => {
    const card = account({ id: 'card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bca = account({ id: 'bca', currency: 'IDR' });
    const usd = account({ id: 'usd', currency: 'USD' });
    expect(cardPayFrom([bca, usd], card).map((a) => a.id)).toEqual(['bca']);
  });

  it('leaves Exclude from report out of Add more details: a card payment never counts in Cashflow anyway', () => {
    const s = { ...emptyForm('b', TODAY), mode: 'transfer' as const, toId: 'card', moneyId: 'bca' };
    expect(extraRows(s, [], { missingRate: null })).toContain('exclude');
    expect(extraRows(s, [], { missingRate: null }).filter((row) => !CARD_PAY_OMITS.includes(row))).toEqual(['photos']);
  });
});
