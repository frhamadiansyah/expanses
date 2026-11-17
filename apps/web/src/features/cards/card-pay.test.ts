import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import {
  type AccountRow,
  cardStatement,
  createAccount,
  createCardAccount,
  createDatabase,
  createWorkspace,
  listAccounts,
  listTransactions,
  migrate,
  nativeBalances,
  payCardPurchases,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  type SetAsideChoice,
} from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doorOfForm, spendingDoor } from '../goals/set-aside-question';
import { ratesForSave } from '../transactions/tx-save';
import { emptyForm, extraRows, formFromTransaction, formToPost, seeded } from '../transactions/tx-form';
import { CARD_PAY_NOTE, CARD_PAY_OMITS, cardPayFrom, offersTransferGoal, cardPayLink, cardPaySeed, isCardPayment, statementPayChoice, statementPayInput, statementPayLink, statementPaySeed } from './card-pay';
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

  it('offers no Goal row on any card payment — Pay, Edit payment, the statement’s Pay — while other new transfers keep it', () => {
    const transfer = { mode: 'transfer' as const };
    expect(offersTransferGoal(transfer, { editing: false, payCard: false, goals: 2 })).toBe(true);
    expect(offersTransferGoal(transfer, { editing: false, payCard: true, goals: 2 })).toBe(false);
    expect(offersTransferGoal(transfer, { editing: true, payCard: true, goals: 2 })).toBe(false);
    // As before: never on an edit, never with no goal, never on spending.
    expect(offersTransferGoal(transfer, { editing: true, payCard: false, goals: 2 })).toBe(false);
    expect(offersTransferGoal(transfer, { editing: false, payCard: false, goals: 0 })).toBe(false);
    expect(offersTransferGoal({ mode: 'expense' }, { editing: false, payCard: false, goals: 2 })).toBe(false);
  });

  it('leaves Exclude from report out of Add more details: a card payment never counts in Cashflow anyway', () => {
    const s = { ...emptyForm('b', TODAY), mode: 'transfer' as const, toId: 'card', moneyId: 'bca' };
    expect(extraRows(s, [], { missingRate: null })).toContain('exclude');
    expect(extraRows(s, [], { missingRate: null }).filter((row) => !CARD_PAY_OMITS.includes(row))).toEqual(['photos']);
  });
});

describe('a saved card payment is recognised, so it opens as “Edit payment”', () => {
  const viewOf = async (s: SetUp, id: string) => (await listTransactions(s.database, s.ws, { id }))[0]!;

  it('knows a payment into the card from an own account, whichever way it was made', async () => {
    const s = await setUp();
    // The statement's chosen purchases, the old sheet's Record payment, and the Pay screen (with a fee beside it too).
    const market = (await listTransactions(s.database, s.ws)).find((tx) => tx.description === 'Market')!.id;
    const chosen = await payCardPurchases(s.database, s.ws, { cardAccountId: s.visa.id, fromAccountId: s.bank.id, occurredOn: '2026-08-24', purchaseTransactionIds: [market], today: TODAY });
    const recorded = await oldRecordPayment(s, 300_000, '2026-08-25');
    const paid = await newPay(s, '200000', '2026-08-26');
    const fees = s.accounts.find((a) => a.systemKey === 'miscellaneous.fees_charges')!.id;
    const withFee = { ...emptyForm(s.ws.bookId ?? '', '2026-08-27'), mode: 'transfer' as const, ...seeded(cardPaySeed(s.visa.id, '100000'), s.accounts), moneyId: s.bank.id, fee: '6500', feeCategoryId: fees };
    const feePost = formToPost(withFee, s.accounts);
    if (feePost.kind !== 'post') throw new Error('not a plain post');
    const feeId = await postTransaction(s.database, s.ws, { ...feePost.input, setAside: null });
    for (const id of [recorded, paid, feeId, chosen]) expect(isCardPayment(await viewOf(s, id))).toBe(true);
  });

  it('leaves every other transfer, and the card’s own spending, on the ordinary Edit transaction', async () => {
    const s = await setUp();
    const other = await createAccount(s.database, s.ws, { name: 'Bank Dua', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-07-01' });
    const wallet = await createAccount(s.database, s.ws, { name: 'Dompet', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-07-01' });
    const bankToBank = await postTransaction(s.database, s.ws, { occurredOn: '2026-08-20', description: 'Move', lines: transferLines({ fromAccountId: s.bank.id, toAccountId: other.id, amountMinor: 50_000, currency: 'IDR' }) });
    const cardToWallet = await postTransaction(s.database, s.ws, { occurredOn: '2026-08-20', description: 'Top up', lines: transferLines({ fromAccountId: s.visa.id, toAccountId: wallet.id, amountMinor: 50_000, currency: 'IDR' }) });
    const spending = (await listTransactions(s.database, s.ws)).find((tx) => tx.description === 'Market')!.id;
    for (const id of [bankToBank, cardToWallet, spending]) expect(isCardPayment(await viewOf(s, id))).toBe(false);
  });
});

/** The statement's chosen purchases, as the old "Pay N purchases" sheet worked them out (StatementPanel, before 17 Nov 2026). */
async function sheetChosen(s: SetUp, ids: readonly string[]) {
  const statement = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
  const cover = statementCover(statement);
  const coveredWhole = (key: string) => cover.get(key)?.whole === true;
  const payable = (line: (typeof statement.lines)[number]) =>
    line.owedMinor > 0 && line.spending && !line.paidBy && !line.paidOff && !line.instalment && !line.convertedTo && !coveredWhole(line.key);
  const chosen = statement.lines.filter((line) => ids.includes(line.transactionId) && payable(line));
  const leftOf = (line: (typeof chosen)[number]) => cover.get(line.key)?.leftMinor ?? line.owedMinor;
  return { statement, chosen, leftOf };
}

/** Exactly what the old sheet sent to `payCardPurchases` on "Pay Rp X". */
async function oldSheetInput(s: SetUp, ids: readonly string[], paidOn: string, setAside: SetAsideChoice | null) {
  const { chosen, leftOf } = await sheetChosen(s, ids);
  return {
    cardAccountId: s.visa.id,
    fromAccountId: s.bank.id,
    occurredOn: paidOn,
    purchaseTransactionIds: chosen.map((line) => line.transactionId),
    amountsMinor: Object.fromEntries(chosen.filter((line) => leftOf(line) !== line.owedMinor).map((line) => [line.transactionId, leftOf(line)])),
    today: TODAY,
    setAside,
  };
}

/** What the "Pay credit card" screen, opened from the statement, sends on Save: the screen's draft, From chosen. */
async function newStatementInput(s: SetUp, ids: readonly string[], paidOn: string, setAside: SetAsideChoice | null) {
  const statement = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
  const purchases = statementPayChoice(statement, ids);
  const draft = { ...emptyForm(s.ws.bookId ?? '', paidOn), mode: 'transfer' as const, ...seeded(statementPaySeed(s.visa.id, purchases, 'IDR'), s.accounts), moneyId: s.bank.id };
  // The screen's own check passes first: From, To and the figure make a plain transfer.
  expect(formToPost(draft, s.accounts).kind).toBe('post');
  return { draft, purchases, input: statementPayInput({ cardAccountId: s.visa.id, purchases, today: TODAY }, draft, setAside) };
}

const idsOf = async (s: SetUp, ...names: string[]) => {
  const all = await listTransactions(s.database, s.ws);
  return names.map((name) => all.find((tx) => tx.description === name)!.id);
};

describe('the statement’s Pay, now the Pay credit card screen, saves exactly what the “Pay N purchases” sheet saved', () => {
  it('sends payCardPurchases the same call, the note added, and writes the same rows (a purchase partly covered included)', async () => {
    const before = await setUp();
    const after = await setUp();
    // A lump payment first covers Market whole and Ride in part: Ride is then paid for what is left, Shop whole.
    for (const s of [before, after]) await oldRecordPayment(s, 500_000, '2026-08-25');
    const beforeIds = await idsOf(before, 'Ride', 'Shop');
    const afterIds = await idsOf(after, 'Ride', 'Shop');

    const old = await oldSheetInput(before, beforeIds, '2026-08-28', null);
    const { input, purchases } = await newStatementInput(after, afterIds, '2026-08-28', null);
    expect(purchases.map((p) => [p.description, p.leftMinor])).toEqual([['Ride', 97_000], ['Shop', 649_000]]);
    // The same call, id for id, with one addition: the screen's note.
    const swap = (id: string) => (id === after.visa.id ? before.visa.id : id === after.bank.id ? before.bank.id : beforeIds[afterIds.indexOf(id)] ?? id);
    const { description, ...rest } = input;
    expect(description).toBe(CARD_PAY_NOTE);
    expect({
      ...rest,
      cardAccountId: swap(rest.cardAccountId),
      fromAccountId: swap(rest.fromAccountId),
      purchaseTransactionIds: rest.purchaseTransactionIds.map(swap),
      amountsMinor: Object.fromEntries(Object.entries(rest.amountsMinor).map(([id, minor]) => [swap(id), minor])),
    }).toEqual(old);

    const oldId = await payCardPurchases(before.database, before.ws, old);
    const newId = await payCardPurchases(after.database, after.ws, input);
    const was = await written(before.database, oldId);
    const now = await written(after.database, newId);
    // The words differ: the sheet had none, so the ledger named it after the card; the screen sends its note.
    expect(was.description).toBe('Kartu Satu payment');
    expect(now.description).toBe(CARD_PAY_NOTE);
    const ids = (s: SetUp) => (row: Record<string, unknown>) => ({ ...row, workspace_id: 'ws', account_id: row.account_id === s.bank.id ? 'bank' : row.account_id === s.visa.id ? 'card' : row.account_id });
    expect(now.entries.map(ids(after))).toEqual(was.entries.map(ids(before)));
    expect({ ...now.rest, workspace_id: 'ws' }).toEqual({ ...was.rest, workspace_id: 'ws' });
    expect(await tableCounts(after.database)).toEqual(await tableCounts(before.database));
    // Only Shop, paid whole, is settled by the payment; Ride stays covered by the two payments together.
    const settled = async (s: SetUp, payment: string) => (await rowsOf(s.database, 'card_settlements', 'payment_transaction_id', payment)).map((row) => row.purchase_transaction_id);
    expect(await settled(before, oldId)).toEqual([beforeIds[1]]);
    expect(await settled(after, newId)).toEqual([afterIds[1]]);

    const shown = async (s: SetUp) => {
      const statement = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
      const cover = statementCover(statement);
      return { left: statement.leftToPayMinor, lines: statement.lines.map((line) => [line.description, !!line.paidBy, cover.get(line.key)?.whole ?? null]) };
    };
    expect(await shown(after)).toEqual(await shown(before));
    expect((await shown(after)).left).toBe(0);
  });

  it('asks the same set-aside question the sheet asked: the chosen purchases’ total leaving From, as spending', async () => {
    const s = await setUp();
    const ids = await idsOf(s, 'Market', 'Shop');
    const { draft } = await newStatementInput(s, ids, '2026-08-28', null);
    const post = formToPost(draft, s.accounts);
    expect(doorOfForm(draft, post, s.accounts, () => true)).toEqual(spendingDoor(s.bank.id, 412_000 + 649_000));
    // The answer given is passed on as given.
    const choice = { goalId: 'g' } as unknown as SetAsideChoice;
    expect(statementPayInput({ cardAccountId: s.visa.id, purchases: [], today: TODAY }, draft, choice).setAside).toBe(choice);
  });

  it('opens with From empty, To the card, the total of what is left and the note; the address names the purchases and the statement', async () => {
    const purchases = [
      { transactionId: 'a', description: 'Superindo', owedMinor: 450_000, leftMinor: 450_000 },
      { transactionId: 'b', description: 'Ranch Market', owedMinor: 80_000, leftMinor: 30_000 },
    ];
    expect(statementPaySeed('card-1', purchases, 'IDR')).toEqual({ toId: 'card-1', description: 'Credit card payment', amount: '480000' });
    expect(statementPayLink('card-1', { start: '2026-07-21', end: '2026-08-20' }, TODAY, ['a', 'b'])).toEqual({
      to: '/transactions/new',
      search: { pay: 'card-1', purchases: 'a,b', start: '2026-07-21', end: '2026-08-20', today: TODAY },
    });
    // A note cleared by hand is sent as it is: the ledger then names the payment after the card, as the sheet's did.
    expect(statementPayInput({ cardAccountId: 'card-1', purchases, today: TODAY }, { moneyId: 'bank', occurredOn: TODAY, description: '' }, null).description).toBe('');
  });
});

describe('editing a payment the statement made for chosen purchases (today’s behaviour, kept)', () => {
  it('moves the purchases’ “paid” with the edit; a smaller amount leaves them marked paid while the card still owes the difference', async () => {
    const s = await setUp();
    const [market, ride] = await idsOf(s, 'Market', 'Ride');
    const payment = await payCardPurchases(s.database, s.ws, { cardAccountId: s.visa.id, fromAccountId: s.bank.id, occurredOn: '2026-08-28', purchaseTransactionIds: [market!, ride!], today: TODAY });
    const view = (await listTransactions(s.database, s.ws, { id: payment }))[0]!;
    // The Edit payment screen saves through the one edit path: the draft read back, the amount changed, replaced.
    const draft = { ...formFromTransaction(view, s.accounts, s.ws.bookId ?? ''), amount: '400000', description: 'Paid less' };
    const post = formToPost(draft, s.accounts);
    if (post.kind !== 'post') throw new Error('not a plain post');
    const replaced = await replaceTransaction(s.database, s.ws, payment, { ...post.input, setAside: null });
    const statement = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
    const paidBy = Object.fromEntries(statement.lines.map((line) => [line.description, line.paidBy?.transactionId ?? null]));
    expect(paidBy).toEqual({ Market: replaced, Ride: replaced, Shop: null });
    // The balance is the ledger's: 1.246.000 charged, 400.000 paid. Market and Ride (597.000) still read paid.
    expect(statement.leftToPayMinor).toBe(846_000);
    expect((await nativeBalances(s.database, s.ws))[s.visa.id]).toBe(-846_000);
  });
});
