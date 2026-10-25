import { describe, expect, it } from 'vitest';
import { createBook, listBooks, personalBook, setBookKind } from '../src/index';
import { setupDb } from './helpers';

describe('changing a workspace’s kind', () => {
  it('moves it among business, family and personal and rewrites nothing else', async () => {
    const { database, ws } = await setupDb();
    const id = await createBook(database, ws, { name: 'Shop', kind: 'business', baseCurrency: 'IDR' });
    const before = (await listBooks(database, ws)).find((book) => book.id === id)!;

    await setBookKind(database, ws, id, 'family');
    const after = (await listBooks(database, ws)).find((book) => book.id === id)!;
    expect(after).toEqual({ ...before, kind: 'family' });

    await setBookKind(database, ws, id, 'personal');
    expect((await listBooks(database, ws)).find((book) => book.id === id)?.kind).toBe('personal');
  });

  it('refuses shared, an unknown workspace, and the only Personal', async () => {
    const { database, ws } = await setupDb();
    const id = await createBook(database, ws, { name: 'Shop', kind: 'business', baseCurrency: 'IDR' });
    await expect(setBookKind(database, ws, id, 'shared')).rejects.toMatchObject({ code: 'BAD_KIND' });
    await expect(setBookKind(database, ws, 'nope', 'family')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const personal = await personalBook(database, ws);
    await expect(setBookKind(database, ws, personal.id, 'business')).rejects.toMatchObject({ code: 'PERSONAL_BOOK' });
    expect((await personalBook(database, ws)).id).toBe(personal.id);
  });

  it('refuses a workspace that is shared', async () => {
    const { database, ws } = await setupDb();
    const id = await createBook(database, ws, { name: 'Joint', kind: 'shared', baseCurrency: 'IDR' });
    await expect(setBookKind(database, ws, id, 'family')).rejects.toMatchObject({ code: 'SHARED' });
  });
});
