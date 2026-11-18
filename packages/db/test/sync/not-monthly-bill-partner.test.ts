import { describe, expect, it } from 'vitest';
import { categoryTotalsIn, listAccounts, listTransactions, recordBillPayments, saveExpenseTemplate } from '../../src/index';
import { Household, type Device } from './household';

/*
 * Not-monthly costs on a month's Cashflow (owner, 2026-11-18), in a shared workspace: a yearly or every-few-months bill
 * the partner paid reaches this phone linked to the same bill, with its repeat and its gap (`repeatEvery`), so the
 * month leaves it out here exactly as on the phone that paid it. Invented figures.
 */

async function internet(d: Device): Promise<string> {
  return (await listAccounts(d.database, d.ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
}

async function couple() {
  const home = new Household();
  const wife = await home.device('Wife');
  const husband = await home.device('Husband');
  await home.share(wife);
  await home.join(husband, wife);
  await home.settle();
  return { home, wife, husband };
}

const monthTotal = async (d: Device, leaveOutNotMonthly: boolean) =>
  (await categoryTotalsIn(d.database, d.ws, 'expense', '2026-11-01', '2026-11-30', { billMonths: true, leaveOutNotMonthly })).rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);

describe('a not-monthly bill the partner paid', () => {
  it('a yearly one is not monthly on this phone too: listed, and left out of the month when asked', async () => {
    const { home, wife, husband } = await couple();
    const bill = await saveExpenseTemplate(wife.database, wife.ws, {
      name: 'Domain and hosting', categoryAccountId: await internet(wife), moneyAccountId: wife.bank, amountMinor: 2_640_000, dayOfMonth: 4,
      repeat: 'yearly', repeatMonth: 11, startsMonth: '2026-11',
    });
    await home.settle();

    const [paid] = await recordBillPayments(husband.database, husband.ws, {
      paidOn: '2026-11-06', payments: [{ templateId: bill, billMonth: '2026-11', amountMinor: 2_640_000, moneyAccountId: husband.bank }],
    });
    await home.settle();

    for (const d of [husband, wife]) {
      const listed = await listTransactions(d.database, d.ws, { from: '2026-11-01', to: '2026-11-30' });
      expect(listed.find((tx) => tx.id === paid)?.notMonthlyBill).toBe(true);
      expect(await monthTotal(d, true)).toBe(0);
      expect(await monthTotal(d, false)).toBe(2_640_000);
    }
  });

  it('an every-6-months one paid on one phone reads not monthly on the other', async () => {
    const { home, wife, husband } = await couple();
    const bill = await saveExpenseTemplate(wife.database, wife.ws, {
      name: 'Router rental', categoryAccountId: await internet(wife), moneyAccountId: wife.bank, amountMinor: 1_470_000, dayOfMonth: 8,
      repeat: 'months', repeatMonth: 11, repeatEvery: 6, startsMonth: '2026-11',
    });
    await home.settle();

    const [paid] = await recordBillPayments(wife.database, wife.ws, {
      paidOn: '2026-11-09', payments: [{ templateId: bill, billMonth: '2026-11', amountMinor: 1_470_000 }],
    });
    await home.settle();

    for (const d of [wife, husband]) {
      const listed = await listTransactions(d.database, d.ws, { from: '2026-11-01', to: '2026-11-30' });
      expect(listed.find((tx) => tx.id === paid)?.notMonthlyBill).toBe(true);
      expect(await monthTotal(d, true)).toBe(0);
      expect(await monthTotal(d, false)).toBe(1_470_000);
    }
  });
});
