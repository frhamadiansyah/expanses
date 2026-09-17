import { addMonths, isoDate, monthOf, monthRange } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  categoryTotalsBetween,
  checkLedgerIntegrity,
  createDatabase,
  createWorkspace,
  type Database,
  inBook,
  listAccounts,
  listCategorySets,
  listPrograms,
  listTransactions,
  MIGRATIONS,
  migrate,
  monthlyBills,
  nativeBalances,
  personalBook,
  programBalance,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { seedSampleData } from './sample/seed';

const MONTHS_BACK = [0, -1, -2, -3];

/**
 * Every figure books touches, read the way the app reads it. Migration 0042 should change none of it: it only
 * adds membership rows alongside data that was already there.
 */
async function snapshot(database: Database, ws: WorkspaceContext, today: string) {
  const months = MONTHS_BACK.map((offset) => addMonths(monthOf(today), offset));
  const programs = await listPrograms(database, ws);

  const programBalances: Record<string, unknown> = {};
  for (const program of programs) {
    programBalances[program.id] = await programBalance(database, ws, program.id, today);
  }

  const totals: Record<string, unknown> = {};
  for (const month of months) {
    const { from, to } = monthRange(month);
    for (const kind of ['expense', 'income'] as const) {
      totals[`${month}:${kind}`] = await categoryTotalsBetween(database, ws, kind, from, to);
    }
  }

  const sheets: Record<string, unknown> = {};
  for (const month of months) {
    sheets[month] = await budgetSheetFor(database, ws, month);
  }

  return {
    integrity: await checkLedgerIntegrity(database, ws),
    balances: await nativeBalances(database, ws),
    programBalances,
    transactionIds: (await listTransactions(database, ws, { limit: 5000 })).map((t) => t.id),
    bills: await monthlyBills(database, ws, today),
    categorySets: (await listCategorySets(database, ws)).map((s) => s.name).sort(),
    totals,
    sheets,
  };
}

describe('migration 0042 on a realistic v41 database', () => {
  it('changes no figure the app reads, and files everything into Personal', async () => {
    const executor = createNodeExecutor();
    const database = createDatabase(executor);
    try {
      await migrate(database, MIGRATIONS.filter((m) => m.version <= 41));
      const ws = await createWorkspace(database, { name: 'Household', type: 'personal', baseCurrency: 'IDR' });
      const today = process.env.SAMPLE_TODAY ?? isoDate();

      // Repositories guard every book write with hasBooks, so this seeds a genuine v41 database: no books
      // table exists yet, and none of these calls try to write into one.
      await seedSampleData(database, ws, today);

      const before = await snapshot(database, ws, today);

      expect(await migrate(database)).toEqual(expect.arrayContaining([42, 43]));

      const personal = await personalBook(database, ws);
      const book = inBook(ws, personal.id);

      const afterUnscoped = await snapshot(database, ws, today);
      const afterBook = await snapshot(database, book, today);

      expect(afterUnscoped).toEqual(before);
      expect(afterBook).toEqual(before);

      // Non-vacuous: the sample household really has expense and income to compare, both directions.
      let sawExpense = false;
      let sawIncome = false;
      for (const key of Object.keys(before.totals)) {
        const rows = before.totals[key] as { amountBaseMinor: number }[];
        if (rows.length === 0) continue;
        if (key.endsWith(':expense')) sawExpense = true;
        if (key.endsWith(':income')) sawIncome = true;
      }
      expect(sawExpense).toBe(true);
      expect(sawIncome).toBe(true);

      // Every income/expense account was filed into a book.
      const categories = (await listAccounts(database, ws)).filter((a) => a.kind === 'expense' || a.kind === 'income');
      const [[filed]] = (await database.db.values<[number]>(
        sql`SELECT count(*) FROM book_categories WHERE workspace_id = ${ws.workspaceId}`,
      )) as [[number]];
      expect(Number(filed)).toBe(categories.length);
      expect(categories.length).toBeGreaterThan(0);

      // At least one posted, categorised transaction was filed into a book.
      const [[filedTx]] = (await database.db.values<[number]>(
        sql`SELECT count(*) FROM book_transactions WHERE workspace_id = ${ws.workspaceId}`,
      )) as [[number]];
      expect(Number(filedTx)).toBeGreaterThan(0);
    } finally {
      executor.close();
    }
  }, 120_000);
});

describe('migration 0043 on a realistic v41 database', () => {
  it('lets two categories share a system key across books, but still guards a duplicate equity key', async () => {
    const executor = createNodeExecutor();
    const database = createDatabase(executor);
    try {
      await migrate(database, MIGRATIONS.filter((m) => m.version <= 41));
      const ws = await createWorkspace(database, { name: 'Household', type: 'personal', baseCurrency: 'IDR' });
      const today = process.env.SAMPLE_TODAY ?? isoDate();
      await seedSampleData(database, ws, today);

      await migrate(database);

      const now = new Date().toISOString();
      // Two expense categories sharing a system key: forbidden before 0043 narrowed the index to non-categories,
      // allowed now that a copied book category keeps its source's key.
      await expect(
        database.db.run(sql`INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, system_key, sort_order, created_at) VALUES
          ('acc-dup-key-1', ${ws.workspaceId}, 'expense', 'category', 'Groceries A', NULL, 'derived', 'shared_key', 100, ${now}),
          ('acc-dup-key-2', ${ws.workspaceId}, 'expense', 'category', 'Groceries B', NULL, 'derived', 'shared_key', 101, ${now})`),
      ).resolves.not.toThrow();

      // A duplicate equity system key is still rejected: that uniqueness is exactly what 0043 kept.
      await expect(
        database.db.run(sql`INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, system_key, sort_order, created_at)
          VALUES ('acc-dup-opening-balance', ${ws.workspaceId}, 'equity', 'equity', 'Opening Balances (dup)', NULL, 'derived', 'opening_balance', 102, ${now})`),
      ).rejects.toThrow();
    } finally {
      executor.close();
    }
  }, 60_000);
});
