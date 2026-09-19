import { expenseLines } from '@expanses/core';
import { checkLedgerHealth, createAccount, createDatabase, createWorkspace, databaseVersion, LATEST_VERSION, listAccounts, migrate, MIGRATIONS, type Migration, postTransaction } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSafely } from './open';
import { memorySnapshots } from './snapshots';

/**
 * `checkDatabase` was hardened at source so it answers rather than throws — which left `open.ts`'s own
 * wrap around it with nothing to prove it. This file supplies the throw the source no longer produces.
 *
 * It matters because of what a throw escaping that call would cost: the rollback below it never runs, the
 * user keeps the half-updated file, nothing is blocked so the same update is attempted again at the next
 * launch, and the screen says only that we could not open their data. Belt and braces, and this is the
 * test for the braces: injected here as the whole module's `checkDatabase`, exactly as shipped.
 */
vi.mock('@expanses/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@expanses/db')>();
  return {
    ...actual,
    checkDatabase: async () => {
      throw new Error('the check itself fell over');
    },
  };
});

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

/** A database one build behind, with a posted transaction worth rolling back to. */
async function seeded() {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(
    database,
    MIGRATIONS.filter((m) => m.version <= 45),
  );
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  await postTransaction(database, ws, {
    occurredOn: '2026-09-03',
    description: 'Superindo',
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 120_000, currency: 'IDR' }),
  });
  return { database, ws };
}

describe('a verification that throws instead of answering', () => {
  it('is treated as one that failed: put back, blocked, and said plainly', async () => {
    const { database, ws } = await seeded();
    const before = await database.exportBytes();
    const harmless: Migration = { version: LATEST_VERSION + 1, name: 'harmless', sql: 'CREATE TABLE harmless (x TEXT);' };
    const store = memorySnapshots();

    const result = await openSafely({ database, migrations: [...MIGRATIONS, harmless], snapshots: store, onStage: () => undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatchObject({ kind: 'verify-failed', rolledBack: true, exportable: true });
      // The throw is carried into the detail rather than swallowed, so a bug report can name it.
      expect(result.reason.detail).toContain('the check itself fell over');
    }
    // The migration that ran is undone, byte for byte, and the run that produced it is not tried again.
    expect(await databaseVersion(database)).toBe(45);
    expect(Array.from(await database.exportBytes())).toEqual(Array.from(before));
    expect(await store.blockedVersion()).toBe(46);
    expect(await checkLedgerHealth(database, ws)).toEqual({ unbalanced: [], orphanEntries: [], orphanTransactions: [] });
  });

  it('never reaches the check at all when no update ran, so a throwing check cannot lock anyone out', async () => {
    const { database } = await seeded();
    await migrate(database); // brought up to date outside the opener, so the open below has nothing to do
    const store = memorySnapshots();

    // Nothing pending: the mocked check would throw if it were asked, and it must not be asked.
    const result = await openSafely({ database, snapshots: store, onStage: () => undefined });
    expect(result.ok).toBe(true);
    expect(await store.blockedVersion()).toBe(null);
  });
});
