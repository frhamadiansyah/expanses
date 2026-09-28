import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, deleteCategory, inBook, listAccounts, listCategoryColours, listCategoryNeeds, postTransaction, saveCategoryNeed, setCategoryColour } from '../../src/index';
import { Household, projectBook, skipsOf, type Device } from './household';

/*
 * A category deleted on one device of a shared book (repos/category-delete.ts): the delete travels with those of its
 * need mark and colour, and the other device drops all three. If the other device used the category before the delete
 * reached it, it keeps the category (ruled: nothing is ever left pointing at a category that is gone), and records
 * the delete as a skip; the deleting device files that purchase under the book's Uncategorised when it arrives.
 */
async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  const ws = (d: Device) => inBook(d.ws, bookId);
  const syalala = (await createAccount(fandri.database, ws(fandri), { name: 'Syalala', kind: 'expense', subtype: 'category', currency: null })).id;
  await saveCategoryNeed(fandri.database, ws(fandri), syalala, 'lifestyle');
  await setCategoryColour(fandri.database, ws(fandri), syalala, '#16a34a');
  await home.settle();
  return { home, fandri, dewi, bookId, syalala, ws };
}

const has = async (d: Device, id: string) => (await listAccounts(d.database, d.ws)).some((a) => a.id === id);
const tagged = async (d: Device, id: string) =>
  (await d.database.db.values(sql`SELECT 1 FROM book_categories WHERE category_account_id = ${id}`)).length > 0;

describe('deleting a category in a shared book', () => {
  it('reaches the other device, with its need mark and colour', async () => {
    const { home, fandri, dewi, bookId, syalala, ws } = await household();
    expect(await has(dewi, syalala)).toBe(true);
    expect(await listCategoryNeeds(dewi.database, ws(dewi))).toMatchObject({ [syalala]: 'lifestyle' });

    await deleteCategory(fandri.database, ws(fandri), syalala);
    await home.settle();
    for (const d of [fandri, dewi]) {
      expect(await has(d, syalala)).toBe(false);
      expect(await tagged(d, syalala)).toBe(false);
      expect(await listCategoryNeeds(d.database, ws(d))).not.toHaveProperty(syalala);
      expect(await listCategoryColours(d.database, ws(d))).not.toHaveProperty(syalala);
      expect(await skipsOf(d.database)).toEqual([]);
    }
    expect(await projectBook(dewi.database, bookId)).toEqual(await projectBook(fandri.database, bookId));
  });

  it('is refused, as a recorded skip, by a device that used the category before the delete reached it', async () => {
    const { home, fandri, dewi, bookId, syalala, ws } = await household();
    // Dewi, offline, spends in Syalala; Fandri, who has not seen that, deletes it.
    const lunch = await postTransaction(dewi.database, ws(dewi), {
      occurredOn: '2026-09-10',
      description: 'Lunch',
      lines: expenseLines({ categoryAccountId: syalala, paymentAccountId: dewi.bank, amountMinor: 50_000, currency: 'IDR' }),
    });
    await deleteCategory(fandri.database, ws(fandri), syalala);
    await fandri.engine.syncOnce(bookId);
    await dewi.engine.syncOnce(bookId);
    await home.settle();

    // Dewi keeps it, its settings, and her lunch in it; the skip says why.
    expect(await has(dewi, syalala)).toBe(true);
    expect(await tagged(dewi, syalala)).toBe(true);
    expect(await listCategoryNeeds(dewi.database, ws(dewi))).toMatchObject({ [syalala]: 'lifestyle' });
    expect(await listCategoryColours(dewi.database, ws(dewi))).toMatchObject({ [syalala]: '#16a34a' });
    const [entry] = await dewi.database.db.values<[string]>(sql`SELECT account_id FROM entries WHERE transaction_id = ${lunch} AND amount_minor > 0`);
    expect(entry![0]).toBe(syalala);
    const skips = (await skipsOf(dewi.database)) as [number, string, string, string][];
    expect(skips.map(([, entity, id]) => [entity, id]).sort()).toEqual(
      [
        ['category', syalala],
        ['category_colour', syalala],
        ['category_need', syalala],
      ].sort(),
    );
    expect(skips[0]![3]).toMatch(/Syalala is used by a transaction/);

    // Fandri's delete stands; the lunch reaches him filed under Uncategorised, so no entry points at a missing account.
    expect(await has(fandri, syalala)).toBe(false);
    const orphans = await fandri.database.db.values(sql`SELECT 1 FROM entries e LEFT JOIN accounts a ON a.id = e.account_id WHERE a.id IS NULL`);
    expect(orphans).toEqual([]);
    const filed = await fandri.database.db.values<[string]>(
      sql`SELECT a.name FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.transaction_id WHERE t.description = 'Lunch' AND a.kind = 'expense'`,
    );
    expect(filed).toEqual([['Uncategorised']]);
    expect(await skipsOf(fandri.database)).toEqual([]);
  });
});
