import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createWorkspace, type Database, migrate, MIGRATIONS, nativeBalances, openCashAccount, type WorkspaceContext } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
let database: Database;
let ws: WorkspaceContext;

afterEach(() => {
  executor?.close();
  executor = undefined;
});

/** A version 88 database written the way a version 88 build would have: wallets, a bank with digits, a card's phone. */
async function atVersion88() {
  executor = createNodeExecutor();
  database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version <= 88));
  ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const w = ws.workspaceId;
  const account = (id: string, subtype: string, name: string, extra = '') =>
    database.execScript(
      `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at${extra ? ', number_last4, for_spending, card_tier' : ''})
       VALUES ('${id}', '${w}', NULL, 'asset', '${subtype}', '${name}', NULL, 'IDR', 'derived', NULL, 2, NULL, '2026-01-01T00:00:00Z'${extra})`,
    );
  await account('acc-bank', 'savings', 'Xpresi', ", '0917', 0, 'gold'");
  await account('acc-flazz', 'ewallet', 'Flazz');
  await account('acc-emoney', 'ewallet', ' mandiri E-Money ');
  await account('acc-office', 'ewallet', 'Flazz kantor');
  await account('acc-tapcash', 'ewallet', 'TapCash');
  await account('acc-gopay', 'ewallet', 'GoPay');
  // A wallet with a phone number kept on a cards row is a wallet, whatever it is called.
  await database.execScript(
    `INSERT INTO cards (id, workspace_id, account_id, last4, holder_name, is_primary, archived_at, created_at)
     VALUES ('card-phone', '${w}', 'acc-tapcash', '5521', NULL, 1, NULL, '2026-01-01T00:00:00Z')`,
  );
  await database.execScript(
    `INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
     VALUES ('tx-open', '${w}', '2026-01-01', 'Opening balance', 'manual', 'posted', '2026-01-01T00:00:00Z')`,
  );
  for (const [n, [accountId, amountMinor]] of ([['acc-bank', 7_350_000], ['acc-flazz', 215_000]] as [string, number][]).entries()) {
    await database.execScript(
      `INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor)
       VALUES ('tx-open-e${n}', '${w}', 'tx-open', '${accountId}', ${amountMinor}, 'IDR', 1, ${amountMinor})`,
    );
  }
}

const subtypes = async () => Object.fromEntries(await database.db.values<[string, string]>(sql`SELECT id, subtype FROM accounts WHERE id LIKE 'acc-%' ORDER BY id`));

describe('migration 0089', () => {
  beforeEach(atVersion88);

  it('is version 89 and named electronic_money', () => {
    expect(MIGRATIONS.find((m) => m.version === 89)).toMatchObject({ name: 'electronic_money' });
  });

  it('keeps every column, index and balance, and the digits, switch and tier added since 0069', async () => {
    const columns = await database.db.values(sql`PRAGMA table_info(accounts)`);
    const indexes = await database.db.values(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'accounts' ORDER BY name`);
    const balances = await nativeBalances(database, ws);
    await migrate(database);
    expect(await database.db.values(sql`PRAGMA table_info(accounts)`)).toEqual(columns);
    expect(await database.db.values(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'accounts' ORDER BY name`)).toEqual(indexes);
    expect(await nativeBalances(database, ws)).toEqual(balances);
    expect(await database.db.values(sql`SELECT number_last4, for_spending, card_tier FROM accounts WHERE id = 'acc-bank'`)).toEqual([['0917', 0, 'gold']]);
    expect(await database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it('makes a wallet called exactly by a chip card electronic money, and leaves every other wallet alone', async () => {
    await migrate(database);
    expect(await subtypes()).toEqual({
      'acc-bank': 'savings',
      'acc-emoney': 'emoney',
      'acc-flazz': 'emoney',
      'acc-gopay': 'ewallet',
      'acc-office': 'ewallet',
      'acc-tapcash': 'ewallet',
    });
  });

  it('takes electronic money as a kind of account from now on, filed under 0105', async () => {
    await migrate(database);
    const card = await openCashAccount(database, ws, { item: 'emoney', name: 'Brizzi', currency: 'IDR', openingBalanceMinor: 120_000 });
    expect(card.subtype).toBe('emoney');
    const [[code]] = (await database.db.values<[string]>(sql`SELECT coretax_code FROM asset_profiles WHERE account_id = ${card.id}`)) as [[string]];
    expect(code).toBe('0105');
  });
});
