import { afterEach, describe, expect, it } from 'vitest';
import {
  billDetail,
  committedByCategory,
  createAccount,
  createDatabase,
  createWorkspace,
  listAccounts,
  listExpenseTemplates,
  listTransactions,
  migrate,
  MIGRATIONS,
  monthlyBills,
  recordBillPayments,
  saveExpenseTemplate,
  undoBillPayments,
  upsertRate,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
let executor: NodeExecutor | undefined;
afterEach(() => {
  current?.executor.close();
  executor?.close();
  current = undefined;
  executor = undefined;
});

async function setup() {
  current = await setupDb('IDR');
  const { database, ws } = current;
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
  const all = await listAccounts(database, ws);
  const category = all.find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const life = await saveExpenseTemplate(database, ws, {
    name: 'Life cover', categoryAccountId: category, moneyAccountId: bca.id, amountMinor: 12_000, dayOfMonth: 5, startsMonth: '2026-09', currency: 'SGD',
  });
  const plain = await saveExpenseTemplate(database, ws, {
    name: 'Biznet', categoryAccountId: category, moneyAccountId: bca.id, amountMinor: 450_000, dayOfMonth: 5, startsMonth: '2026-09',
  });
  return { database, ws, bca, wise, category, life, plain };
}

describe('a bill written in its own currency', () => {
  it('is saved with it, and a bill with none follows its payer as before', async () => {
    const h = await setup();
    const rows = await listExpenseTemplates(h.database, h.ws);
    expect(rows.find((r) => r.id === h.life)).toMatchObject({ currency: 'SGD', amountMinor: 12_000 });
    expect(rows.find((r) => r.id === h.plain)).toMatchObject({ currency: null });
  });

  it('an edit that does not mention the currency keeps it; null returns the bill to its payer', async () => {
    const h = await setup();
    const again = { id: h.life, name: 'Life cover', categoryAccountId: h.category, moneyAccountId: h.bca.id, amountMinor: 13_000, dayOfMonth: 5 };
    await saveExpenseTemplate(h.database, h.ws, again);
    expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.life)).toMatchObject({ currency: 'SGD', amountMinor: 13_000 });
    await saveExpenseTemplate(h.database, h.ws, { ...again, currency: 'USD' });
    expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.life)).toMatchObject({ currency: 'USD' });
    await saveExpenseTemplate(h.database, h.ws, { ...again, currency: null });
    expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.life)).toMatchObject({ currency: null });
  });

  it('refuses a currency the app does not know', async () => {
    const h = await setup();
    await expect(
      saveExpenseTemplate(h.database, h.ws, { name: 'X', categoryAccountId: h.category, moneyAccountId: h.bca.id, amountMinor: 1, dayOfMonth: 5, currency: 'ZZZ' }),
    ).rejects.toMatchObject({ code: 'CURRENCY' });
  });

  it('paid from a rupiah account posts what the bank charged, keeping the SGD figure as the original', async () => {
    const h = await setup();
    const [id] = await recordBillPayments(h.database, h.ws, {
      paidOn: '2026-09-05',
      payments: [{ templateId: h.life, billMonth: '2026-09', amountMinor: 12_000, chargedMinor: 1_510_000, moneyAccountId: h.bca.id }],
    });
    const [tx] = await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' });
    expect(tx).toMatchObject({ id, originalCurrency: 'SGD', originalAmountMinor: 12_000 });
    expect(tx!.entries.map((e) => [e.accountId, e.amountMinor, e.currency])).toEqual([
      [h.category, 1_510_000, 'IDR'],
      [h.bca.id, -1_510_000, 'IDR'],
    ]);
  });

  it('wants the charged figure when the currencies differ, and ignores it when they match', async () => {
    const h = await setup();
    await expect(
      recordBillPayments(h.database, h.ws, { paidOn: '2026-09-05', payments: [{ templateId: h.life, billMonth: '2026-09', amountMinor: 12_000 }] }),
    ).rejects.toMatchObject({ code: 'CHARGED_REQUIRED' });
    const [id] = await recordBillPayments(h.database, h.ws, {
      paidOn: '2026-09-05',
      payments: [{ templateId: h.plain, billMonth: '2026-09', amountMinor: 450_000, chargedMinor: 999 }],
    });
    const [tx] = await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' });
    expect(tx).toMatchObject({ id, originalCurrency: null, originalAmountMinor: null });
    expect(tx!.entries.map((e) => e.amountMinor)).toEqual([450_000, -450_000]);
  });

  it('a bill with no currency paid from another account follows that account, as it did', async () => {
    const h = await setup();
    await recordBillPayments(h.database, h.ws, {
      paidOn: '2026-09-05',
      payments: [{ templateId: h.plain, billMonth: '2026-09', amountMinor: 3_000, moneyAccountId: h.wise.id }],
      ratesToBase: { USD: 16_000 },
    });
    const [tx] = await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' });
    expect(tx).toMatchObject({ originalCurrency: null });
    expect(tx!.entries.map((e) => [e.amountMinor, e.currency])).toEqual([[3_000, 'USD'], [-3_000, 'USD']]);
  });

  it('an SGD bill paid from a USD account is charged in USD', async () => {
    const h = await setup();
    await recordBillPayments(h.database, h.ws, {
      paidOn: '2026-09-05',
      payments: [{ templateId: h.life, billMonth: '2026-09', amountMinor: 12_000, chargedMinor: 9_000, moneyAccountId: h.wise.id }],
      ratesToBase: { USD: 16_000 },
    });
    const [tx] = await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' });
    expect(tx).toMatchObject({ originalCurrency: 'SGD', originalAmountMinor: 12_000 });
    expect(tx!.entries.map((e) => [e.amountMinor, e.currency])).toEqual([[9_000, 'USD'], [-9_000, 'USD']]);
  });

  it('reads the payment back as what the bill came to and what was charged, and an undo owes the month again', async () => {
    const h = await setup();
    const ids = await recordBillPayments(h.database, h.ws, {
      paidOn: '2026-09-05',
      payments: [{ templateId: h.life, billMonth: '2026-09', amountMinor: 12_500, chargedMinor: 1_510_000 }],
    });
    const onTheDay = (await monthlyBills(h.database, h.ws, '2026-09-06')).find((b) => b.id === h.life)!;
    expect(onTheDay).toMatchObject({ state: 'paid', paidMinor: 12_500, paidCurrency: 'SGD', chargedMinor: 1_510_000, chargedCurrency: 'IDR', currency: 'SGD' });
    const history = (await billDetail(h.database, h.ws, h.life, '2026-09-06')).history.find((m) => m.month === '2026-09')!;
    expect(history).toMatchObject({ paidMinor: 12_500, paidCurrency: 'SGD', chargedMinor: 1_510_000, chargedCurrency: 'IDR' });

    await undoBillPayments(h.database, h.ws, ids);
    expect((await monthlyBills(h.database, h.ws, '2026-09-06')).find((b) => b.id === h.life)).toMatchObject({ state: expect.not.stringMatching(/paid/), paidMinor: null, chargedMinor: null });
  });

  it('a same-currency payment reads back as it did: the account’s money, nothing charged', async () => {
    const h = await setup();
    await recordBillPayments(h.database, h.ws, { paidOn: '2026-09-05', payments: [{ templateId: h.plain, billMonth: '2026-09', amountMinor: 450_000 }] });
    expect((await monthlyBills(h.database, h.ws, '2026-09-06')).find((b) => b.id === h.plain)).toMatchObject({
      paidMinor: 450_000, paidCurrency: 'IDR', chargedMinor: null, chargedCurrency: null,
    });
  });

  it('a varying SGD bill estimates from what it last came to in SGD, not what was charged', async () => {
    const h = await setup();
    const varying = await saveExpenseTemplate(h.database, h.ws, {
      name: 'Travel cover', categoryAccountId: h.category, moneyAccountId: h.bca.id, amountMinor: null, dayOfMonth: 5, startsMonth: '2026-08', currency: 'SGD',
    });
    await recordBillPayments(h.database, h.ws, { paidOn: '2026-08-05', payments: [{ templateId: varying, billMonth: '2026-08', amountMinor: 8_000, chargedMinor: 1_000_000 }] });
    expect((await monthlyBills(h.database, h.ws, '2026-09-06')).find((b) => b.id === varying)).toMatchObject({ amountMinor: null, estimateMinor: 8_000 });
  });

  it('counts toward a budget in the workspace’s money, at the rate on the day it comes out; with no rate it is named', async () => {
    const h = await setup();
    // The plain bill is 450 000 rupiah; the SGD bill is 120.00 SGD.
    const none = await committedByCategory(h.database, h.ws);
    expect(none.committed[h.category]).toBe(450_000);
    expect(none.missing).toEqual([expect.objectContaining({ currency: 'SGD' })]);

    await upsertRate(h.database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: '2020-01-01', rate: 12_500, source: 'manual', sourceDate: '2020-01-01' });
    const priced = await committedByCategory(h.database, h.ws);
    expect(priced.committed[h.category]).toBe(450_000 + 1_500_000);
    expect(priced.missing).toEqual([]);
  });
});

describe('a database stopped before 0098', () => {
  it('still saves, lists and pays a bill; the currency is simply not there', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version < 98));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
    const id = await saveExpenseTemplate(database, ws, { name: 'Biznet', categoryAccountId: category, moneyAccountId: bank.id, amountMinor: 450_000, dayOfMonth: 5, startsMonth: '2026-09', currency: 'SGD' });
    expect((await listExpenseTemplates(database, ws))[0]).toMatchObject({ id, currency: null });
    await recordBillPayments(database, ws, { paidOn: '2026-09-05', payments: [{ templateId: id, billMonth: '2026-09', amountMinor: 450_000 }] });
    expect((await monthlyBills(database, ws, '2026-09-06'))[0]).toMatchObject({ state: 'paid', paidMinor: 450_000 });
  });
});
