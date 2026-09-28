import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, personalBook, postTransaction, postTransactionTx, renameAccount, saveBudget, voidTransactionTx } from '../../src/index';
import { setupDb } from '../helpers';
import { withCapturePaused } from '../../src/sync/capture';
import { installCaptureTriggers, uncapturedWrites, watchPausedWrites } from './capture-harness';
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
    expect(await uncapturedWrites(database, book.id)).toEqual([`accounts ${groceries.id}: name changed with no category op`]);
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

  it('names a second, uncaptured write to a column of a row whose first write was captured', async () => {
    const { database, ws, book, groceries } = await watchedBook();
    await renameAccount(database, ws, groceries.id, 'Market');
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
    await database.db.run(sql`UPDATE accounts SET name = 'Sneaky' WHERE id = ${groceries.id}`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`accounts ${groceries.id}: name changed with no category op`]);
  });

  it('names an uncaptured in-place write to a purchase: its flags, and an entry memo', async () => {
    const { database, ws, book, bca, groceries } = await watchedBook();
    const id = await postTransaction(database, ws, { occurredOn: '2026-09-01', description: 'x', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 1, currency: 'IDR' }) });
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
    await database.db.run(sql`INSERT INTO transaction_flags (transaction_id, workspace_id, channel, excluded) VALUES (${id}, ${ws.workspaceId}, 'online', 0)`);
    await database.db.run(sql`UPDATE entries SET memo = 'psst' WHERE transaction_id = ${id}`);
    expect(await uncapturedWrites(database, book.id)).toEqual([
      `transaction_flags ${id}: purchase ${id} channel, excluded changed with no op`,
      `entries ${id}: purchase ${id} money changed with no op`,
    ]);
  });

  it('is quiet about a row deleted and written back as it was, and a purchase posted and voided in one transaction', async () => {
    const { database, ws, book, bca, groceries } = await watchedBook();
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 700_000, frequency: 'weekly' });
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 700_000, frequency: 'weekly' });
    await database.transaction(async (tx) => {
      const id = await postTransactionTx(tx, ws, { occurredOn: '2026-09-01', description: 'x', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 1, currency: 'IDR' }) });
      await voidTransactionTx(tx, ws, id);
    });
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
  });

  it('names a captured rename followed by an uncaptured revert: the outbox says one thing, the row another', async () => {
    const { database, ws, book, groceries } = await watchedBook();
    await renameAccount(database, ws, groceries.id, 'Market');
    await database.db.run(sql`UPDATE accounts SET name = 'Groceries' WHERE id = ${groceries.id}`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`accounts ${groceries.id}: name is "Groceries" but the outbox says "Market"`]);
  });

  it('names a captured purchase whose flag is then reverted by hand', async () => {
    const { database, ws, book, bca, groceries } = await watchedBook();
    const id = await postTransaction(database, ws, { occurredOn: '2026-09-01', description: 'x', channel: 'online', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 1, currency: 'IDR' }) });
    await database.db.run(sql`UPDATE transaction_flags SET channel = NULL WHERE transaction_id = ${id}`);
    expect(await uncapturedWrites(database, book.id)).toContain(`purchase ${id}: channel reads null but the outbox says "online"`);
  });

  it("leaves out apply's writes (withCapturePaused), and only those: the same write outside it is named", async () => {
    const { database, book, groceries } = await watchedBook();
    watchPausedWrites(database);
    const applied = { v: 1 as const, hlc: `${'0'.repeat(15)}1-remote`, member: 'member-dewi', ops: [{ entity: 'category', id: groceries.id, op: 'upsert' as const, fields: { name: 'Pasar' } }] };
    await database.transaction((tx) => withCapturePaused(tx, () => tx.run(sql`UPDATE accounts SET name = 'Pasar' WHERE id = ${groceries.id}`).then(() => undefined), applied));
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
    await database.transaction((tx) => withCapturePaused(tx, () => tx.run(sql`UPDATE accounts SET name = 'Market' WHERE id = ${groceries.id}`).then(() => undefined), applied));
    // Paused: left out. The same kind of write outside a paused section is named, as before.
    await database.db.run(sql`UPDATE accounts SET name = 'Sneaky' WHERE id = ${groceries.id}`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`accounts ${groceries.id}: name changed with no category op`]);
  });

  it('is quiet about writes to the book before it is shared', async () => {
    const t = await setupDb();
    const book = await personalBook(t.database, t.ws);
    const groceries = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Groceries')!;
    await installCaptureTriggers(t.database, book.id);
    await t.database.db.run(sql`UPDATE accounts SET name = 'Before' WHERE id = ${groceries.id}`);
    expect(await uncapturedWrites(t.database, book.id)).toEqual([]);
    await shareBookForTest(t.database, book.id);
    await t.database.db.run(sql`UPDATE accounts SET name = 'After' WHERE id = ${groceries.id}`);
    expect(await uncapturedWrites(t.database, book.id)).toEqual([`accounts ${groceries.id}: name changed with no category op`]);
  });
});
