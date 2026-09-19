import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  listAccounts,
  migrate,
  MIGRATIONS,
  postTransaction,
  replaceTransaction,
  saveExpenseTemplate,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb, type TestDb } from './helpers';

let executor: NodeExecutor | undefined;
let current: TestDb | undefined;
afterEach(() => {
  executor?.close();
  current?.executor.close();
  executor = undefined;
  current = undefined;
});

async function internetBill(database: Database, ws: WorkspaceContext) {
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const internet = (await listAccounts(database, ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const bill = await saveExpenseTemplate(database, ws, { name: 'Biznet Home', categoryAccountId: internet, moneyAccountId: bank.id, amountMinor: 450_000, dayOfMonth: 28 });
  const pay = (occurredOn: string, extra: { billMonth?: string } = {}) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Biznet Home',
      templateId: bill,
      ...extra,
      lines: expenseLines({ categoryAccountId: internet, paymentAccountId: bank.id, amountMinor: 450_000, currency: 'IDR' }),
    });
  return { bank, internet, bill, pay };
}

describe('migration 0044', () => {
  it('is version 44 and named bill_months', () => {
    expect(MIGRATIONS.find((m) => m.version === 44)).toMatchObject({ name: 'bill_months' });
  });

  it('files every bill payment a version 43 database holds under the month it was paid in', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 43));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    // The repositories look for the new tables before touching them, so these write what a version 43 build wrote.
    const { bank, internet, bill, pay } = await internetBill(older, ws);
    const paid = await pay('2026-09-03');
    const stray = await postTransaction(older, ws, {
      occurredOn: '2026-09-04',
      description: 'Warung',
      lines: expenseLines({ categoryAccountId: internet, paymentAccountId: bank.id, amountMinor: 20_000, currency: 'IDR' }),
    });
    // A template id that names no bill is left alone.
    await older.db.values(sql`UPDATE transactions SET template_id = 'not-a-bill' WHERE id = ${stray}`);

    expect(await migrate(older)).toEqual([44, 45, 46, 47, 49]);

    expect(await older.db.values(sql`SELECT template_id, workspace_id, pay_by_day FROM bill_windows`)).toEqual([[bill, ws.workspaceId, null]]);
    const [[starts]] = (await older.db.values<[string]>(sql`SELECT starts_month FROM bill_windows`)) as [[string]];
    expect(starts).toMatch(/^\d{4}-\d{2}$/);
    expect(await older.db.values(sql`SELECT transaction_id, template_id, bill_month FROM bill_payments`)).toEqual([[paid, bill, '2026-09']]);
  });

  it('records the month a payment names, defaults it to the month paid, and keeps it through a correction', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const { bank, internet, pay } = await internetBill(database, ws);

    const forAugust = await pay('2026-09-03', { billMonth: '2026-08' });
    const plain = await pay('2026-09-29');
    const monthOf = async (id: string) => database.db.values(sql`SELECT bill_month FROM bill_payments WHERE transaction_id = ${id}`);
    expect(await monthOf(forAugust)).toEqual([['2026-08']]);
    expect(await monthOf(plain)).toEqual([['2026-09']]);

    const corrected = await replaceTransaction(database, ws, forAugust, {
      occurredOn: '2026-09-03',
      description: 'Biznet Home',
      lines: expenseLines({ categoryAccountId: internet, paymentAccountId: bank.id, amountMinor: 475_000, currency: 'IDR' }),
    });
    expect(await monthOf(corrected)).toEqual([['2026-08']]);

    await expect(pay('2026-09-03', { billMonth: '2026-9' })).rejects.toMatchObject({ code: 'INVALID_BILL_MONTH' });
  });
});
