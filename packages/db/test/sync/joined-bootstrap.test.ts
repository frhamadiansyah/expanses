import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ensureCategoryKeys, ensureDefaultCategorySets } from '../../src/index';
import { categoryOf, Household } from './household';

/*
 * Bootstrap's default-tree upkeep (`ensureCategoryKeys`, `ensureDefaultCategorySets`) never writes into a book this
 * device joined: its keyed and default categories arrive by sync under the owner's ids, and a copy made here under
 * fresh ids would be a duplicate on every device (controller ruling, task 4).
 */
describe('a joined book is left to sync', () => {
  it('neither recreates a missing default nor files new sets into it', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    // Dewi's own Personal is gone (archived), so the joined book is the first open one her workspace has.
    await dewi.database.execScript(`UPDATE books SET archived_at = '2026-09-01' WHERE kind = 'personal' AND workspace_id = '${dewi.ws.workspaceId}'`);
    const fuel = await categoryOf(dewi.database, bookId, 'Real estate'); // a default ensureCategoryKeys recreates
    await dewi.database.execScript(`DELETE FROM book_categories WHERE category_account_id = '${fuel}'; DELETE FROM accounts WHERE id = '${fuel}'`);
    await dewi.database.execScript(`DELETE FROM category_set_members; DELETE FROM book_category_sets; DELETE FROM category_sets`);
    const count = async () => (await dewi.database.db.values<[number]>(sql`SELECT count(*) FROM book_categories WHERE book_id = ${bookId}`))[0]![0];
    const before = await count();
    expect(await ensureCategoryKeys(dewi.database, dewi.ws)).toEqual({ keyed: [], created: [] });
    expect(await ensureDefaultCategorySets(dewi.database, dewi.ws)).toEqual([]);
    expect(await count()).toBe(before);
  });
});
