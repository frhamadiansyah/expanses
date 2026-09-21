import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { transferLines } from '@expanses/core';
import {
  confirmDepositEvent,
  createDatabase,
  createWorkspace,
  depositIncomePayments,
  getDepositAutomation,
  incomeInputsFor,
  listDueDeposits,
  migrate,
  MIGRATIONS,
  openCashAccount,
  postTransaction,
  replaceTransaction,
  saveDepositAutomation,
  voidTransaction,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const schemaOf = async (database: ReturnType<typeof createDatabase>) =>
  new Map(
    (await database.db.values<[string, string | null]>(sql`SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`)).map(
      ([name, ddl]) => [name, ddl] as const,
    ),
  );

describe('migration 0054', () => {
  it('is version 54 and named deposit_automation', () => {
    expect(MIGRATIONS.find((m) => m.version === 54)).toMatchObject({ name: 'deposit_automation' });
  });

  it('adds its two tables to a version-49 database with a deposit in it, and changes nothing that was there', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await openCashAccount(database, ws, { item: 'time_deposit', name: 'BCA Deposito', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-07-15', maturesOn: '2026-10-15', rateBps: 425 });
    const before = await schemaOf(database);
    const termsBefore = await database.db.values(sql`SELECT account_id, matures_on, rate_bps FROM deposit_terms`);

    expect(await migrate(database)).toContain(54);

    const after = await schemaOf(database);
    for (const [name, ddl] of before) expect(after.get(name)).toBe(ddl);
    expect(after.has('deposit_automation')).toBe(true);
    expect(after.has('deposit_events')).toBe(true);
    expect(after.has('deposit_events_once')).toBe(true);
    expect(await database.db.values(sql`SELECT account_id, matures_on, rate_bps FROM deposit_terms`)).toEqual(termsBefore);
    expect(await database.db.values(sql`SELECT count(*) FROM deposit_automation`)).toEqual([[0]]);
  });

  it('reads a deposit as off and refuses a save on a database stopped before 0054, then picks it up on the same handle once migrated', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const deposito = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'BCA Deposito',
      currency: 'IDR',
      openingBalanceMinor: 50_000_000,
      openedOn: '2026-07-15',
      maturesOn: '2026-10-15',
      rateBps: 425,
    });

    // 1. Every deposit reads as off, with the S2 defaults, before the tables exist.
    expect(await getDepositAutomation(database, ws, deposito.id)).toMatchObject({ enabled: false, enabledOn: null, termMonths: 1 });

    // 2. Saving is refused rather than failing on a missing table.
    await expect(
      saveDepositAutomation(database, ws, {
        accountId: deposito.id,
        enabled: true,
        atMaturity: 'principal',
        interestPaid: 'at_maturity',
        payoutAccountId: null,
        termMonths: 3,
        keepRate: true,
        taxBps: 2_000,
        taxExempt: false,
        today: '2026-07-15',
      }),
    ).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await getDepositAutomation(database, ws, deposito.id)).toMatchObject({ enabled: false });

    // 3. On the very same handle, once migrated, the settings are picked up.
    expect(await migrate(database)).toContain(54);
    await saveDepositAutomation(database, ws, {
      accountId: deposito.id,
      enabled: true,
      atMaturity: 'principal',
      interestPaid: 'at_maturity',
      payoutAccountId: null,
      termMonths: 3,
      keepRate: true,
      taxBps: 2_000,
      taxExempt: false,
      today: '2026-07-15',
    });
    expect(await getDepositAutomation(database, ws, deposito.id)).toMatchObject({ enabled: true, enabledOn: '2026-07-15' });
  });

  it('keeps every void, edit, due list and tax report working on a database stopped before 0054', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await openCashAccount(database, ws, { item: 'bank', name: 'BCA', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-07-15' });
    const deposito = await openCashAccount(database, ws, { item: 'time_deposit', name: 'BCA Deposito', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-07-15', maturesOn: '2026-10-15', rateBps: 425 });
    const move = (amountMinor: number) => ({
      occurredOn: '2026-08-01',
      description: 'Top up',
      lines: transferLines({ fromAccountId: bank.id, toAccountId: deposito.id, amountMinor, currency: 'IDR' }),
    });
    const first = await postTransaction(database, ws, move(1_000));
    const edited = await replaceTransaction(database, ws, first, move(2_000));
    await voidTransaction(database, ws, edited);
    expect(await listDueDeposits(database, ws, '2026-12-31')).toEqual([]);
    expect(await depositIncomePayments(database, ws)).toEqual([]);
    expect(await incomeInputsFor(database, ws, 2026)).toEqual([]);
    await expect(
      confirmDepositEvent(database, ws, { accountId: deposito.id, kind: 'maturity', dueOn: '2026-10-15', today: '2026-10-15', principalMinor: 50_000_000, grossMinor: 535_616, taxMinor: 107_123, newRateBps: 425, newTermMonths: 3 }),
    ).rejects.toMatchObject({ code: 'NOT_READY' });
  });
});
