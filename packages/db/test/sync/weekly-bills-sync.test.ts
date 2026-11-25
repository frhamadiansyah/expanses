import { describe, expect, it, vi } from 'vitest';
import { billDetail, listAccounts, listExpenseTemplates, phonesBehindWeeklyBills, RecurringError, recordBillPayments, saveExpenseTemplate } from '../../src/index';
import { type Device, Household, skipsOf } from './household';

vi.setConfig({ testTimeout: 60_000 });

/*
 * Bills that repeat every few weeks (2026-11-25), between two phones sharing a workspace. Invented: the electricity
 * token, Rp 1.000.000 every 3 weeks, bought 3 Nov and 24 Nov 2026.
 */

const BUILD = '0.5.8';
const OLDER = '0.5.7';
const TOKEN = 1_000_000;

async function household(husbandVersion: string) {
  const home = new Household();
  const wife = await home.device('Wife', undefined, 'IDR', BUILD);
  const husband = await home.device('Husband', undefined, 'IDR', husbandVersion);
  await home.share(wife);
  await home.join(husband, wife);
  await home.settle();
  const electricity = (await listAccounts(wife.database, wife.ws)).find((a) => a.systemKey === 'utilities.electricity')!.id;
  return { home, wife, husband, electricity };
}

const weekly = (d: Device, categoryAccountId: string, id?: string) =>
  saveExpenseTemplate(d.database, d.ws, { id, name: 'Electricity', categoryAccountId, moneyAccountId: d.bank, amountMinor: TOKEN, dayOfMonth: 1, repeat: 'weeks', repeatEvery: 3, startsOn: '2026-11-03' });

describe('a weekly bill in a shared workspace', () => {
  it('reaches the other phone with both November payments, each on its own day', async () => {
    const { home, wife, husband, electricity } = await household(BUILD);
    const token = await weekly(wife, electricity);
    await home.settle();
    for (const paidOn of ['2026-11-03', '2026-11-24']) {
      await recordBillPayments(wife.database, wife.ws, { paidOn, payments: [{ templateId: token, billMonth: paidOn, amountMinor: TOKEN }] });
    }
    await home.settle();

    expect((await listExpenseTemplates(husband.database, husband.ws)).find((t) => t.id === token)).toMatchObject({ repeat: 'weeks', repeatEvery: 3, startsMonth: '2026-11', dayOfMonth: 3 });
    const there = await billDetail(husband.database, husband.ws, token, '2026-11-25');
    expect(there.history.map((r) => [r.month, r.paidOn, r.paidMinor])).toEqual([
      ['2026-11-24', '2026-11-24', TOKEN],
      ['2026-11-03', '2026-11-03', TOKEN],
    ]);
    expect(there.weeks?.nextDue).toBe('2026-12-15');
    expect(await skipsOf(husband.database)).toEqual([]);
  });

  it('two phones paying on different days in one month both keep their payment', async () => {
    const { home, wife, husband, electricity } = await household(BUILD);
    const token = await weekly(wife, electricity);
    await home.settle();
    await recordBillPayments(wife.database, wife.ws, { paidOn: '2026-11-03', payments: [{ templateId: token, billMonth: '2026-11-03', amountMinor: TOKEN }] });
    await recordBillPayments(husband.database, husband.ws, { paidOn: '2026-11-24', payments: [{ templateId: token, billMonth: '2026-11-24', amountMinor: TOKEN }] });
    await home.settle();
    for (const d of [wife, husband]) {
      expect((await billDetail(d.database, d.ws, token, '2026-11-25')).history.map((r) => r.month)).toEqual(['2026-11-24', '2026-11-03']);
    }
  });

  it('is refused while the other phone is on an older build, naming it', async () => {
    const { home, wife, electricity } = await household(OLDER);
    expect(await phonesBehindWeeklyBills(wife.database.db, home.bookId)).toEqual(["Husband's phone"]);
    const refused = await weekly(wife, electricity).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RecurringError);
    expect((refused as RecurringError).code).toBe('WEEKS_PHONES_BEHIND');
    expect((refused as RecurringError).message).toBe("Update cicis on Husband's phone first: an older version cannot read a bill by weeks.");
    // A monthly bill is saved as ever.
    const monthly = await saveExpenseTemplate(wife.database, wife.ws, { name: 'Electricity', categoryAccountId: electricity, moneyAccountId: wife.bank, amountMinor: TOKEN, dayOfMonth: 3 });
    expect((await listExpenseTemplates(wife.database, wife.ws)).find((t) => t.id === monthly)?.repeat).toBe('monthly');
  });
});
