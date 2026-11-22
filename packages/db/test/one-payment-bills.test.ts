import { expenseLines, splitExpenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  billChoicesForPurchase,
  billOfPurchase,
  categoryIdsByKey,
  categoryTotalsBetween,
  createBook,
  inBook,
  personalBook,
  createAccount,
  createCardAccount,
  createDatabase,
  createWorkspace,
  LedgerError,
  listAccounts,
  listTransactions,
  migrate,
  MIGRATIONS,
  monthlyBills,
  postTransaction,
  RecurringError,
  recordBillPayments,
  recordBillsAsOnePayment,
  replaceTransaction,
  saveExpenseTemplate,
  undoActivity,
  activityOf,
  undoBillPayments,
  unlinkPurchaseFromBill,
  voidTransaction,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { notMonthlyBillPaymentsOf } from '../src/repos/bill-repeat';
import { setupDb, type TestDb } from './helpers';

/*
 * One payment, several bills (2026-11-22): a marketplace checkout pays the internet and two phone bills at once, and
 * the card shows one line. Invented bills, card and figures.
 */

let current: TestDb | undefined;
let executor: NodeExecutor | undefined;
afterEach(() => {
  current?.executor.close();
  executor?.close();
  current = undefined;
  executor = undefined;
});

const TODAY = '2026-11-22';

async function bills(database: Database, ws: WorkspaceContext) {
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const internetCategory = category('utilities.internet_provider');
  const phoneCategory = category('utilities.mobile_phone');
  const bank = await createAccount(database, ws, { name: 'Bank Contoh', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const card = (await createCardAccount(database, ws, { name: 'Kartu Contoh', subtype: 'credit_card', currency: 'IDR', last4: '4417' })).id;
  const save = (name: string, categoryAccountId: string, amountMinor: number, dayOfMonth: number) =>
    saveExpenseTemplate(database, ws, { name, categoryAccountId, moneyAccountId: bank.id, amountMinor, dayOfMonth, startsMonth: '2026-11' });
  const internet = await save('Internet', internetCategory, 385_000, 20);
  const phone = await save('Mobile phone', phoneCategory, 150_000, 25);
  const phone2 = await save('Mobile phone 2', phoneCategory, 100_000, 25);
  return { bank: bank.id, card, internet, phone, phone2, internetCategory, phoneCategory };
}

const NOVEMBER = (b: Awaited<ReturnType<typeof bills>>) => [
  { templateId: b.internet, billMonth: '2026-11', amountMinor: 385_000 },
  { templateId: b.phone, billMonth: '2026-11', amountMinor: 150_000 },
  { templateId: b.phone2, billMonth: '2026-11', amountMinor: 100_000 },
];

async function stateOf(database: Database, ws: WorkspaceContext, ids: string[]) {
  const list = await monthlyBills(database, ws, TODAY);
  return ids.map((id) => {
    const bill = list.find((b) => b.id === id)!;
    return { state: bill.state, paidMinor: bill.paidMinor, paymentId: bill.paymentId };
  });
}

const code = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (e) {
    if (e instanceof RecurringError || e instanceof LedgerError) return e.code;
    throw e;
  }
  return null;
};

describe('migration 0127', () => {
  it('keeps every bill link a version 126 database holds, and moves linked-device clocks and pending marks to the new key', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 126));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const b = await bills(older, ws);
    const [paid] = await recordBillPayments(older, ws, { paidOn: '2026-11-05', payments: [{ templateId: b.internet, billMonth: '2026-11', amountMinor: 385_000 }] });
    const bought = await postTransaction(older, ws, {
      occurredOn: '2026-11-06',
      description: 'Pulsa',
      lines: expenseLines({ categoryAccountId: b.phoneCategory, paymentAccountId: b.bank, amountMinor: 150_000, currency: 'IDR' }),
    });
    await older.db.run(sql`INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month) VALUES (${bought}, ${ws.workspaceId}, ${b.phone}, '2026-11')`);
    await older.db.run(sql`INSERT INTO self_clocks (tbl, pk, col, hlc) VALUES ('bill_payments', ${JSON.stringify([paid])}, '', 'h1')`);
    await older.db.run(sql`INSERT INTO self_pending (tbl, pk, cols) VALUES ('bill_payments', ${JSON.stringify([bought])}, '*'), ('bill_payments', '["gone"]', '-')`);
    const before = await older.db.values(sql`SELECT transaction_id, workspace_id, template_id, bill_month FROM bill_payments ORDER BY transaction_id`);

    expect(await migrate(older)).toEqual([127]);

    expect(await older.db.values(sql`SELECT transaction_id, workspace_id, template_id, bill_month FROM bill_payments ORDER BY transaction_id`)).toEqual(before);
    expect(await older.db.values(sql`SELECT name, pk FROM pragma_table_info('bill_payments') WHERE pk > 0 ORDER BY pk`)).toEqual([
      ['transaction_id', 1],
      ['template_id', 2],
      ['bill_month', 3],
    ]);
    expect(await older.db.values(sql`SELECT pk FROM self_clocks WHERE tbl = 'bill_payments'`)).toEqual([[JSON.stringify([paid, b.internet, '2026-11'])]]);
    expect(await older.db.values(sql`SELECT pk FROM self_pending WHERE tbl = 'bill_payments' ORDER BY seq`)).toEqual([[JSON.stringify([bought, b.phone, '2026-11'])], ['["gone"]']]);
    // The months read as they did.
    expect((await stateOf(older, ws, [b.phone])).map((s) => s.state)).toEqual(['paid']);
  });
});

describe('one payment of several bills', () => {
  it('is one transaction on the card, split by bill, and every bill reads paid with its own part', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    const ids = await recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, description: 'Bayar sekaligus', payments: NOVEMBER(b) });
    expect(ids).toHaveLength(1);
    const [payment] = ids;

    const listed = (await listTransactions(database, ws, {})).filter((t) => t.status === 'posted');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.description).toBe('Bayar sekaligus');
    expect(listed[0]!.entries.filter((e) => e.accountId === b.card).map((e) => e.amountMinor)).toEqual([-635_000]);
    expect(listed[0]!.bills?.map((bill) => bill.name)).toEqual(['Internet', 'Mobile phone', 'Mobile phone 2']);

    expect(await stateOf(database, ws, [b.internet, b.phone, b.phone2])).toEqual([
      { state: 'paid', paidMinor: 385_000, paymentId: payment },
      { state: 'paid', paidMinor: 150_000, paymentId: payment },
      { state: 'paid', paidMinor: 100_000, paymentId: payment },
    ]);
    expect(await billOfPurchase(database, ws, payment!)).toMatchObject({ templateId: b.internet, linked: false, count: 3 });
    // A Pay payment: no bill of it is let go by Unlink; Undo takes the whole payment back.
    expect(await code(unlinkPurchaseFromBill(database, ws, { transactionId: payment!, templateId: b.phone }))).toBe('NOT_LINKED');
  });

  it('says how many bills when no Note is given, and refuses a bill already paid, one bill alone and a foreign one', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    await recordBillPayments(database, ws, { paidOn: TODAY, payments: [{ templateId: b.phone2, billMonth: '2026-11', amountMinor: 100_000 }] });
    expect(await code(recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, payments: NOVEMBER(b) }))).toBe('ALREADY_SETTLED');
    expect(await code(recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, payments: NOVEMBER(b).slice(0, 1) }))).toBe('ONE_PAYMENT_FEW');
    const all = await listAccounts(database, ws);
    const cover = await saveExpenseTemplate(database, ws, {
      name: 'Life cover', categoryAccountId: all.find((a) => a.systemKey === 'utilities.water_sanitation')!.id, moneyAccountId: b.bank, amountMinor: 12_000,
      dayOfMonth: 5, startsMonth: '2026-11', currency: 'SGD',
    });
    expect(
      await code(recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, payments: [NOVEMBER(b)[0]!, { templateId: cover, billMonth: '2026-11', amountMinor: 12_000 }] })),
    ).toBe('ONE_PAYMENT_CURRENCY');
    // Nothing of the refused ones was written.
    expect((await listTransactions(database, ws, {})).filter((t) => t.status === 'posted')).toHaveLength(1);

    const [two] = await recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, payments: NOVEMBER(b).slice(0, 2) });
    expect((await listTransactions(database, ws, {})).find((t) => t.id === two)!.description).toBe('2 bills');
  });

  it('undone, voided or deleted, every bill it paid is owed again', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    const all = [b.internet, b.phone, b.phone2];
    const [first] = await recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, payments: NOVEMBER(b) });
    await undoBillPayments(database, ws, [first!]);
    expect((await stateOf(database, ws, all)).map((s) => s.state)).not.toContain('paid');

    const [second] = await recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, payments: NOVEMBER(b) });
    await voidTransaction(database, ws, second!);
    expect((await stateOf(database, ws, all)).map((s) => s.state)).not.toContain('paid');
  });

  it('an edit carries every bill to the new row; Undo of the edit and of a delete put every bill back', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    const all = [b.internet, b.phone, b.phone2];
    const [payment] = await recordBillsAsOnePayment(database, ws, { paidOn: TODAY, moneyAccountId: b.card, payments: NOVEMBER(b) });
    const lines = splitExpenseLines({
      paymentAccountId: b.card,
      currency: 'IDR',
      splits: [
        { categoryAccountId: b.internetCategory, amountMinor: 385_000 },
        { categoryAccountId: b.phoneCategory, amountMinor: 150_000 },
        { categoryAccountId: b.phoneCategory, amountMinor: 100_000 },
      ],
    });
    const edited = await replaceTransaction(database, ws, payment!, { occurredOn: TODAY, description: 'Tokopedia', lines });
    expect((await stateOf(database, ws, all)).map((s) => s.paymentId)).toEqual([edited, edited, edited]);

    // The edit undone: the first version again, with all three.
    const editLine = (await activityOf(database, ws)).find((line) => line.kind === 'edit')!;
    await undoActivity(database, ws, editLine.id);
    const back = (await stateOf(database, ws, all)).map((s) => s.paymentId);
    expect(new Set(back).size).toBe(1);
    expect(back[0]).not.toBe(edited);
    expect((await stateOf(database, ws, all)).map((s) => s.state)).toEqual(['paid', 'paid', 'paid']);

    // Deleted, then the delete undone.
    await voidTransaction(database, ws, back[0]!);
    expect((await stateOf(database, ws, all)).map((s) => s.state)).not.toContain('paid');
    const deleted = (await activityOf(database, ws)).find((line) => line.kind === 'delete')!;
    await undoActivity(database, ws, deleted.id);
    expect((await stateOf(database, ws, all)).map((s) => s.state)).toEqual(['paid', 'paid', 'paid']);
  });
});

describe('Undo of an edit that added a bill', () => {
  it('lets that bill go: an edit, and a move to another workspace', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    const lines = (categoryId: string) => expenseLines({ categoryAccountId: categoryId, paymentAccountId: b.card, amountMinor: 150_000, currency: 'IDR' });
    const bought = await postTransaction(database, ws, { occurredOn: TODAY, description: 'Pulsa', lines: lines(b.phoneCategory) });
    await replaceTransaction(database, ws, bought, { occurredOn: TODAY, description: 'Pulsa', lines: lines(b.phoneCategory), billLinks: [{ templateId: b.phone, billMonth: '2026-11' }] });
    expect((await stateOf(database, ws, [b.phone]))[0]!.state).toBe('paid');
    await undoActivity(database, ws, (await activityOf(database, ws)).find((line) => line.kind === 'edit')!.id);
    expect((await stateOf(database, ws, [b.phone]))[0]!.state).not.toBe('paid');

    // Moved to another workspace with the bill added; the move undone.
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['utilities.mobile_phone']!;
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))['utilities.mobile_phone']!;
    const at = inBook(ws, personal);
    const other = await postTransaction(database, at, { occurredOn: TODAY, description: 'Pulsa kantor', lines: lines(mine) });
    await replaceTransaction(database, at, other, { occurredOn: TODAY, description: 'Pulsa kantor', lines: lines(theirs), moveToBook: true, billLinks: [{ templateId: b.phone, billMonth: '2026-11' }] });
    expect((await stateOf(database, ws, [b.phone]))[0]!.state).toBe('paid');
    await undoActivity(database, ws, (await activityOf(database, ws, { kind: 'move' }))[0]!.id);
    expect((await stateOf(database, ws, [b.phone]))[0]!.state).not.toBe('paid');
  });
});

describe('a split saying its bills (the Split sheet’s Bill row)', () => {
  it('links a bill to a part of a new purchase and of an edit, lets one go when its part goes, and never pays a month twice', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    const lines = splitExpenseLines({
      paymentAccountId: b.card,
      currency: 'IDR',
      splits: [
        { categoryAccountId: b.internetCategory, amountMinor: 385_000 },
        { categoryAccountId: b.phoneCategory, amountMinor: 150_000 },
      ],
    });
    const bought = await postTransaction(database, ws, {
      occurredOn: TODAY,
      description: 'Tokopedia',
      lines,
      billLinks: [{ templateId: b.internet, billMonth: '2026-11' }],
    });
    expect((await stateOf(database, ws, [b.internet, b.phone])).map((s) => s.state === 'paid')).toEqual([true, false]);
    // A purchase linked only: each bill may be let go on its own.
    expect(await billOfPurchase(database, ws, bought)).toMatchObject({ templateId: b.internet, linked: true, count: 1 });

    const edited = await replaceTransaction(database, ws, bought, {
      occurredOn: TODAY,
      description: 'Tokopedia',
      lines,
      billLinks: [{ templateId: b.internet, billMonth: '2026-11' }, { templateId: b.phone, billMonth: '2026-11' }],
    });
    expect(await stateOf(database, ws, [b.internet, b.phone])).toEqual([
      { state: 'paid', paidMinor: 385_000, paymentId: edited },
      { state: 'paid', paidMinor: 150_000, paymentId: edited },
    ]);
    await unlinkPurchaseFromBill(database, ws, { transactionId: edited, templateId: b.phone, billMonth: '2026-11' });
    expect((await stateOf(database, ws, [b.internet, b.phone])).map((s) => s.state === 'paid')).toEqual([true, false]);

    // The edit names only the internet: the phone stays owed; and a bill paid elsewhere is refused, nothing written.
    await recordBillPayments(database, ws, { paidOn: TODAY, payments: [{ templateId: b.phone2, billMonth: '2026-11', amountMinor: 100_000 }] });
    const again = await code(
      replaceTransaction(database, ws, edited, { occurredOn: TODAY, description: 'Tokopedia', lines, billLinks: [{ templateId: b.phone2, billMonth: '2026-11' }] }),
    );
    expect(again).toBe('BILL_SETTLED');
    expect((await stateOf(database, ws, [b.internet])).map((s) => s.paymentId)).toEqual([edited]);
    const none = await replaceTransaction(database, ws, edited, { occurredOn: TODAY, description: 'Tokopedia', lines, billLinks: [] });
    expect((await stateOf(database, ws, [b.internet])).map((s) => s.state === 'paid')).toEqual([false]);
    expect(await billOfPurchase(database, ws, none)).toBeNull();
  });
});

describe('the bills a part may pay', () => {
  it('are the bills not paid for the purchase’s month, and the months the purchase itself pays', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    const bought = await postTransaction(database, ws, {
      occurredOn: TODAY,
      description: 'Tokopedia',
      lines: expenseLines({ categoryAccountId: b.internetCategory, paymentAccountId: b.card, amountMinor: 385_000, currency: 'IDR' }),
      billLinks: [{ templateId: b.internet, billMonth: '2026-11' }],
    });
    const names = async (transactionId: string | null) =>
      (await billChoicesForPurchase(database, ws, { purchasedOn: TODAY, transactionId, today: TODAY })).map((c) => `${c.name} ${c.billMonth}`);
    expect(await names(null)).toEqual(['Mobile phone 2026-11', 'Mobile phone 2 2026-11']);
    expect(await names(bought)).toEqual(['Internet 2026-11', 'Mobile phone 2026-11', 'Mobile phone 2 2026-11']);
  });
});

describe('which month and which Cashflow a payment of several bills counts in', () => {
  it('November’s bills paid together on 3 December count in November; bills of two months paid together count on the day paid', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    await recordBillsAsOnePayment(database, ws, { paidOn: '2026-12-03', moneyAccountId: b.card, payments: NOVEMBER(b).slice(0, 2) });
    const total = async (from: string, to: string) => (await categoryTotalsBetween(database, ws, 'expense', from, to, { billMonths: true })).reduce((sum, row) => sum + row.amountBaseMinor, 0);
    expect(await total('2026-11-01', '2026-11-30')).toBe(535_000);
    expect(await total('2026-12-01', '2026-12-31')).toBe(0);

    // Mobile phone 2 for November with Internet for December, on 3 January: no one month to move it to.
    await recordBillsAsOnePayment(database, ws, {
      paidOn: '2027-01-03', moneyAccountId: b.card,
      payments: [{ templateId: b.phone2, billMonth: '2026-11', amountMinor: 100_000 }, { templateId: b.internet, billMonth: '2026-12', amountMinor: 385_000 }],
    });
    expect(await total('2027-01-01', '2027-01-31')).toBe(485_000);
    expect(await total('2026-11-01', '2026-11-30')).toBe(535_000);
  });

  it('a payment of one month’s bills counts in that month; one with a yearly bill and a monthly one is a monthly payment', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const b = await bills(database, ws);
    const all = await listAccounts(database, ws);
    const domain = await saveExpenseTemplate(database, ws, {
      name: 'Domain', categoryAccountId: b.internetCategory, moneyAccountId: b.bank, amountMinor: 200_000, dayOfMonth: 10, startsMonth: '2026-10',
      repeat: 'yearly', repeatMonth: 11,
    } as Parameters<typeof saveExpenseTemplate>[2]);
    expect(all.length).toBeGreaterThan(0);
    const [both] = await recordBillsAsOnePayment(database, ws, {
      paidOn: TODAY, moneyAccountId: b.card,
      payments: [{ templateId: domain, billMonth: '2026-11', amountMinor: 200_000 }, { templateId: b.phone, billMonth: '2026-11', amountMinor: 150_000 }],
    });
    const hosting = await saveExpenseTemplate(database, ws, {
      name: 'Hosting', categoryAccountId: b.internetCategory, moneyAccountId: b.bank, amountMinor: 300_000, dayOfMonth: 10, startsMonth: '2026-10',
      repeat: 'yearly', repeatMonth: 11,
    } as Parameters<typeof saveExpenseTemplate>[2]);
    const [alone] = await recordBillPayments(database, ws, { paidOn: TODAY, payments: [{ templateId: hosting, billMonth: '2026-11', amountMinor: 300_000 }] });
    const notMonthly = await notMonthlyBillPaymentsOf(database.db, [both!, alone!]);
    expect(notMonthly.has(both!)).toBe(false);
    expect(notMonthly.has(alone!)).toBe(true);
  });
});
