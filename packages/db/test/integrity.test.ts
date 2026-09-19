import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDatabase, checkLedgerHealth, checkStructure, createAccount, listAccounts, postTransaction } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const spend = (amountMinor: number) =>
    postTransaction(database, ws, {
      occurredOn: '2026-09-03',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor, currency: 'IDR' }),
    });
  return { database, ws, bank, groceries, spend };
}

describe('checkStructure', () => {
  it('finds nothing wrong with a database the app just made', async () => {
    const h = await household();
    await h.spend(120_000);
    expect(await checkStructure(h.database)).toEqual([]);
    expect(await checkStructure(h.database, 'integrity_check')).toEqual([]);
  });

  it('reports a corrupted file instead of throwing', async () => {
    const h = await household();
    await h.spend(120_000);
    const bytes = await h.database.exportBytes();
    // Fill sixty pages in the middle with 0xFF: page 1 (the schema) survives, the b-trees do not.
    bytes.fill(0xff, 4096 * 20, 4096 * 40);
    await h.database.importBytes(bytes);
    const problems = await checkStructure(h.database);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe('quick_check');
    expect(problems[0]!.detail).toMatch(/malformed|not a database|disk image|ok$/i);
  });
});

describe('checkLedgerHealth', () => {
  it('is clean for ordinary data', async () => {
    const h = await household();
    await h.spend(120_000);
    expect(await checkLedgerHealth(h.database, h.ws)).toEqual({ unbalanced: [], orphanEntries: [], orphanTransactions: [] });
  });

  it('finds an unbalanced transaction, an orphan entry and a transaction with no entries', async () => {
    const h = await household();
    const id = await h.spend(120_000);
    const second = await h.spend(50_000);
    const third = await h.spend(30_000);
    // Three separate wounds, each of a different kind. Pointing an entry at a transaction that does not
    // exist is exactly what the foreign key on entries.transaction_id exists to forbid, so it is switched
    // off for this one corrupting statement — real corruption does not ask sqlite's permission either.
    await h.database.db.values(sql`UPDATE entries SET amount_minor = amount_minor + 1 WHERE transaction_id = ${id} LIMIT 1`);
    await h.database.execScript('PRAGMA foreign_keys = OFF');
    await h.database.db.values(sql`UPDATE entries SET transaction_id = 'gone' WHERE transaction_id = ${second}`);
    await h.database.execScript('PRAGMA foreign_keys = ON');
    await h.database.db.values(sql`DELETE FROM entries WHERE transaction_id = ${third}`);

    const health = await checkLedgerHealth(h.database, h.ws);
    expect(health.unbalanced.map((r) => r.transactionId)).toEqual([id]);
    expect(health.orphanEntries).toHaveLength(2);
    expect(health.orphanTransactions).toEqual([second, third].sort());
  });
});

describe('checkDatabase', () => {
  it('runs the structure and every workspace, and says what failed', async () => {
    const h = await household();
    const id = await h.spend(120_000);
    expect(await checkDatabase(h.database)).toEqual([]);
    await h.database.db.values(sql`DELETE FROM entries WHERE transaction_id = ${id}`);
    const problems = await checkDatabase(h.database);
    expect(problems.map((p) => p.kind)).toEqual(['orphan-transactions']);
    expect(problems[0]!.detail).toContain(id);
  });
});
