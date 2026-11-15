import { describe, expect, it } from 'vitest';
import { listAccounts, memberPayerAccounts, monthlyBills, purchasePayers, recordBillPayments, saveExpenseTemplate } from '../../src/index';
import { Household, type Device } from './household';

/*
 * A bill in a shared workspace, paid by the partner from an account of their own (owner report 15 Nov: the paid row's
 * second line was empty). The payment reaches this phone posted against the partner's placeholder, which no list of
 * this phone's accounts holds: what it was paid with is the label the partner's phone gave it. Invented figures.
 */

const TODAY = '2026-11-15';

async function internet(d: Device): Promise<string> {
  return (await listAccounts(d.database, d.ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
}

describe('a bill the partner paid from an account of their own', () => {
  it('arrives paid, on the partner’s placeholder, with the label the partner’s phone named it by', async () => {
    const home = new Household();
    const wife = await home.device('Wife');
    const husband = await home.device('Husband');
    await home.share(wife);
    await home.join(husband, wife);
    await home.settle();
    const bill = await saveExpenseTemplate(wife.database, wife.ws, {
      name: 'Fibre', categoryAccountId: await internet(wife), moneyAccountId: wife.bank, amountMinor: 387_000, dayOfMonth: 4, startsMonth: '2026-11',
    });
    await home.settle();

    // The husband pays November's from his own bank account.
    const [paid] = await recordBillPayments(husband.database, husband.ws, {
      paidOn: '2026-11-06', payments: [{ templateId: bill, billMonth: '2026-11', amountMinor: 387_000, moneyAccountId: husband.bank }],
    });
    expect(paid).toBeDefined();
    await home.settle();

    const row = (await monthlyBills(wife.database, wife.ws, TODAY)).find((b) => b.id === bill)!;
    expect(row.state).toBe('paid');
    // The bill link and the payment are on this phone: the month reads paid, and names the account that paid it.
    expect(row.paymentId).not.toBeNull();
    expect(row.paidFromAccountId).not.toBeNull();
    // That account is the husband's placeholder, never one of the wife's own accounts — so a lookup in them finds nothing.
    const own = await listAccounts(wife.database, wife.ws);
    expect(own.some((a) => a.id === row.paidFromAccountId)).toBe(false);
    expect((await memberPayerAccounts(wife.database, wife.ws)).get(row.paidFromAccountId!)).toEqual({ name: 'Husband', self: false });
    // What it was paid with is the label the husband's phone recorded.
    const payers = await purchasePayers(wife.database, [row.paymentId!]);
    expect(payers[row.paymentId!]).toMatchObject({ paidLabel: 'Husband Bank', payerName: 'Husband', mine: false });
  });
});
