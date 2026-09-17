import { afterEach, expect, it } from 'vitest';
import {
  billDetail,
  createAccount,
  listAccounts,
  listTransactions,
  monthlyBills,
  recordBillPayments,
  saveExpenseTemplate,
  skipBill,
  undoBillPayments,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const internet = await saveExpenseTemplate(database, ws, {
    name: 'Biznet Home', categoryAccountId: category('utilities.internet_provider'), moneyAccountId: bca.id, amountMinor: 450_000, dayOfMonth: 28, payByDay: 5, startsMonth: '2026-08',
  });
  const rent = await saveExpenseTemplate(database, ws, {
    name: 'Apartment rent', categoryAccountId: category('property.housing_rent'), moneyAccountId: bca.id, amountMinor: 6_000_000, dayOfMonth: 1, startsMonth: '2026-09',
  });
  const pln = await saveExpenseTemplate(database, ws, {
    name: 'PLN electricity', categoryAccountId: category('utilities.electricity'), moneyAccountId: bca.id, amountMinor: null, dayOfMonth: 20, startsMonth: '2026-09',
  });
  const state = async (id: string, onDate: string) => (await monthlyBills(database, ws, onDate)).find((b) => b.id === id)!;
  return { database, ws, bca, jenius, category, internet, rent, pln, state };
}

it('records a payment on the day paid, for the month it names', async () => {
  const h = await household();
  const [id] = await recordBillPayments(h.database, h.ws, { paidOn: '2026-09-03', payments: [{ templateId: h.internet, billMonth: '2026-08', amountMinor: 450_000 }] });

  const [tx] = await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' });
  expect(tx).toMatchObject({ id, occurredOn: '2026-09-03', description: 'Biznet Home' });
  expect(tx!.entries.map((e) => [e.accountId, e.amountMinor])).toEqual([
    [h.category('utilities.internet_provider'), 450_000],
    [h.bca.id, -450_000],
  ]);
  expect(await h.state(h.internet, '2026-09-03')).toMatchObject({ billMonth: '2026-09', state: 'upcoming' });
  expect((await billDetail(h.database, h.ws, h.internet, '2026-09-03')).history.find((m) => m.month === '2026-08')).toMatchObject({ state: 'paid', paidOn: '2026-09-03' });
});

it('records several together, each for its own month and from its own account', async () => {
  const h = await household();
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-09-21',
    payments: [
      { templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 },
      { templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000, moneyAccountId: h.jenius.id },
    ],
  });
  expect(ids).toHaveLength(2);
  expect(await h.state(h.rent, '2026-09-21')).toMatchObject({ state: 'paid', paidMinor: 6_000_000 });
  expect(await h.state(h.pln, '2026-09-21')).toMatchObject({ state: 'paid', paidMinor: 812_000, estimateMinor: 812_000 });
  const [pln] = await listTransactions(h.database, h.ws, { accountId: h.jenius.id });
  expect(pln!.entries.find((e) => e.accountId === h.jenius.id)!.amountMinor).toBe(-812_000);
});

it('refuses a month already paid or skipped, and writes nothing from that batch', async () => {
  const h = await household();
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-09-02', payments: [{ templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 }] });
  await expect(
    recordBillPayments(h.database, h.ws, {
      paidOn: '2026-09-21',
      payments: [
        { templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000 },
        { templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 },
      ],
    }),
  ).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });
  expect((await h.state(h.pln, '2026-09-21')).state).not.toBe('paid');

  await skipBill(h.database, h.ws, h.pln, '2026-09');
  await expect(
    recordBillPayments(h.database, h.ws, { paidOn: '2026-09-21', payments: [{ templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000 }] }),
  ).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });
});

it('refuses what cannot be a bill payment', async () => {
  const h = await household();
  const one = (payment: Partial<Parameters<typeof recordBillPayments>[2]['payments'][number]>) =>
    recordBillPayments(h.database, h.ws, { paidOn: '2026-09-21', payments: [{ templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000, ...payment }] });
  await expect(one({ amountMinor: 0 })).rejects.toMatchObject({ code: 'AMOUNT_RANGE' });
  await expect(one({ billMonth: '2026-9' })).rejects.toMatchObject({ code: 'MONTH_FORMAT' });
  await expect(one({ templateId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(one({ moneyAccountId: h.category('property.housing_rent') })).rejects.toMatchObject({ code: 'NOT_A_WALLET' });
});

it('undo voids the payments, and the months are owed again', async () => {
  const h = await household();
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-09-21',
    payments: [
      { templateId: h.rent, billMonth: '2026-09', amountMinor: 6_000_000 },
      { templateId: h.pln, billMonth: '2026-09', amountMinor: 812_000 },
    ],
  });
  await undoBillPayments(h.database, h.ws, ids);
  expect((await h.state(h.rent, '2026-09-21')).state).toBe('overdue');
  expect((await h.state(h.pln, '2026-09-21')).state).toBe('overdue');
  expect(await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
});
