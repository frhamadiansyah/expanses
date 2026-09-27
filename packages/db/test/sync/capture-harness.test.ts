import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, personalBook, postTransaction, renameAccount } from '../../src/index';
import { setupDb } from '../helpers';
import { installCaptureTriggers, uncapturedWrites } from './capture-harness';
import { shareBookForTest } from './sync-helpers';

async function watchedBook() {
  const t = await setupDb();
  const book = await personalBook(t.database, t.ws);
  const bca = await createAccount(t.database, t.ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Groceries')!;
  await shareBookForTest(t.database, book.id);
  await installCaptureTriggers(t.database, book.id);
  return { ...t, book, bca, groceries };
}

describe('the capture harness (§6.4)', () => {
  it('names a write to a shared row that bypassed capture', async () => {
    const { database, book, groceries } = await watchedBook();
    await database.db.run(sql`UPDATE accounts SET name = 'Sneaky' WHERE id = ${groceries.id}`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`accounts ${groceries.id} (update): no category op`]);
  });

  it('names a purchase posted with capture switched off', async () => {
    const { database, ws, book, bca, groceries } = await watchedBook();
    const { configureCapture } = await import('../../src/sync/capture');
    configureCapture(database, { enabled: false });
    await postTransaction(database, ws, { occurredOn: '2026-09-01', description: 'x', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 1, currency: 'IDR' }) });
    const misses = await uncapturedWrites(database, book.id);
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatch(/has no sync_lineage row/);
  });

  it('is quiet about captured writes, about an unchanged value, and about rows outside the book', async () => {
    const { database, ws, book, bca, groceries } = await watchedBook();
    await renameAccount(database, ws, groceries.id, 'Market');
    await database.db.run(sql`UPDATE accounts SET name = 'Market' WHERE id = ${groceries.id}`);
    await database.db.run(sql`UPDATE accounts SET name = 'BCA Tahapan' WHERE id = ${bca.id}`);
    await postTransaction(database, ws, { occurredOn: '2026-09-01', description: 'x', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 1, currency: 'IDR' }) });
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
  });
});
