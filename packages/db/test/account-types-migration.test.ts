import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, type Database, migrate, MIGRATIONS, nativeBalances, type WorkspaceContext } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
let database: Database;
let ws: WorkspaceContext;

afterEach(() => {
  executor?.close();
  executor = undefined;
});

/** A version 44 database with money in it, written the way a version 44 build would have written it. */
async function atVersion44() {
  executor = createNodeExecutor();
  database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version <= 44));
  ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });

  const w = ws.workspaceId;
  const account = (id: string, kind: string, subtype: string, name: string, currency: string | null, parent: string | null = null) =>
    database.execScript(
      `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
       VALUES ('${id}', '${w}', ${parent === null ? 'NULL' : `'${parent}'`}, '${kind}', '${subtype}', '${name}', NULL,
         ${currency === null ? 'NULL' : `'${currency}'`}, 'derived', NULL, 3, ${id === 'acc-old-cash' ? `'2026-01-05T00:00:00Z'` : 'NULL'}, '2026-01-01T00:00:00Z')`,
    );
  await account('acc-bca', 'asset', 'bank', 'BCA Tahapan', 'IDR');
  await account('acc-wallet-cash', 'asset', 'cash', 'Dompet', 'IDR');
  await account('acc-old-cash', 'asset', 'cash', 'Celengan', 'IDR');
  await account('acc-visa', 'liability', 'credit_card', 'BCA Visa', 'IDR');
  await account('acc-sinarmas', 'asset', 'savings', 'Simas Tabungan', 'IDR');
  await account('acc-groceries', 'expense', 'category', 'Belanja harian', null);

  const post = async (id: string, description: string, on: string, lines: [string, number][]) => {
    await database.execScript(
      `INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
       VALUES ('${id}', '${w}', '${on}', '${description}', 'manual', 'posted', '2026-01-01T00:00:00Z')`,
    );
    let n = 0;
    for (const [accountId, amountMinor] of lines) {
      await database.execScript(
        `INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor)
         VALUES ('${id}-e${n++}', '${w}', '${id}', '${accountId}', ${amountMinor}, 'IDR', 1, ${amountMinor})`,
      );
    }
  };
  await post('tx-open', 'Opening balance', '2026-01-01', [['acc-bca', 20_000_000], ['acc-wallet-cash', 500_000]]);
  await post('tx-groceries', 'Superindo', '2026-02-03', [['acc-groceries', 350_000], ['acc-bca', -350_000]]);
  await post('tx-card', 'Tokopedia', '2026-02-10', [['acc-groceries', 150_000], ['acc-visa', -150_000]]);
}

/** Line breaks and runs of spaces differ between the migration that wrote a statement and the one that
    rewrites it; nothing about the constraint does. Compared on one line, the texts have to match. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

const SUBTYPE_CHECK = /CHECK \(subtype IN \([^)]*\)\)/;

/** The subtypes the table's own CHECK allows, whatever order and spacing it lists them in. */
const allowedSubtypes = (ddl: string) => [...ddl.match(SUBTYPE_CHECK)![0].matchAll(/'(\w+)'/g)].map((m) => m[1]!).sort();

/** The table with that one list blanked out: columns, defaults, foreign keys and the other CHECKs. */
const shapeApartFromSubtypes = (ddl: string) => flat(ddl).replace(SUBTYPE_CHECK, 'CHECK (subtype IN (...))');

/** Every column of every account, the table's own DDL, and the indexes SQLite holds for it. */
async function accountsSchema() {
  const [[ddl]] = (await database.db.values<[string]>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`,
  )) as [[string]];
  const indexes = await database.db.values<[string, string | null]>(
    sql`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'accounts' ORDER BY name`,
  );
  return {
    rows: await database.db.values(sql`SELECT * FROM accounts ORDER BY id`),
    columns: await database.db.values(sql`PRAGMA table_info(accounts)`),
    ddl,
    indexes: indexes.map(([name, indexSql]) => [name, indexSql === null ? null : flat(indexSql)]),
  };
}

describe('migration 0045', () => {
  beforeEach(atVersion44);

  it('is version 45 and named account_types', () => {
    expect(MIGRATIONS.find((m) => m.version === 45)).toMatchObject({ name: 'account_types' });
  });

  it('leaves every account, every index and every balance exactly as it found them', async () => {
    const before = await accountsSchema();
    const balancesBefore = await nativeBalances(database, ws);
    expect(before.rows.length).toBeGreaterThan(6);

    expect(await migrate(database)).toEqual([45, 46, 47, 48, 49]);

    const after = await accountsSchema();
    expect(after.rows).toEqual(before.rows);
    expect(after.columns).toEqual(before.columns);
    // Both of 0001's indexes are back, accounts_system_key in the narrowed form 0043 left it in.
    expect(after.indexes).toEqual(before.indexes);
    expect(after.indexes.map(([name]) => name)).toEqual([
      'accounts_system_key',
      'accounts_workspace_kind',
      // The primary key's own index, proof the table was rebuilt with the same key and not merely emptied.
      'sqlite_autoindex_accounts_1',
    ]);
    expect(await nativeBalances(database, ws)).toEqual(balancesBefore);
    // Entries, trades and the parent_id self-reference still point at rows that exist.
    expect(await database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it('rewrites nothing in the table but the list of subtypes', async () => {
    const before = await accountsSchema();

    await migrate(database);

    const after = await accountsSchema();
    // Every column, default, foreign key, primary key and other CHECK, written exactly as 0001 wrote them.
    // PRAGMA table_info reports none of those, which is why the table's own DDL is compared here.
    expect(shapeApartFromSubtypes(after.ddl)).toBe(shapeApartFromSubtypes(before.ddl));
    expect(allowedSubtypes(before.ddl)).not.toContain('fund');
    // `migrate` runs every later migration too, and 0047 widened the same CHECK again.
    expect(allowedSubtypes(after.ddl)).toEqual([...allowedSubtypes(before.ddl), 'ewallet', 'fund', 'other_cash', 'time_deposit'].sort());
    for (const clause of ['REFERENCES workspaces(id)', 'REFERENCES accounts(id)', 'id TEXT PRIMARY KEY']) {
      expect(flat(after.ddl)).toContain(clause);
    }
  });

  it('still refuses an asset with no currency, the other CHECK on the table', async () => {
    await migrate(database);
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-no-currency', '${ws.workspaceId}', 'asset', 'ewallet', 'Wallet with no currency', NULL, 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    // A workspace that does not exist is still refused too, so the foreign key survived the rebuild.
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-nowhere', 'no-such-workspace', 'asset', 'ewallet', 'GoPay', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it('still refuses a second account on a system key, and a category may still share one', async () => {
    await migrate(database);
    const w = ws.workspaceId;
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, system_key, sort_order, created_at)
         VALUES ('acc-dup', '${w}', 'equity', 'equity', 'Opening balances again', NULL, 'derived', 'opening_balance', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it('takes a fund account and a digital wallet, and still refuses a subtype it has never heard of', async () => {
    await migrate(database);

    const rdn = await createAccount(database, ws, { name: 'RDN Mandiri Sekuritas', kind: 'asset', subtype: 'fund', currency: 'IDR', openingBalanceMinor: 5_000_000 });
    const gopay = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 250_000 });

    const balances = await nativeBalances(database, ws);
    expect(balances[rdn.id]).toBe(5_000_000);
    expect(balances[gopay.id]).toBe(250_000);
    expect(await database.db.values(sql`SELECT subtype FROM accounts WHERE id IN (${rdn.id}, ${gopay.id}) ORDER BY subtype`)).toEqual([['ewallet'], ['fund']]);

    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-nonsense', '${ws.workspaceId}', 'asset', 'crypto_wallet', 'Nonsense', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it('was refusing both before it ran', async () => {
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-rdn', '${ws.workspaceId}', 'asset', 'fund', 'RDN', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });
});
