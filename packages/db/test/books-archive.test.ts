import { describe, expect, it } from 'vitest';
import { archiveBook, BookError, createBook, createWorkspace, listArchivedBooks, listBooks, personalBook, restoreBook } from '../src/index';
import { setupDb } from './helpers';

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

// archived_at is an ISO timestamp to the millisecond; two archives inside one millisecond would tie.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('an archived workspace', () => {
  it('is listed as archived and not as open, and comes back whole when restored', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    expect(await listArchivedBooks(database, ws)).toEqual([]);

    await archiveBook(database, ws, business);
    expect(names(await listBooks(database, ws))).toEqual(['Personal']);
    const [archived] = await listArchivedBooks(database, ws);
    expect(archived).toMatchObject({ id: business, name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    expect(archived!.archivedAt).not.toBeNull();

    await restoreBook(database, ws, business);
    expect(names(await listBooks(database, ws))).toEqual(['Personal', 'Business']);
    expect(await listArchivedBooks(database, ws)).toEqual([]);
    expect((await listBooks(database, ws)).find((book) => book.id === business)?.archivedAt).toBeNull();
  });

  it('lists the most recently archived first', async () => {
    const { database, ws } = await setupDb();
    const first = await createBook(database, ws, { name: 'Shop', kind: 'business', baseCurrency: 'IDR' });
    const second = await createBook(database, ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR' });
    await archiveBook(database, ws, first);
    await tick();
    await archiveBook(database, ws, second);
    expect(names(await listArchivedBooks(database, ws))).toEqual(['Family', 'Shop']);
  });

  it('refuses to restore one that is not archived, or one from another workspace', async () => {
    const { database, ws } = await setupDb();
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    await expect(restoreBook(database, ws, business)).rejects.toMatchObject({ code: 'NOT_ARCHIVED' });
    await expect(restoreBook(database, ws, (await personalBook(database, ws)).id)).rejects.toBeInstanceOf(BookError);

    const other = await createWorkspace(database, { name: 'Other', type: 'personal', baseCurrency: 'IDR' });
    const theirs = await createBook(database, other, { name: 'Theirs', kind: 'business', baseCurrency: 'IDR' });
    await archiveBook(database, other, theirs);
    await expect(restoreBook(database, ws, theirs)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Each workspace sees only its own archive.
    expect(await listArchivedBooks(database, ws)).toEqual([]);
    expect(names(await listArchivedBooks(database, other))).toEqual(['Theirs']);
  });
});
