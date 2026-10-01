import { describe, expect, it } from 'vitest';
import { clearCategoryNeed, inBook, monthlyBills, pauseBill, removeBudget, resumeBill, saveBudget, saveCategoryNeed, saveExpenseTemplate, skipBill, unskipBill } from '../../src/index';
import { categoryOf, Household, projectBook } from './household';

/*
 * Tombstones (spec §7.2/§7.3, controller ruling): a row keyed by anything but its own id comes back when it is made
 * again later than it was deleted, on every device; a row keyed by its own id never does (rule 3). Two devices that
 * each make the one budget a category can hold keep the lower id on both.
 */
async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
  return { home, fandri, dewi, bookId, groceries, ws: (d: typeof fandri) => inBook(d.ws, bookId) };
}

describe('tombstones', () => {
  it('a skip taken back and made again is back on every device', async () => {
    const { home, fandri, dewi, bookId, groceries, ws } = await household();
    const bill = await saveExpenseTemplate(fandri.database, ws(fandri), { name: 'Internet', categoryAccountId: groceries, moneyAccountId: fandri.bank, amountMinor: 400_000, dayOfMonth: 5 });
    await home.settle();
    await skipBill(fandri.database, ws(fandri), bill, '2026-10');
    await unskipBill(fandri.database, ws(fandri), bill, '2026-10');
    await skipBill(fandri.database, ws(fandri), bill, '2026-10');
    await home.settle();
    const view = await projectBook(dewi.database, bookId);
    expect(Object.keys(view.bill_skip!)).toEqual([`${bill}|2026-10`]);
    expect(view).toEqual(await projectBook(fandri.database, bookId));
  });

  it('a pause reaches the other device, and so does the resume', async () => {
    const { home, fandri, dewi, bookId, groceries, ws } = await household();
    const bill = await saveExpenseTemplate(fandri.database, ws(fandri), { name: 'Gym', categoryAccountId: groceries, moneyAccountId: fandri.bank, amountMinor: 350_000, dayOfMonth: 5, startsMonth: '2026-09' });
    await home.settle();
    await pauseBill(fandri.database, ws(fandri), bill, '2026-12', '2026-10-01');
    await home.settle();
    expect(Object.keys((await projectBook(dewi.database, bookId)).bill_pause!).sort()).toEqual([`${bill}|2026-10`, `${bill}|2026-11`]);
    expect((await monthlyBills(dewi.database, ws(dewi), '2026-10-20')).find((b) => b.id === bill)).toMatchObject({ pausedUntil: '2026-12' });
    await resumeBill(fandri.database, ws(fandri), bill, '2026-10-20');
    await home.settle();
    expect((await monthlyBills(dewi.database, ws(dewi), '2026-10-20')).find((b) => b.id === bill)).toMatchObject({ pausedUntil: null });
    expect(await projectBook(dewi.database, bookId)).toEqual(await projectBook(fandri.database, bookId));
  });

  it('a need cleared on one device and set again on the other: the later wins everywhere, in either order', async () => {
    const { home, fandri, dewi, bookId, groceries, ws } = await household();
    await saveCategoryNeed(fandri.database, ws(fandri), groceries, 'essential');
    await home.settle();
    await clearCategoryNeed(fandri.database, ws(fandri), groceries);
    await saveCategoryNeed(dewi.database, ws(dewi), groceries, 'lifestyle'); // later hlc
    await dewi.engine.syncOnce(bookId);
    await fandri.engine.syncOnce(bookId);
    await home.settle();
    for (const d of [fandri, dewi]) expect((await projectBook(d.database, bookId)).category_need).toEqual({ [groceries]: { need: 'lifestyle' } });
  });

  it('a budget removed on one device stays removed when the other edits it offline', async () => {
    const { home, fandri, dewi, bookId, groceries, ws } = await household();
    await saveBudget(fandri.database, ws(fandri), { categoryAccountId: groceries, amountMinor: 1_000_000 });
    await home.settle();
    await saveBudget(dewi.database, ws(dewi), { categoryAccountId: groceries, amountMinor: 2_000_000 });
    await removeBudget(fandri.database, ws(fandri), groceries);
    await home.settle();
    for (const d of [fandri, dewi]) expect((await projectBook(d.database, bookId)).budget).toEqual({});
  });

  it('two devices each set the one budget a category can hold: both keep the lower id', async () => {
    const { home, fandri, dewi, bookId, groceries, ws } = await household();
    const a = await saveBudget(fandri.database, ws(fandri), { categoryAccountId: groceries, amountMinor: 1_000_000 });
    const b = await saveBudget(dewi.database, ws(dewi), { categoryAccountId: groceries, amountMinor: 2_000_000 });
    await home.settle();
    const kept = a < b ? a : b;
    for (const d of [fandri, dewi]) expect(Object.keys((await projectBook(d.database, bookId)).budget!)).toEqual([kept]);
  });
});
