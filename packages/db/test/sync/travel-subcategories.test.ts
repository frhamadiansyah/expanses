import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ensureCategoryKeys, personalBook } from '../../src/index';
import { defaultCategoryIdOf } from '../../src/repos/categories';
import { Household, type Device } from './household';

/*
 * Travel's Transport, Souvenirs and Others reaching a shared book: each phone upgrades on its own day, and the book
 * ends with one row of each on every phone — the owner's phone adds them and sync carries them, a joined phone never
 * makes copies of its own, and the id is worked out from the book alike everywhere.
 */

const ADDED = ['travel.transport', 'travel.souvenirs', 'travel.others'] as const;
const keys = ADDED.map((key) => `'${key}'`).join(', ');

/** Takes the three out of every book on one phone, as the phone held them before the upgrade. Not captured. */
async function asBeforeTheUpgrade(d: Device): Promise<void> {
  await d.database.execScript(`
    DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key IN (${keys}));
    DELETE FROM accounts WHERE system_key IN (${keys});`);
}

const rowsIn = async (d: Device, bookId: string) =>
  d.database.db.values<[string, string]>(sql`
    SELECT a.system_key, a.id FROM accounts a JOIN book_categories b ON b.category_account_id = a.id
     WHERE b.book_id = ${bookId} AND a.system_key IN (${sql.raw(keys)}) ORDER BY a.system_key, a.id`);

async function upgradedHousehold() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  // Both phones were set up on the old version, and the book was shared then.
  await asBeforeTheUpgrade(fandri);
  await asBeforeTheUpgrade(dewi);
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  expect(await rowsIn(dewi, bookId)).toEqual([]);
  return { home, fandri, dewi, bookId };
}

async function expectOneEach(devices: Device[], bookId: string): Promise<void> {
  const expected = (await Promise.all(ADDED.map(async (key) => [key, await defaultCategoryIdOf(bookId, key)] as [string, string]))).sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  );
  for (const d of devices) expect(await rowsIn(d, bookId)).toEqual(expected);
}

describe('Travel sub-categories in a shared book', () => {
  it('end as one row each on both phones when the joined phone upgrades first', async () => {
    const { home, fandri, dewi, bookId } = await upgradedHousehold();

    // Dewi's phone upgrades and opens: her own Personal gets the three, the joined book waits for the owner's.
    await ensureCategoryKeys(dewi.database, dewi.ws);
    expect(await rowsIn(dewi, bookId)).toEqual([]);
    const dewiPersonal = await personalBook(dewi.database, dewi.ws);
    expect((await rowsIn(dewi, dewiPersonal.id)).map(([key]) => key)).toEqual([...ADDED].sort());
    await home.settle();

    // Days later Fandri's phone upgrades, opens, and syncs.
    await ensureCategoryKeys(fandri.database, fandri.ws);
    await home.settle();
    // And both open again.
    await ensureCategoryKeys(dewi.database, dewi.ws);
    await ensureCategoryKeys(fandri.database, fandri.ws);
    await home.settle();

    await expectOneEach([fandri, dewi], bookId);
    const skipped = await dewi.database.db.values(sql`SELECT * FROM sync_skipped`);
    expect(skipped).toEqual([]);
  });

  it('end as one row each on both phones when the owner upgrades first, and Dewi opens before syncing', async () => {
    const { home, fandri, dewi, bookId } = await upgradedHousehold();

    await ensureCategoryKeys(fandri.database, fandri.ws);
    await ensureCategoryKeys(fandri.database, fandri.ws);
    // Dewi opens on the new version while Fandri's change is still on its way.
    await ensureCategoryKeys(dewi.database, dewi.ws);
    await home.settle();
    await ensureCategoryKeys(dewi.database, dewi.ws);
    await home.settle();

    await expectOneEach([fandri, dewi], bookId);
  });
});
