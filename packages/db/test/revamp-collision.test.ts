import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, listAccounts, listWorkspaces, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

/**
 * A workspace holding a key and the new spelling it renames to.
 *
 * Reachable in the wild: ensureCategoryKeys creates several of the new keys itself, so opening a build
 * where it ran before this migration did leaves both side by side. The rename then collided with the
 * unique index and rolled the migration back, which left the app unable to open.
 */
async function workspaceHolding(keys: readonly string[]) {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version <= 26));
  await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const [workspace] = await listWorkspaces(database);
  const ws = { workspaceId: workspace!.id, baseCurrency: 'IDR' };
  await database.execScript(`DELETE FROM accounts WHERE subtype = 'category'`);
  const values = keys
    .map((key, i) => `(lower(hex(randomblob(16))), '${ws.workspaceId}', NULL, 'expense', 'category', '${key}', NULL, NULL, 'derived', '${key}', ${i}, NULL, '2026-01-01T00:00:00Z')`)
    .join(',');
  await database.execScript(
    `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at) VALUES ${values}`,
  );
  return { database, ws };
}


/**
 * Spending posted the way a pre-revamp database already holds it.
 *
 * Written as plain SQL on purpose: the ORM names every column it knows on every insert, and a
 * database stopped at version 26 has none of the ones added since.
 */
async function spendAt(
  database: Awaited<ReturnType<typeof workspaceHolding>>['database'],
  ws: { workspaceId: string; baseCurrency: string },
  categoryId: string,
  accountId: string,
  amountMinor: number,
  description: string,
) {
  const txId = uuidv7();
  await database.execScript(`
    INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
    VALUES ('${txId}', '${ws.workspaceId}', '2026-02-02', '${description}', 'manual', 'posted', '2026-02-02T00:00:00Z');
    INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor)
    VALUES ('${uuidv7()}', '${ws.workspaceId}', '${txId}', '${categoryId}', ${amountMinor}, 'IDR', 1, ${amountMinor}),
           ('${uuidv7()}', '${ws.workspaceId}', '${txId}', '${accountId}', ${-amountMinor}, 'IDR', 1, ${-amountMinor});
  `);
}

describe('the revamp when both spellings are already present', () => {
  it('applies, and the spending keeps the key', async () => {
    const { database, ws } = await workspaceHolding(['government', 'government_taxes']);
    const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const spent = (await listAccounts(database, ws)).find((a) => a.systemKey === 'government')!;
    await spendAt(database, ws, spent.id, bca.id, 900_000, 'PBB');

    await expect(migrate(database)).resolves.toContain(27);

    // The empty one the app had created gave up the key; the one with the payment carries it.
    expect((await listAccounts(database, ws)).find((a) => a.id === spent.id)?.systemKey).toBe('government_taxes');
    expect((await listAccounts(database, ws)).filter((a) => a.systemKey === 'government_taxes')).toHaveLength(1);
  });

  it('applies when both sides have spending, losing neither', async () => {
    const { database, ws } = await workspaceHolding(['gifts_donations.gifts', 'gift_giving']);
    const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const before = await listAccounts(database, ws);
    // Ids, because the migration renames what it keys: names cannot identify a row across it.
    const oldSpelling = before.find((a) => a.systemKey === 'gifts_donations.gifts')!;
    const newSpelling = before.find((a) => a.systemKey === 'gift_giving')!;
    for (const category of [oldSpelling, newSpelling]) {
      await spendAt(database, ws, category.id, bca.id, 100_000, `spend on ${category.systemKey}`);
    }

    await expect(migrate(database)).resolves.toContain(27);

    const after = await listAccounts(database, ws);
    expect(after.filter((a) => a.systemKey === 'gift_giving')).toHaveLength(1);
    // Both categories survive, and the one that already held the key keeps it.
    expect(after.find((a) => a.id === newSpelling.id)?.systemKey).toBe('gift_giving');
    expect(after.find((a) => a.id === oldSpelling.id)?.systemKey).toBeNull();
    // And neither payment moved.
    for (const id of [oldSpelling.id, newSpelling.id]) {
      const [row] = await database.db.values<[number]>(sql.raw(`SELECT count(*) FROM entries WHERE account_id = '${id}'`));
      expect(row?.[0]).toBe(1);
    }
  });

  it('still applies on a workspace that only holds the old spellings', async () => {
    const { database, ws } = await workspaceHolding(['government', 'food.groceries', 'fees']);
    const before = await listAccounts(database, ws);
    const idOf = (key: string) => before.find((a) => a.systemKey === key)!.id;
    const government = idOf('government');
    const groceries = idOf('food.groceries');

    await expect(migrate(database)).resolves.toContain(27);

    const after = await listAccounts(database, ws);
    expect(after.find((a) => a.id === government)?.systemKey).toBe('government_taxes');
    expect(after.find((a) => a.id === groceries)?.systemKey).toBe('household.groceries');
  });
});
