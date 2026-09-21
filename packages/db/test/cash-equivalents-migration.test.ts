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

/** A version 46 database with money in it, written the way a version 46 build would have written it. */
async function atVersion46() {
  executor = createNodeExecutor();
  database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version <= 46));
  ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });

  const w = ws.workspaceId;
  const account = (id: string, kind: string, subtype: string, name: string, currency: string | null) =>
    database.execScript(
      `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
       VALUES ('${id}', '${w}', NULL, '${kind}', '${subtype}', '${name}', NULL,
         ${currency === null ? 'NULL' : `'${currency}'`}, 'derived', NULL, 3, NULL, '2026-01-01T00:00:00Z')`,
    );
  await account('acc-bca', 'asset', 'bank', 'BCA Tahapan', 'IDR');
  await account('acc-gopay', 'asset', 'ewallet', 'GoPay', 'IDR');
  await account('acc-rdn', 'asset', 'fund', 'RDN Mandiri', 'IDR');
  await account('acc-visa', 'liability', 'credit_card', 'BCA Visa', 'IDR');
  await account('acc-groceries', 'expense', 'category', 'Belanja harian', null);

  await database.execScript(
    `INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
     VALUES ('tx-open', '${w}', '2026-01-01', 'Opening balance', 'manual', 'posted', '2026-01-01T00:00:00Z')`,
  );
  for (const [n, [accountId, amountMinor]] of ([['acc-bca', 20_000_000], ['acc-gopay', 500_000]] as [string, number][]).entries()) {
    await database.execScript(
      `INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor)
       VALUES ('tx-open-e${n}', '${w}', 'tx-open', '${accountId}', ${amountMinor}, 'IDR', 1, ${amountMinor})`,
    );
  }
}

/** Line breaks and runs of spaces differ between the migration that wrote a statement and the one that
    rewrites it; nothing about the constraint does. Compared on one line, the texts have to match. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const SUBTYPE_CHECK = /CHECK \(subtype IN \([^)]*\)\)/;
const allowedSubtypes = (ddl: string) => [...ddl.match(SUBTYPE_CHECK)![0].matchAll(/'(\w+)'/g)].map((m) => m[1]!).sort();
const shapeApartFromSubtypes = (ddl: string) => flat(ddl).replace(SUBTYPE_CHECK, 'CHECK (subtype IN (...))');

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

describe('migration 0047', () => {
  beforeEach(atVersion46);

  it('is version 47 and named cash_equivalents', () => {
    expect(MIGRATIONS.find((m) => m.version === 47)).toMatchObject({ name: 'cash_equivalents' });
  });

  it('leaves every account, every index and every balance exactly as it found them', async () => {
    const before = await accountsSchema();
    const balancesBefore = await nativeBalances(database, ws);
    expect(before.rows.length).toBeGreaterThan(4);

    expect(await migrate(database)).toEqual(MIGRATIONS.map((m) => m.version).filter((v) => v > 46));

    const after = await accountsSchema();
    expect(after.rows).toEqual(before.rows);
    expect(after.columns).toEqual(before.columns);
    expect(after.indexes).toEqual(before.indexes);
    expect(after.indexes.map(([name]) => name)).toEqual([
      'accounts_system_key',
      'accounts_workspace_kind',
      // The primary key's own index, proof the table was rebuilt with the same key and not merely emptied.
      'sqlite_autoindex_accounts_1',
    ]);
    expect(await nativeBalances(database, ws)).toEqual(balancesBefore);
    expect(await database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it('rewrites nothing in the table but the list of subtypes', async () => {
    const before = await accountsSchema();

    await migrate(database);

    const after = await accountsSchema();
    expect(shapeApartFromSubtypes(after.ddl)).toBe(shapeApartFromSubtypes(before.ddl));
    expect(allowedSubtypes(before.ddl)).not.toContain('time_deposit');
    expect(allowedSubtypes(after.ddl)).toEqual([...allowedSubtypes(before.ddl), 'other_cash', 'time_deposit'].sort());
    for (const clause of ['REFERENCES workspaces(id)', 'REFERENCES accounts(id)', 'id TEXT PRIMARY KEY']) {
      expect(flat(after.ddl)).toContain(clause);
    }
  });

  it('still refuses an asset with no currency, a workspace that does not exist, and a second system key', async () => {
    await migrate(database);
    const w = ws.workspaceId;
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-no-currency', '${w}', 'asset', 'time_deposit', 'Deposito with no currency', NULL, 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-nowhere', 'no-such-workspace', 'asset', 'other_cash', 'Cheque', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, system_key, sort_order, created_at)
         VALUES ('acc-dup', '${w}', 'equity', 'equity', 'Opening balances again', NULL, 'derived', 'opening_balance', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it('takes a time deposit and other cash equivalents, and still refuses a subtype it has never heard of', async () => {
    await migrate(database);

    const deposito = await createAccount(database, ws, { name: 'Deposito BCA 6 bulan', kind: 'asset', subtype: 'time_deposit', currency: 'IDR', openingBalanceMinor: 100_000_000 });
    const cheque = await createAccount(database, ws, { name: 'Cek BNI', kind: 'asset', subtype: 'other_cash', currency: 'IDR', openingBalanceMinor: 7_500_000 });

    const balances = await nativeBalances(database, ws);
    expect(balances[deposito.id]).toBe(100_000_000);
    expect(balances[cheque.id]).toBe(7_500_000);

    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-nonsense', '${ws.workspaceId}', 'asset', 'crypto_wallet', 'Nonsense', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it('was refusing both before it ran', async () => {
    for (const subtype of ['time_deposit', 'other_cash']) {
      await expect(
        database.execScript(
          `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
           VALUES ('acc-${subtype}', '${ws.workspaceId}', 'asset', '${subtype}', 'Too early', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
        ),
      ).rejects.toThrow();
    }
  });

  it('adds deposit_terms, which nothing had before, keyed to the account and refusing a negative rate', async () => {
    expect(await database.db.values(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deposit_terms'`)).toEqual([]);

    await migrate(database);

    const columns = (await database.db.values<unknown[]>(sql`PRAGMA table_info(deposit_terms)`)).map((row) => String(row[1]));
    expect(columns).toEqual(['account_id', 'workspace_id', 'matures_on', 'rate_bps', 'created_at']);
    const deposito = await createAccount(database, ws, { name: 'Deposito BCA', kind: 'asset', subtype: 'time_deposit', currency: 'IDR' });
    await database.execScript(
      `INSERT INTO deposit_terms (account_id, workspace_id, matures_on, rate_bps, created_at)
       VALUES ('${deposito.id}', '${ws.workspaceId}', '2027-03-01', 625, '2026-09-18T00:00:00Z')`,
    );
    await expect(
      database.execScript(
        `INSERT INTO deposit_terms (account_id, workspace_id, matures_on, rate_bps, created_at)
         VALUES ('acc-bca', '${ws.workspaceId}', '2027-03-01', -1, '2026-09-18T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    expect(await database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });
});
