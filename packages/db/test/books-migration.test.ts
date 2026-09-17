import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor } from '../src/node';

const rows = async (database: ReturnType<typeof createDatabase>, query: string) => database.db.values<unknown[]>(sql.raw(query));

describe('migration 0042', () => {
  it('is version 42 and named books', () => {
    expect(MIGRATIONS.find((m) => m.version === 42)).toMatchObject({ name: 'books' });
  });

  it('files everything a version 41 database holds into a Personal book, changing no figure', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 41));

    /*
     * Seeded with raw SQL, the way a version 41 database actually held it — not with
     * createWorkspace/createAccount/postTransaction. Later tasks teach those repos to also write
     * into the book tables this migration adds, and a v41 database has none of those tables yet.
     */
    const wsId = 'ws1';
    const now = '2026-09-01T00:00:00.000Z';
    await older.db.values(sql`INSERT INTO workspaces (id, name, type, base_currency, plan, created_at)
      VALUES (${wsId}, 'Personal', 'personal', 'IDR', 'free', ${now})`);

    const bank = 'acc-bank';
    const savings = 'acc-savings';
    const food = 'acc-food';
    const transport = 'acc-transport';
    const salary = 'acc-salary';
    await older.db.values(sql`INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, system_key, sort_order, created_at) VALUES
      (${bank}, ${wsId}, 'asset', 'bank', 'BCA', 'IDR', NULL, 0, ${now}),
      (${savings}, ${wsId}, 'asset', 'bank', 'Jenius', 'IDR', NULL, 1, ${now}),
      (${food}, ${wsId}, 'expense', 'category', 'Food & Beverage', NULL, 'food_beverage', 0, ${now}),
      (${transport}, ${wsId}, 'expense', 'category', 'Transport', NULL, NULL, 1, ${now}),
      (${salary}, ${wsId}, 'income', 'category', 'Salary', NULL, NULL, 0, ${now})`);

    const spend = 'tx-spend';
    await older.db.values(sql`INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
      VALUES (${spend}, ${wsId}, '2026-09-10', 'Warung', 'manual', 'posted', ${now})`);
    await older.db.values(sql`INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor) VALUES
      ('e-spend-1', ${wsId}, ${spend}, ${food}, 85000, 'IDR', 1, 85000),
      ('e-spend-2', ${wsId}, ${spend}, ${bank}, -85000, 'IDR', 1, -85000)`);

    // Moving money between your own accounts touches no income or expense account, so it is filed nowhere.
    const move = 'tx-move';
    await older.db.values(sql`INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
      VALUES (${move}, ${wsId}, '2026-09-11', 'Top up', 'manual', 'posted', ${now})`);
    await older.db.values(sql`INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor) VALUES
      ('e-move-1', ${wsId}, ${move}, ${savings}, 500000, 'IDR', 1, 500000),
      ('e-move-2', ${wsId}, ${move}, ${bank}, -500000, 'IDR', 1, -500000)`);

    await older.db.values(sql`INSERT INTO budget_settings (workspace_id, expected_income_minor, updated_at) VALUES (${wsId}, 41500000, ${now})`);
    await older.db.values(sql`INSERT INTO budget_income_overrides (workspace_id, month, amount_minor) VALUES (${wsId}, '2026-10', 5000000)`);
    await older.db.values(sql`INSERT INTO category_sets (id, workspace_id, name, created_at) VALUES ('set-holiday', ${wsId}, 'Holiday', ${now})`);

    expect(await migrate(older)).toContain(42);

    const [book] = await rows(older, `SELECT id, name, kind, base_currency FROM books WHERE workspace_id = '${wsId}'`);
    expect(book!.slice(1)).toEqual(['Personal', 'personal', 'IDR']);
    const bookId = String(book![0]);

    const [[categories]] = (await rows(older, `SELECT count(*) FROM book_categories WHERE book_id = '${bookId}'`)) as [[number]];
    const [[allCategories]] = (await rows(older, `SELECT count(*) FROM accounts WHERE kind IN ('income','expense') AND workspace_id = '${wsId}'`)) as [[number]];
    expect(Number(categories)).toBe(Number(allCategories));
    expect(Number(allCategories)).toBe(3);

    // The purchase is filed in Personal; moving money between your own accounts is filed nowhere.
    expect(await rows(older, `SELECT transaction_id FROM book_transactions WHERE book_id = '${bookId}'`)).toEqual([[spend]]);
    expect(await rows(older, `SELECT transaction_id FROM book_transactions WHERE transaction_id = '${move}'`)).toEqual([]);

    expect(await rows(older, `SELECT expected_income_minor FROM book_budget_settings WHERE book_id = '${bookId}'`)).toEqual([[41500000]]);
    // The old table keeps its row.
    expect(await rows(older, `SELECT expected_income_minor FROM budget_settings`)).toEqual([[41500000]]);

    // category_sets and budget_income_overrides also carry forward into the book's own tables.
    expect(await rows(older, `SELECT set_id FROM book_category_sets WHERE book_id = '${bookId}'`)).toEqual([['set-holiday']]);
    expect(await rows(older, `SELECT amount_minor FROM book_income_overrides WHERE book_id = '${bookId}' AND month = '2026-10'`)).toEqual([[5000000]]);
  });
});
