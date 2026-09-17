import { expenseLines, isoDate } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import { createAccount, listAccounts, monthlyBills, postTransaction, saveExpenseTemplate, skipBill, unskipBill } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** Three bills: one paid, one whose day has gone, one still to come. */
async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const rent = category('property.housing_rent');
  const internet = category('utilities.internet_provider');
  const gym = category('personal_care.sports_fitness');
  const bill = (name: string, categoryAccountId: string, dayOfMonth: number, amountMinor: number | null) =>
    saveExpenseTemplate(database, ws, { name, categoryAccountId, moneyAccountId: bank.id, dayOfMonth, amountMinor });
  return { database, ws, bank, rent, internet, gym, bill };
}

it('says of each bill whether it is paid, owed now, or still to come', async () => {
  const h = await household();
  const rent = await h.bill('Apartment rent', h.rent, 1, 7_500_000);
  await h.bill('Biznet Home', h.internet, 10, 395_000);
  await h.bill('Fitness First', h.gym, 25, 850_000);

  await postTransaction(h.database, h.ws, {
    occurredOn: '2026-09-03',
    description: 'Apartment rent',
    templateId: rent,
    lines: expenseLines({ categoryAccountId: h.rent, paymentAccountId: h.bank.id, amountMinor: 7_600_000, currency: 'IDR' }),
  });

  const bills = await monthlyBills(h.database, h.ws, '2026-09-15');
  expect(bills.map((b) => [b.name, b.state])).toEqual([
    ['Apartment rent', 'paid'],
    ['Biznet Home', 'owed'],
    ['Fitness First', 'later'],
  ]);
  // Paid on the 3rd, for more than the template says: both are worth knowing.
  expect(bills[0]).toMatchObject({ paidOn: '2026-09-03', paidMinor: 7_600_000 });
  expect(bills[1]).toMatchObject({ paidOn: null, paidMinor: null });
});

it('a bill paid before its day still counts as paid', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', h.gym, 25, 850_000);
  await postTransaction(h.database, h.ws, {
    occurredOn: '2026-09-02',
    description: 'Fitness First',
    templateId: gym,
    lines: expenseLines({ categoryAccountId: h.gym, paymentAccountId: h.bank.id, amountMinor: 850_000, currency: 'IDR' }),
  });
  const [bill] = await monthlyBills(h.database, h.ws, '2026-09-15');
  expect(bill).toMatchObject({ state: 'paid', paidOn: '2026-09-02' });
});

it('a skipped month stops being owed, and can be taken back', async () => {
  const h = await household();
  const gym = await h.bill('Fitness First', h.gym, 3, 850_000);
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('owed');

  await skipBill(h.database, h.ws, gym, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('skipped');
  // Skipping one month says nothing about the next.
  expect((await monthlyBills(h.database, h.ws, '2026-10-15'))[0]!.state).toBe('owed');
  // And it is idempotent, so a second tap is not an error.
  await skipBill(h.database, h.ws, gym, '2026-09');

  await unskipBill(h.database, h.ws, gym, '2026-09');
  expect((await monthlyBills(h.database, h.ws, '2026-09-15'))[0]!.state).toBe('owed');
});

it('holds its nerve when nothing recurring is set up', async () => {
  const h = await household();
  await expect(monthlyBills(h.database, h.ws, isoDate())).resolves.toEqual([]);
});
