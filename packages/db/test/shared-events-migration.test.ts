import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { coretaxInputsFor, createAccount, migrate, MIGRATIONS, nativeBalances, netWorthAt, postTransaction, sheetInputsAt, systemAccountId } from '../src/index';
import { setupDb } from './helpers';
import type { NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const columns = async (database: Awaited<ReturnType<typeof setupDb>>['database'], table: string) =>
  (await database.db.values<[number, string]>(sql.raw(`SELECT cid, name FROM pragma_table_info('${table}')`))).map((r) => r[1]);

describe('migration 0069 (shared events)', () => {
  it('is version 69 and named shared_events', () => {
    expect(MIGRATIONS.find((m) => m.version === 69)).toMatchObject({ name: 'shared_events' });
  });

  it('makes the seven synced tables and the four local ones with the spec’s columns', async () => {
    const t = await setupDb();
    executor = t.executor;
    expect(await columns(t.database, 'event_expenses')).toEqual(['book_id', 'id', 'occurred_on', 'amount_minor', 'currency', 'rate_to_event', 'payer_person_id', 'payer_member_id', 'voided_at']);
    expect(await columns(t.database, 'event_expense_details')).toEqual(['book_id', 'id', 'note', 'category_id', 'split_mode', 'split_json', 'recorded_by', 'updated_by']);
    expect(await columns(t.database, 'event_settlements')).toEqual(['book_id', 'id', 'occurred_on', 'from_person_id', 'to_person_id', 'from_member_id', 'to_member_id', 'amount_minor', 'voided_at']);
    for (const table of ['shared_events', 'event_people', 'event_categories', 'event_items_shared', 'event_books', 'event_postings', 'event_category_accounts', 'event_log_currency']) {
      expect((await columns(t.database, table)).length, table).toBeGreaterThan(0);
    }
  });

  it('takes an event_balance account and still refuses a subtype it has never heard of', async () => {
    const t = await setupDb();
    executor = t.executor;
    const trip = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'TRY' });
    expect(trip.subtype).toBe('event_balance');
    await expect(
      t.database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-x', '${t.ws.workspaceId}', 'asset', 'treasure', 'Chest', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    expect(await t.database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it('counts a trip balance owed to this person as a receivable, and one this person owes as a payable', async () => {
    const t = await setupDb();
    executor = t.executor;
    const owedTo = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'IDR' });
    const owing = await createAccount(t.database, t.ws, { name: 'Hill weekend', kind: 'asset', subtype: 'event_balance', currency: 'IDR' });
    const equity = await systemAccountId(t.database.db, t.ws, 'opening_balance');
    await postTransaction(t.database, t.ws, { occurredOn: '2026-10-01', description: 'x', lines: [{ accountId: owedTo.id, amountMinor: 300_000, currency: 'IDR' }, { accountId: equity, amountMinor: -300_000, currency: 'IDR' }] });
    await postTransaction(t.database, t.ws, { occurredOn: '2026-10-01', description: 'y', lines: [{ accountId: owing.id, amountMinor: -120_000, currency: 'IDR' }, { accountId: equity, amountMinor: 120_000, currency: 'IDR' }] });

    const worth = await netWorthAt(t.database, t.ws, '2026-10-31', {});
    expect(worth.assetsMinor).toBe(300_000);
    expect(worth.liabilitiesMinor).toBe(120_000);
    expect(worth.netWorthMinor).toBe(180_000);
    expect(worth.stack!.assets.receivable).toBe(300_000);
    expect(worth.stack!.liabilities.payable).toBe(120_000);

    const sheet = await sheetInputsAt(t.database, t.ws, '2026-10-31');
    expect(sheet.assets.map((a) => a.accountId)).toEqual([owedTo.id]);
    expect(sheet.liabilities).toEqual([expect.objectContaining({ accountId: owing.id, subtype: 'payable', balanceMinor: 120_000 })]);

    const tax = await coretaxInputsFor(t.database, t.ws, 2026);
    expect(tax.receivables).toEqual([expect.objectContaining({ accountId: owedTo.id, code: '0209', balanceMinor: 300_000 })]);
    expect(tax.debts).toEqual([expect.objectContaining({ accountId: owing.id, code: '109', balanceMinor: 120_000 })]);
    expect(await nativeBalances(t.database, t.ws)).toMatchObject({ [owedTo.id]: 300_000, [owing.id]: -120_000 });
  });

  it('keeps every account and balance when a version-68 database is migrated', async () => {
    const t = await setupDb();
    executor = t.executor;
    // setupDb already ran 0069; the version-68 path is the account-types and cash-equivalents tests' (their lists grow
    // by event_balance). Here: the rebuild left the foreign keys whole.
    expect(await t.database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(await migrate(t.database)).toEqual([]);
  });
});
