import { expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  categoryTotalsBetween,
  createAccount,
  eventSpendingBetween,
  inBook,
  listAccounts,
  listTransactions,
  nativeBalances,
  ownerScope,
  periodFlows,
  personalBook,
  postTransaction,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Shared events §5.1 (Review Focus 1). A fish dinner a shared event put in this phone's books — on a local share
 * category that belongs to no workspace, with an `event_postings` row — must not reach any workspace's list, category
 * totals, Cashflow figures, budget sheet or event line, and must stay in the wallet's own history and balance.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function trip() {
  const t = await setupDb();
  executor = t.executor;
  const book = await personalBook(t.database, t.ws);
  const ws = inBook(t.ws, book.id);
  const wallet = await createAccount(t.database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-09-30' });
  const groceries = (await listAccounts(t.database, ws)).find((a) => a.name === 'Groceries')!;
  // The local copy of an event category, as the derivation (Task 5) makes it: an expense account in no book.
  await t.database.execScript(
    `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
     VALUES ('share-dinners', '${t.ws.workspaceId}', NULL, 'expense', 'category', 'Dinners', NULL, NULL, 'derived', NULL, 0, NULL, '2026-10-01T00:00:00Z')`,
  );
  await t.database.execScript(`INSERT INTO event_category_accounts (book_id, category_id, account_id, earn_category_id) VALUES ('ev-book', 'cat-dinners', 'share-dinners', NULL)`);
  await postTransaction(t.database, ws, { occurredOn: '2026-10-05', description: 'Market', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: wallet.id, amountMinor: 50_000, currency: 'IDR' }) });
  const dinner = await postTransaction(t.database, ws, {
    occurredOn: '2026-10-06',
    description: 'Fish dinner',
    lines: expenseLines({ categoryAccountId: 'share-dinners', paymentAccountId: wallet.id, amountMinor: 80_000, currency: 'IDR' }),
    eventId: 'ev-local',
  });
  await t.database.execScript(`INSERT INTO event_postings (book_id, record_id, kind, transaction_id) VALUES ('ev-book', 'exp-1', 'expense', '${dinner}')`);
  return { ...t, ws, wallet, groceries, dinner };
}

const october = { from: '2026-10-01', to: '2026-10-31' };

describe('§5.1: an event-only transaction is in no workspace', () => {
  it('the workspace list leaves it out; the wallet’s history (read owner-wide) and a receipt keep it', async () => {
    const t = await trip();
    const listed = (await listTransactions(t.database, t.ws)).map((v) => v.description);
    expect(listed).toContain('Market');
    expect(listed).not.toContain('Fish dinner');
    expect((await listTransactions(t.database, ownerScope(t.ws), { accountId: t.wallet.id })).map((v) => v.description)).toContain('Fish dinner');
    expect((await listTransactions(t.database, ownerScope(t.ws), { id: t.dinner }))).toHaveLength(1);
    expect((await listTransactions(t.database, ownerScope(t.ws), { eventId: 'ev-local' })).map((v) => v.id)).toEqual([t.dinner]);
  });

  it('category totals leave it out, in the workspace and owner-wide alike', async () => {
    const t = await trip();
    for (const ws of [t.ws, ownerScope(t.ws)]) {
      const totals = await categoryTotalsBetween(t.database, ws, 'expense', october.from, october.to);
      expect(totals.map((row) => row.accountId)).toEqual([t.groceries.id]);
    }
  });

  it('Cashflow’s spending leaves it out', async () => {
    const t = await trip();
    expect((await periodFlows(t.database, t.ws, october)).spendingMinor).toBe(50_000);
    expect((await periodFlows(t.database, ownerScope(t.ws), october)).spendingMinor).toBe(50_000);
  });

  it('the budget sheet and its event line leave it out', async () => {
    const t = await trip();
    const sheet = await budgetSheetFor(t.database, t.ws, '2026-10');
    expect(sheet.spendingActualMinor).toBe(50_000);
    expect(sheet.eventSpendingMinor).toBe(0);
    expect((await eventSpendingBetween(t.database, ownerScope(t.ws), october.from, october.to)).amountMinor).toBe(0);
  });

  it('the wallet’s balance still counts it', async () => {
    const t = await trip();
    expect((await nativeBalances(t.database, t.ws))[t.wallet.id]).toBe(1_000_000 - 50_000 - 80_000);
  });
});
