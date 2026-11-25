import { describe, expect, it, vi } from 'vitest';
import { BudgetError, listAccounts, listBudgets, phonesBehindBudgetRepeat, saveBudget, saveBudgets } from '../../src/index';
import { type Device, Household, skipsOf } from './household';

vi.setConfig({ testTimeout: 60_000 });

/*
 * Budget C (2026-11-25) between two phones sharing a workspace: a budget by days or weeks is the same month on both, and
 * a phone on an older build — which would read every 3 weeks as every week — holds the change back until it updates.
 * Invented figures: pocket money Rp 100.000 a week, the electricity token Rp 1.000.000 every 3 weeks from 3 Nov 2026.
 */

const BUILD = '0.5.9';
// TestFlight 175 said 0.5.8 with bills by weeks but no Budget C: it is the older build here.
const OLDER = '0.5.8';

async function household(husbandVersion: string) {
  const home = new Household();
  const wife = await home.device('Wife', undefined, 'IDR', BUILD);
  const husband = await home.device('Husband', undefined, 'IDR', husbandVersion);
  await home.share(wife);
  await home.join(husband, wife);
  await home.settle();
  const all = await listAccounts(wife.database, wife.ws);
  const key = (k: string) => all.find((a) => a.systemKey === k)!.id;
  return { home, wife, husband, electricity: key('utilities.electricity'), groceries: key('household.groceries') };
}

const planOn = async (d: Device, categoryId: string, month: string) => (await listBudgets(d.database, d.ws, month)).find((row) => row.categoryAccountId === categoryId);

describe('a budget by days or weeks in a shared workspace', () => {
  it('reaches the other phone with its gap and start, and both read the same month', async () => {
    const { home, wife, husband, electricity, groceries } = await household(BUILD);
    await saveBudget(wife.database, wife.ws, { categoryAccountId: electricity, amountMinor: 1_000_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' });
    await saveBudget(wife.database, wife.ws, { categoryAccountId: groceries, amountMinor: 100_000, frequency: 'weekly' });
    await home.settle();
    for (const d of [wife, husband]) {
      expect(await planOn(d, electricity, '2026-11')).toMatchObject({ planMinor: 2_000_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03', amountAsSetMinor: 1_000_000 });
      expect((await planOn(d, electricity, '2026-12'))?.planMinor).toBe(1_000_000);
      expect((await planOn(d, groceries, '2026-11'))?.planMinor).toBe(500_000);
    }
    // Back to every week from the other phone: the gap and the start go on both.
    await saveBudget(husband.database, husband.ws, { categoryAccountId: electricity, amountMinor: 250_000, frequency: 'weekly' });
    await home.settle();
    for (const d of [wife, husband]) expect(await planOn(d, electricity, '2026-11')).toMatchObject({ planMinor: 1_250_000, everyWeeks: 1, startsOn: null });
    expect(await skipsOf(husband.database)).toEqual([]);
    expect(await skipsOf(wife.database)).toEqual([]);
  });

  it('is refused while the other phone is on an older build, naming it; a monthly budget is saved as ever', async () => {
    const { home, wife, electricity, groceries } = await household(OLDER);
    expect(await phonesBehindBudgetRepeat(wife.database.db, home.bookId)).toEqual(["Husband's phone"]);
    for (const input of [
      { frequency: 'weekly' as const, everyWeeks: 3, startsOn: '2026-11-03' },
      { frequency: 'weekly' as const },
      { frequency: 'daily' as const },
    ]) {
      const refused = await saveBudget(wife.database, wife.ws, { categoryAccountId: electricity, amountMinor: 100_000, ...input }).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(BudgetError);
      expect(refused).toMatchObject({ code: 'REPEAT_PHONES_BEHIND', message: "Update cicis on Husband's phone first: an older version cannot read a budget by days or weeks." });
    }
    const viaEdit = await saveBudgets(wife.database, wife.ws, { save: [{ categoryAccountId: groceries, amountMinor: 100_000, frequency: 'weekly' }], remove: [] }, '2026-11').catch((e: unknown) => e);
    expect(viaEdit).toMatchObject({ code: 'REPEAT_PHONES_BEHIND', categoryAccountId: groceries });
    expect(await planOn(wife, electricity, '2026-11')).toBeUndefined();

    await saveBudget(wife.database, wife.ws, { categoryAccountId: electricity, amountMinor: 1_500_000 });
    await saveBudget(wife.database, wife.ws, { categoryAccountId: groceries, amountMinor: 2_400_000, frequency: 'yearly' });
    expect(await planOn(wife, electricity, '2026-11')).toMatchObject({ planMinor: 1_500_000, frequency: 'monthly' });
    expect((await planOn(wife, groceries, '2026-11'))?.planMinor).toBe(200_000);
  });
});
