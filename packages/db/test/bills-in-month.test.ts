import { afterEach, describe, expect, it } from 'vitest';
import { billsInMonth, createAccount, createBook, inBook, listAccounts, personalBook, recordBillPayments, saveExpenseTemplate, skipBill } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-08-01' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const electricity = await saveExpenseTemplate(database, ws, {
    name: 'Electricity', categoryAccountId: category('utilities.electricity'), moneyAccountId: bca.id, amountMinor: 780_000, dayOfMonth: 20, payByDay: 25, startsMonth: '2026-09',
  });
  const insurance = await saveExpenseTemplate(database, ws, {
    name: 'Car insurance', categoryAccountId: category('utilities.internet_provider'), moneyAccountId: bca.id, amountMinor: 4_000_000, dayOfMonth: 10, startsMonth: '2026-01', repeat: 'yearly', repeatMonth: 3,
  });
  const gym = await saveExpenseTemplate(database, ws, {
    name: 'Gym', categoryAccountId: category('property.housing_rent'), moneyAccountId: bca.id, amountMinor: null, dayOfMonth: 5, startsMonth: '2026-09',
  });
  await recordBillPayments(database, ws, { paidOn: '2026-10-21', payments: [{ templateId: electricity, billMonth: '2026-10', amountMinor: 780_000 }] });
  await recordBillPayments(database, ws, { paidOn: '2026-10-05', payments: [{ templateId: gym, billMonth: '2026-10', amountMinor: 350_000 }] });
  await skipBill(database, ws, gym, '2026-11');
  return { database, ws, bca, electricity, insurance, gym };
}

describe('billsInMonth', () => {
  it('a month already paid', async () => {
    const h = await household();
    const rows = await billsInMonth(h.database, h.ws, '2026-10', '2026-11-11');
    expect(rows.find((r) => r.bill.id === h.electricity)).toMatchObject({ month: '2026-10', state: 'paid', paidOn: '2026-10-21', paidMinor: 780_000, estimateMinor: 780_000 });
  });

  it('the current month as it stands, with its pay window', async () => {
    const h = await household();
    const row = (await billsInMonth(h.database, h.ws, '2026-11', '2026-11-11')).find((r) => r.bill.id === h.electricity)!;
    expect(row.window.payBy).toBe('2026-11-25');
    expect(['open', 'upcoming']).toContain(row.state);
    expect((await billsInMonth(h.database, h.ws, '2026-11', '2026-11-22')).find((r) => r.bill.id === h.electricity)!.state).toBe('dueSoon');
  });

  it('a bill whose amount varies is estimated from its last payment', async () => {
    const h = await household();
    expect((await billsInMonth(h.database, h.ws, '2026-12', '2026-11-11')).find((r) => r.bill.id === h.gym)).toMatchObject({ state: 'upcoming', estimateMinor: 350_000 });
  });

  it('a skipped month says so', async () => {
    const h = await household();
    expect((await billsInMonth(h.database, h.ws, '2026-11', '2026-11-11')).find((r) => r.bill.id === h.gym)!.state).toBe('skipped');
  });

  it('nothing before a bill starts, and a yearly bill only in its own month', async () => {
    const h = await household();
    expect(await billsInMonth(h.database, h.ws, '2026-08', '2026-11-11')).toEqual([]);
    expect((await billsInMonth(h.database, h.ws, '2026-11', '2026-11-11')).some((r) => r.bill.id === h.insurance)).toBe(false);
    expect((await billsInMonth(h.database, h.ws, '2027-03', '2026-11-11')).some((r) => r.bill.id === h.insurance)).toBe(true);
  });

  it('only the open book’s bills', async () => {
    const h = await household();
    const personal = await personalBook(h.database, h.ws);
    const business = await createBook(h.database, h.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const office = await createAccount(h.database, inBook(h.ws, business), { name: 'Office rent', kind: 'expense', subtype: 'category', currency: null });
    const rent = await saveExpenseTemplate(h.database, inBook(h.ws, business), { name: 'Office', categoryAccountId: office.id, moneyAccountId: h.bca.id, amountMinor: 2_000_000, dayOfMonth: 1, startsMonth: '2026-09' });
    const inPersonal = (await billsInMonth(h.database, inBook(h.ws, personal.id), '2026-11', '2026-11-11')).map((r) => r.bill.id);
    expect(inPersonal).toContain(h.electricity);
    expect(inPersonal).not.toContain(rent);
    expect((await billsInMonth(h.database, inBook(h.ws, business), '2026-11', '2026-11-11')).map((r) => r.bill.id)).toEqual([rent]);
  });
});
