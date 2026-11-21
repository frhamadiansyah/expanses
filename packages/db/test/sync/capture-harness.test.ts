import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, personalBook, postTransaction, postTransactionTx, renameAccount, runSharedBookRepairs, saveBudget, saveCategoryNeed, voidTransactionTx } from '../../src/index';
import { setupDb } from '../helpers';
import { thirdMarksCrossedKey, withCapturePaused } from '../../src/sync/capture';
import { afterSchemaChange, beforeSchemaChange, installCaptureTriggers, privateLeaks, uncapturedWrites, watchGone, watchPausedWrites } from './capture-harness';
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

  it('counts what apply took in to another book (a net-worth group log) for none of the watched book’s writes', async () => {
    const { database, book, groceries } = await watchedBook();
    watchPausedWrites(database);
    const applied = { v: 1 as const, hlc: `${'9'.repeat(15)}1-remote`, member: 'member-dewi', ops: [{ entity: 'category', id: groceries.id, op: 'upsert' as const, fields: { name: 'Pasar' } }] };
    // A write with no op, and then the same value arriving in another book's log: still named.
    await database.db.run(sql`UPDATE accounts SET name = 'Pasar' WHERE id = ${groceries.id}`);
    await database.transaction((tx) => withCapturePaused(tx, async () => undefined, applied, 'group-log-book'));
    expect(await uncapturedWrites(database, book.id)).toEqual([`accounts ${groceries.id}: name changed with no category op`]);
    // The same value arriving in the watched book's own log is what the row ends as on every phone: quiet.
    const inBook = { ...applied, hlc: `${'9'.repeat(15)}2-remote`, ops: [{ ...applied.ops[0]!, fields: { name: 'Pasar 2' } }] };
    await database.db.run(sql`UPDATE accounts SET name = 'Pasar 2' WHERE id = ${groceries.id}`);
    await database.transaction((tx) => withCapturePaused(tx, async () => undefined, inBook, book.id));
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
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

describe('a Debts & savings mark held behind its version gate (0119)', () => {
  /**
   * Another phone in the book, at an app version, and the book's two members (the repairs run only for a book with
   * members): what apply writes when their ops arrive, so not watched.
   */
  async function otherPhone(database: Awaited<ReturnType<typeof watchedBook>>['database'], bookId: string, version: string) {
    watchPausedWrites(database);
    await database.transaction((tx) =>
      withCapturePaused(tx, async () => {
        await tx.run(sql`
          INSERT INTO book_members (book_id, member_id, name, role, joined_at)
          VALUES (${bookId}, 'member-me', 'Fandri', 'owner', '2026-11-01T00:00:00Z'), (${bookId}, 'member-dewi', 'Dewi', 'member', '2026-11-01T00:00:00Z')
          ON CONFLICT DO NOTHING`);
        await tx.run(sql`
          INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
          VALUES (${bookId}, 'd-dewi', 'member-dewi', 'Phone', '{}', '{}', '2026-11-01T00:00:00Z', NULL, ${version})
          ON CONFLICT DO UPDATE SET app_version = excluded.app_version`);
      }),
    );
  }
  const markOps = async (database: Awaited<ReturnType<typeof watchedBook>>['database']) =>
    (await database.db.values<[string]>(sql`SELECT entry_json FROM sync_outbox`)).filter(([json]) => json.includes('debts_savings'));

  it('is quiet while the mark is held: no other phone, or one on 0.5.3', async () => {
    const { database, ws, book, groceries } = await watchedBook();
    await saveCategoryNeed(database, ws, groceries.id, 'debts_savings');
    expect(await markOps(database)).toEqual([]);
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
    await otherPhone(database, book.id, '0.5.3');
    await saveCategoryNeed(database, ws, groceries.id, 'lifestyle');
    await saveCategoryNeed(database, ws, groceries.id, 'debts_savings');
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
  });

  it('is quiet once the other phone updates while R7 still has it to send to, and after R7 sends', async () => {
    const { database, ws, book, groceries } = await watchedBook();
    await otherPhone(database, book.id, '0.5.3');
    await saveCategoryNeed(database, ws, groceries.id, 'debts_savings');
    await otherPhone(database, book.id, '0.5.4');
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
    await saveCategoryNeed(database, ws, groceries.id, 'lifestyle');
    await otherPhone(database, book.id, '0.5.3');
    await saveCategoryNeed(database, ws, groceries.id, 'debts_savings');
    await otherPhone(database, book.id, '0.5.4');
    expect((await runSharedBookRepairs(database, book.id)).thirdMarks).toBe(1);
    expect(await markOps(database)).toHaveLength(1);
    expect(await uncapturedWrites(database, book.id)).toEqual([]);
  });

  it('names a held mark that never went though every phone can store it and R7 says it has sent to them all', async () => {
    const { database, ws, book, groceries } = await watchedBook();
    await otherPhone(database, book.id, '0.5.3');
    await saveCategoryNeed(database, ws, groceries.id, 'debts_savings');
    await otherPhone(database, book.id, '0.5.4');
    // An R7 that records the phone as sent to, and sends nothing.
    await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${thirdMarksCrossedKey(book.id)}, '["d-dewi"]')`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`category_needs ${groceries.id}: need changed with no category_need op`]);
  });

  it('names any other mark sent nowhere, held gate or not', async () => {
    const { database, book, groceries } = await watchedBook();
    await database.db.run(sql`INSERT INTO category_needs (category_account_id, workspace_id, need) SELECT ${groceries.id}, workspace_id, 'lifestyle' FROM books WHERE id = ${book.id}`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`category_needs ${groceries.id}: need changed with no category_need op`]);
  });
});

describe('a watched table whose columns a test changes (an older build stood for)', () => {
  it('lets a column the triggers name be dropped and added back, and keeps watching the table', async () => {
    const { database, book } = await watchedBook();
    const alter = async (script: string) => {
      const tables = await beforeSchemaChange(database, script);
      await database.execScript(script);
      await afterSchemaChange(database, book.id, tables);
    };
    await expect(database.execScript('ALTER TABLE nw_pending DROP COLUMN ring_json')).rejects.toThrow(/ring_json/);
    await alter('ALTER TABLE nw_pending DROP COLUMN ring_json; ALTER TABLE nw_pending DROP COLUMN ring_devices_json;');
    await database.db.run(sql`INSERT INTO nw_pending (book_id, member_id, count) VALUES (${book.id}, 'member-me', 2)`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`nw_pending member-me: count changed with no nw_pending op`]);
    await alter('ALTER TABLE nw_pending ADD COLUMN ring_json TEXT; ALTER TABLE nw_pending ADD COLUMN ring_devices_json TEXT;');
    await database.db.run(sql`UPDATE nw_pending SET ring_json = '{}' WHERE book_id = ${book.id}`);
    expect(await uncapturedWrites(database, book.id)).toEqual([`nw_pending member-me: ring_json changed with no nw_pending op`]);
  });
});

describe('the watch ends only when the database does (wave 3 merge)', () => {
  it('a closed or restored database is a watch that is gone; any other error fails the check', async () => {
    expect(watchGone(new TypeError('The database connection is not open'))).toBe(true);
    expect(watchGone(new Error('no such table: temp.__writes'))).toBe(true);
    expect(watchGone(new Error('Failed query', { cause: new Error('no such table: temp.__sealed') }))).toBe(true);
    expect(watchGone(new Error('no such table: accounts'))).toBe(false);
    expect(watchGone(new Error('boom'))).toBe(false);

    const { database, book } = await watchedBook();
    await database.db.run(sql`INSERT INTO temp.__sealed (book_id, entry_json) VALUES (${book.id}, '{}')`);
    await database.db.run(sql`ALTER TABLE book_member_accounts RENAME TO book_member_accounts_away`);
    await expect(privateLeaks(database)).rejects.toThrow();
  });
});
