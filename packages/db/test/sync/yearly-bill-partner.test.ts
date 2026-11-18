import { describe, expect, it } from 'vitest';
import { categoryTotalsIn, listAccounts, listTransactions, recordBillPayments, saveExpenseTemplate } from '../../src/index';
import { Household, type Device } from './household';

/*
 * Yearly bills on a month's Cashflow (owner, 2026-11-18), in a shared workspace: a yearly bill the partner paid reaches
 * this phone linked to the same bill, so the month leaves it out here exactly as on the phone that paid it. Invented
 * figures.
 */

async function internet(d: Device): Promise<string> {
  return (await listAccounts(d.database, d.ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
}

describe('a yearly bill the partner paid', () => {
  it('is a yearly bill on this phone too: listed, and left out of the month when asked', async () => {
    const home = new Household();
    const wife = await home.device('Wife');
    const husband = await home.device('Husband');
    await home.share(wife);
    await home.join(husband, wife);
    await home.settle();
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
      expect(listed.find((tx) => tx.id === paid)?.yearlyBill).toBe(true);
      const month = (leaveOutYearlyBills: boolean) => categoryTotalsIn(d.database, d.ws, 'expense', '2026-11-01', '2026-11-30', { billMonths: true, leaveOutYearlyBills });
      expect((await month(true)).rows.reduce((sum, row) => sum + row.amountBaseMinor, 0)).toBe(0);
      expect((await month(false)).rows.reduce((sum, row) => sum + row.amountBaseMinor, 0)).toBe(2_640_000);
    }
  });
});
