import { describe, expect, it } from 'vitest';
import { createAccount, inBook, listAccounts, listCategoryColours, moveCategory, setCategoryColour, setCategoryIcon } from '../../src/index';
import { categoryOf, Household, projectBook } from './household';

/*
 * A category's look and place, changed on its own page, reach the other device of a shared book: the colour picked
 * for a top-level category (0059, its own entity, keyed like a need), and the icon and parent (fields of the category).
 */
async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  const food = await categoryOf(fandri.database, bookId, 'Food and beverage');
  return { home, fandri, dewi, bookId, food, ws: (d: typeof fandri) => inBook(d.ws, bookId) };
}

describe('category looks in a shared book', () => {
  it('a colour set on one device replays onto the other, and so does taking it back', async () => {
    const { home, fandri, dewi, bookId, food, ws } = await household();
    await setCategoryColour(fandri.database, ws(fandri), food, '#7c3aed');
    await home.settle();
    expect(await listCategoryColours(dewi.database, ws(dewi))).toEqual({ [food]: '#7c3aed' });
    expect((await projectBook(dewi.database, bookId)).category_colour).toEqual({ [food]: { colour: '#7c3aed' } });

    await setCategoryColour(dewi.database, ws(dewi), food, null);
    await home.settle();
    expect(await listCategoryColours(fandri.database, ws(fandri))).toEqual({});
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });

  it('an icon and a move reach the other device, and a move drops the colour there too', async () => {
    const { home, fandri, dewi, bookId, food, ws } = await household();
    const mine = (await createAccount(fandri.database, ws(fandri), { name: 'Syalala', kind: 'expense', subtype: 'category', currency: null })).id;
    await setCategoryIcon(fandri.database, ws(fandri), mine, 'coffee');
    await setCategoryColour(fandri.database, ws(fandri), mine, '#16a34a');
    await home.settle();
    expect(await listCategoryColours(dewi.database, ws(dewi))).toEqual({ [mine]: '#16a34a' });

    await moveCategory(dewi.database, ws(dewi), mine, food);
    await home.settle();
    const there = (await listAccounts(fandri.database, ws(fandri))).find((a) => a.id === mine)!;
    expect(there).toMatchObject({ parentId: food, icon: 'coffee' });
    expect(await listCategoryColours(fandri.database, ws(fandri))).toEqual({});
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });
});
