import { describe, expect, it } from 'vitest';
import { contextOf, createDatabase, createWorkspace, ensureCategoryKeys, listWorkspaces, migrate, MIGRATIONS, personalBook, uncategorisedCategory, uncategorisedIdOf } from '../src/index';
import { createNodeExecutor } from '../src/node';
import { uuidv5 } from '../src/sync/uuidv5';

/*
 * A workspace made before books has the Personal book migration 0042 named `'book-' + workspace id` — not a uuid, so it
 * cannot be a version-5 namespace as it is. Opening the app on such a workspace (ensureCategoryKeys keys each book's
 * Uncategorised) and saving with "Choose later" must both still work, under an id that is the same on every device.
 */
async function workspaceFromBeforeBooks() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database, MIGRATIONS.filter((m) => m.version <= 41));
  await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  await migrate(database);
  const ws = contextOf((await listWorkspaces(database))[0]!);
  return { database, ws, bookId: (await personalBook(database, ws)).id };
}

describe('Uncategorised in a Personal book from before books', () => {
  it('lets the app open and files "Choose later" under one id worked out from the book', async () => {
    const { database, ws, bookId } = await workspaceFromBeforeBooks();
    expect(bookId).toBe(`book-${ws.workspaceId}`);
    await expect(ensureCategoryKeys(database, ws)).resolves.toBeDefined();

    const id = await uncategorisedCategory(database, ws, 'expense');
    expect(id).toBe(await uncategorisedIdOf(bookId, 'expense'));
    expect(await uncategorisedCategory(database, ws, 'expense')).toBe(id);
    expect(await uncategorisedCategory(database, ws, 'income')).not.toBe(id);
  });

  it('names a book id that is not a uuid the same way for ever', async () => {
    // Literal on purpose: these ids are already on devices, so the namespace they are worked out under can never move.
    expect(await uncategorisedIdOf('book-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 'expense')).toBe('a74c8bf2-0c19-5434-a4d0-52df3923775c');
    expect(await uncategorisedIdOf('book-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 'income')).toBe('1725d12e-caff-514e-a9e4-62cef80c996c');
  });

  it('keeps the id a uuid without dashes has always had', async () => {
    const bookId = '0199a1b2c3d47e5f8a9b0c1d2e3f4a5b';
    expect(await uncategorisedIdOf(bookId, 'expense')).toBe(await uuidv5(bookId, 'uncategorised'));
  });

  it('keeps the id a book with a uuid id has always had', async () => {
    const bookId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(await uncategorisedIdOf(bookId, 'expense')).toBe(await uuidv5(bookId, 'uncategorised'));
    expect(await uncategorisedIdOf(bookId, 'income')).toBe(await uuidv5(bookId, 'uncategorised:income'));
  });
});
