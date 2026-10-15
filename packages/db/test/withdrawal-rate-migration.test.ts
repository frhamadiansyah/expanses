import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, type Database, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { fxTablesExist, queueForeignRecalcTx, WITHDRAWAL_RATE_NOTICE_KEY } from '../src/repos/fx-tables';

/*
 * Migration 0071 (withdrawal rate, rulings R1 and R18). A database from before it: a lira cash account with money in
 * it, an empty euro wallet, a rupiah current account and a lira card. Invented figures.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function before0071(): Promise<Database> {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version < 71));
  return database;
}

const columns = async (database: Database, table: string) => (await database.db.values<[number, string]>(sql.raw(`SELECT cid, name FROM pragma_table_info('${table}')`))).map((r) => r[1]);

describe('migration 0071 (withdrawal rate)', () => {
  it('is version 71 and named withdrawal_rate', () => {
    expect(MIGRATIONS.find((m) => m.version === 71)).toMatchObject({ name: 'withdrawal_rate' });
  });

  it('makes the five local tables with their columns', async () => {
    const database = await before0071();
    expect(await fxTablesExist(database.db)).toBe(false);
    await migrate(database);
    expect(await fxTablesExist(database.db)).toBe(true);
    expect(await columns(database, 'fx_lot_uses')).toEqual(['account_id', 'out_entry_id', 'lot_entry_id', 'minor', 'cost_base_minor']);
    expect(await columns(database, 'fx_shortfalls')).toEqual(['account_id', 'entry_id', 'uncovered_minor']);
    expect(await columns(database, 'fx_day_values')).toEqual(['entry_id', 'base_minor', 'rate']);
    expect(await columns(database, 'fx_gain_loss')).toEqual(['transaction_id', 'category_entry_id', 'exchange_entry_id']);
    expect(await columns(database, 'fx_recalc_pending')).toEqual(['account_id', 'from_date']);
  });

  it('queues every foreign money account that holds entries, from its first entry, and asks for the notice once', async () => {
    const database = await before0071();
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const lira = await createAccount(database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY', openingBalanceMinor: 50_000, openingRateToBase: 512, openedOn: '2026-11-01' });
    await createAccount(database, ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
    await createAccount(database, ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-11-01' });
    await createAccount(database, ws, { name: 'Lira card', kind: 'liability', subtype: 'credit_card', currency: 'TRY', openingBalanceMinor: 10_000, openingRateToBase: 512, openedOn: '2026-11-01' });
    // A household placeholder in lira, with money on it: another member's, never this phone's to recalculate (R2).
    const placeholder = await createAccount(database, ws, { name: 'Partner · TRY', kind: 'asset', subtype: 'cash', currency: 'TRY', openingBalanceMinor: 20_000, openingRateToBase: 512, openedOn: '2026-11-01' });
    await database.db.run(sql`INSERT INTO book_member_accounts (account_id, book_id, member_id, currency) VALUES (${placeholder.id}, 'book-x', 'member-x', 'TRY')`);
    await migrate(database);
    expect(await database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[lira.id, null]]);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`)).toEqual([['due']]);
  });

  it('asks for no notice where nothing is held in another currency', async () => {
    const database = await before0071();
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await createAccount(database, ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-11-01' });
    await migrate(database);
    expect(await database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`)).toEqual([]);
  });
});

describe('queueForeignRecalcTx', () => {
  it('keeps the earliest date, and from-the-start wins', async () => {
    const database = await before0071();
    await migrate(database);
    const read = () => database.db.values(sql`SELECT from_date FROM fx_recalc_pending WHERE account_id = 'acc-1'`);
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-09'));
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-12'));
    expect(await read()).toEqual([['2026-11-09']]);
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-02'));
    expect(await read()).toEqual([['2026-11-02']]);
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', null));
    await database.transaction((tx) => queueForeignRecalcTx(tx, 'acc-1', '2026-11-01'));
    expect(await read()).toEqual([[null]]);
  });
});
