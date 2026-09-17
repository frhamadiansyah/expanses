import { expenseLines, isoDate } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import {
  billDetail,
  createAccount,
  listAccounts,
  monthlyBills,
  personalBook,
  postTransaction,
  replaceTransaction,
  saveExpenseTemplate,
  skipBill,
  unskipBill,
  voidTransaction,
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
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const bill = (
    name: string,
    key: string,
    dayOfMonth: number,
    amountMinor: number | null,
    extra: { payByDay?: number | null; startsMonth?: string } = {},
  ) =>
    saveExpenseTemplate(database, ws, {
      name,
      categoryAccountId: category(key),
      moneyAccountId: bank.id,
      dayOfMonth,
      amountMinor,
      startsMonth: '2026-09',
      ...extra,
    });
  const pay = (templateId: string, key: string, occurredOn: string, amountMinor: number, billMonth?: string) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Bill',
      templateId,
      billMonth,
      lines: expenseLines({ categoryAccountId: category(key), paymentAccountId: bank.id, amountMinor, currency: 'IDR' }),
    });
  return { database, ws, bank, bill, pay };
}

it('says where each bill stands on the day, soonest pay-by first', async () => {
  const h = await household();
  const rent = await h.bill('Apartment rent', 'property.housing_rent', 1, 7_500_000);
  await h.bill('Biznet Home', 'utilities.internet_provider', 10, 395_000);
  await h.bill('Telkomsel Halo', 'utilities.mobile_phone', 1, 185_000, { payByDay: 17 });
  await h.bill('Fitness First', 'personal_care.sports_fitness', 25, 850_000);
  await h.bill('Tuition', 'utilities.mobile_phone', 1, 3_500_000, { payByDay: 25 });
  await h.pay(rent, 'property.housing_rent', '2026-09-03', 7_600_000);

  const bills = await monthlyBills(h.database, h.ws, '2026-09-15');
  expect(bills.map((b) => [b.name, b.state, b.days])).toEqual([
    ['Apartment rent', 'paid', 0],
    ['Biznet Home', 'overdue', 5],
    ['Telkomsel Halo', 'dueSoon', 2],
    ['Fitness First', 'upcoming', 10],
    ['Tuition', 'open', 10],
  ]);
  expect(bills[0]).toMatchObject({ billMonth: '2026-09', paidOn: '2026-09-03', paidMinor: 7_600_000 });
  expect(bills[1]).toMatchObject({ paidOn: null, paidMinor: null, paymentId: null, payableMonths: ['2026-09', '2026-10'] });
});

it('raises last month’s bill while it is unpaid, and moves on once a payment names it', async () => {
  const h = await household();
  const internet = await h.bill('Biznet Home', 'utilities.internet_provider', 28, 450_000, { payByDay: 5, startsMonth: '2026-08' });

  expect((await monthlyBills(h.database, h.ws, '2026-09-02'))[0]).toMatchObject({ billMonth: '2026-08', state: 'dueSoon', days: 3 });
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({
    billMonth: '2026-08',
    state: 'overdue',
    days: 3,
    payableMonths: ['2026-08', '2026-09', '2026-10'],
  });

  // Paid in September, for August.
  await h.pay(internet, 'utilities.internet_provider', '2026-09-08', 450_000, '2026-08');
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({
    billMonth: '2026-09',
    state: 'upcoming',
    days: 20,
    payableMonths: ['2026-09', '2026-10'],
  });
});

it('skipping last month’s unpaid bill moves the row on to this month', async () => {
  const h = await household();
  const internet = await h.bill('Biznet Home', 'utilities.internet_provider', 28, 450_000, { payByDay: 5, startsMonth: '2026-08' });
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({ billMonth: '2026-08', state: 'overdue' });

  await skipBill(h.database, h.ws, internet, '2026-08');
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({ billMonth: '2026-09', state: 'upcoming' });
});

it('a payment made early counts for the month it names', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', 'personal_care.sports_fitness', 25, 850_000);
  await h.pay(gym, 'personal_care.sports_fitness', '2026-08-30', 850_000, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]).toMatchObject({ state: 'paid', paidOn: '2026-08-30' });
});

it('a voided payment settles nothing', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', 'personal_care.sports_fitness', 3, 850_000);
  const paid = await h.pay(gym, 'personal_care.sports_fitness', '2026-09-03', 850_000);
  await voidTransaction(h.database, h.ws, paid);
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]).toMatchObject({ state: 'overdue', paymentId: null });
});

it('a corrected payment settles only the month the correction names', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', 'personal_care.sports_fitness', 3, 850_000, { startsMonth: '2026-08' });
  const paid = await h.pay(gym, 'personal_care.sports_fitness', '2026-09-03', 850_000, '2026-09');
  const all = await listAccounts(h.database, h.ws);
  const gymCategory = all.find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  // Re-filed under August: the September row left behind by the void must not keep September settled.
  await replaceTransaction(h.database, h.ws, paid, {
    occurredOn: '2026-09-03',
    description: 'Bill',
    billMonth: '2026-08',
    lines: expenseLines({ categoryAccountId: gymCategory, paymentAccountId: h.bank.id, amountMinor: 850_000, currency: 'IDR' }),
  });
  const detail = await billDetail(h.database, h.ws, gym, '2026-09-15');
  expect(detail.history.map((row) => [row.month, row.state])).toEqual([
    ['2026-09', 'overdue'],
    ['2026-08', 'paid'],
  ]);
  expect(detail.bill).toMatchObject({ billMonth: '2026-09', state: 'overdue', paymentId: null });
});

it('a skipped month stops being owed, and can be taken back', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', 'personal_care.sports_fitness', 3, 850_000);
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('overdue');

  await skipBill(h.database, h.ws, gym, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('skipped');
  // Skipping one month says nothing about the next.
  expect((await monthlyBills(h.database, h.ws, '2026-10-15'))[0]).toMatchObject({ billMonth: '2026-10', state: 'overdue' });
  await skipBill(h.database, h.ws, gym, '2026-09');

  await unskipBill(h.database, h.ws, gym, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('overdue');
});

it('estimates a bill that varies from what it came to last time', async () => {
  const h = await household();
  const pln = await h.bill('PLN electricity', 'utilities.electricity', 20, null, { startsMonth: '2026-08' });
  await h.pay(pln, 'utilities.electricity', '2026-08-22', 802_000);
  expect((await monthlyBills(h.database, h.ws, '2026-09-08'))[0]).toMatchObject({ billMonth: '2026-09', state: 'upcoming', amountMinor: null, estimateMinor: 802_000 });
});

it('lists a bill’s months newest first: what is coming, what is late, what was paid or skipped', async () => {
  const h = await household();
  const internet = await h.bill('Biznet Home', 'utilities.internet_provider', 28, 450_000, { payByDay: 5, startsMonth: '2026-06' });
  await h.pay(internet, 'utilities.internet_provider', '2026-06-29', 450_000);
  await h.pay(internet, 'utilities.internet_provider', '2026-08-04', 450_000, '2026-07');
  await skipBill(h.database, h.ws, internet, '2026-05');

  const detail = await billDetail(h.database, h.ws, internet, '2026-09-08');
  expect(detail.bill).toMatchObject({ billMonth: '2026-08', state: 'overdue', days: 3 });
  expect(detail.history.map((row) => [row.month, row.state])).toEqual([
    ['2026-09', 'upcoming'],
    ['2026-08', 'overdue'],
    ['2026-07', 'paid'],
    ['2026-06', 'paid'],
    ['2026-05', 'skipped'],
  ]);
  expect(detail.history[2]).toMatchObject({ paidOn: '2026-08-04', paidMinor: 450_000 });
  expect(detail.bookName).toBe((await personalBook(h.database, h.ws)).name);
  await expect(billDetail(h.database, h.ws, 'nope', '2026-09-08')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('holds its nerve when nothing recurring is set up', async () => {
  const h = await household();
  await expect(monthlyBills(h.database, h.ws, isoDate())).resolves.toEqual([]);
});
