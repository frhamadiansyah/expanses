import { expenseLines } from '@expanses/core';
import { createAccount, createDatabase, createDraft, createWorkspace, dismissDraft, listAccounts, listDrafts, migrate, postTransaction, reopenDraft } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDeferredDeletes } from './deferred-delete';
import { deleteTransaction } from './member-transfer';

/* Invented figures throughout. */
async function setup() {
  const executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const restaurants = (await listAccounts(database, ws)).find((a) => a.name === 'Restaurants')!.id;
  const bank = (await createAccount(database, ws, { name: 'Bank Satu', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 7_350_000, openedOn: '2026-08-01' })).id;
  const spend = (description: string, amountMinor: number) =>
    postTransaction(database, ws, {
      occurredOn: '2026-08-14',
      description,
      lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: bank, amountMinor, currency: 'IDR' }),
      ratesToBase: { IDR: 1 },
    });
  return { database, ws, bank, spend, close: () => executor.close() };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Everything the ledger holds: every transaction and its status, every entry, and each account's balance. */
async function ledger({ database }: Setup) {
  const transactions = await database.db.values(sql`SELECT id, status, occurred_on, description FROM transactions ORDER BY id`);
  const entries = await database.db.values(sql`SELECT transaction_id, account_id, amount_minor, currency FROM entries ORDER BY transaction_id, account_id, amount_minor`);
  const balances = await database.db.values(
    sql`SELECT e.account_id, SUM(e.amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE t.status = 'posted' GROUP BY e.account_id ORDER BY e.account_id`,
  );
  return { transactions, entries, balances };
}

async function bankBalance({ database, bank }: Setup) {
  const [row] = await database.db.values<[number]>(
    sql`SELECT SUM(e.amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE t.status = 'posted' AND e.account_id = ${bank}`,
  );
  return Number(row![0]);
}

function deferred(s: Setup) {
  const failures: unknown[] = [];
  let settled = 0;
  const deletes = createDeferredDeletes({
    commit: (id) => deleteTransaction(s.database, s.ws, id),
    settled: async () => {
      settled += 1;
    },
    failed: (error) => failures.push(error),
    changed: () => undefined,
  });
  return { deletes, failures, settledCount: () => settled };
}

describe('a swipe delete with Undo', () => {
  it('Undo leaves the ledger exactly as it was: nothing was ever written', async () => {
    const s = await setup();
    const id = await s.spend('Warung Sate', 185_000);
    const before = await ledger(s);
    const { deletes } = deferred(s);

    await deletes.begin(id, 'Deleted Warung Sate');
    expect(deletes.pending().has(id)).toBe(true);
    expect(deletes.shown()).toEqual({ id, text: 'Deleted Warung Sate' });
    // Drawn as gone, but not yet written: the ledger has not moved.
    expect(await ledger(s)).toEqual(before);

    deletes.undo();
    expect(deletes.pending().size).toBe(0);
    expect(deletes.shown()).toBeNull();
    expect(await ledger(s)).toEqual(before);
    await s.close();
  });

  it('the toast going by writes the delete: the money is back in the bank', async () => {
    const s = await setup();
    const id = await s.spend('Warung Sate', 185_000);
    expect(await bankBalance(s)).toBe(7_350_000 - 185_000);
    const { deletes, settledCount } = deferred(s);

    await deletes.begin(id, 'Deleted Warung Sate');
    await deletes.expire();
    expect(await bankBalance(s)).toBe(7_350_000);
    expect(settledCount()).toBe(1);
    expect(deletes.pending().size).toBe(0);
    const [status] = await s.database.db.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${id}`);
    expect(status![0]).toBe('void');
    await s.close();
  });

  it('a second delete writes the first one and keeps only its own Undo', async () => {
    const s = await setup();
    const first = await s.spend('Warung Sate', 185_000);
    const second = await s.spend('Kopi Pagi', 42_000);
    const { deletes } = deferred(s);

    await deletes.begin(first, 'Deleted Warung Sate');
    await deletes.begin(second, 'Deleted Kopi Pagi');
    expect(deletes.shown()?.id).toBe(second);
    expect(await bankBalance(s)).toBe(7_350_000 - 42_000);

    // Undo now takes back the second only, exactly.
    deletes.undo();
    expect(await bankBalance(s)).toBe(7_350_000 - 42_000);
    expect(deletes.pending().size).toBe(0);
    await s.close();
  });

  it('leaving the list writes what is still waiting', async () => {
    const s = await setup();
    const id = await s.spend('Warung Sate', 185_000);
    const { deletes } = deferred(s);
    await deletes.begin(id, 'Deleted Warung Sate');
    await deletes.flush();
    expect(await bankBalance(s)).toBe(7_350_000);
    expect(deletes.shown()).toBeNull();
    await s.close();
  });

  it('a delete the ledger refuses is said, and the row comes back', async () => {
    const s = await setup();
    const id = await s.spend('Warung Sate', 185_000);
    const before = await ledger(s);
    const failures: unknown[] = [];
    const deletes = createDeferredDeletes({
      commit: async () => {
        throw new Error('refused');
      },
      settled: async () => undefined,
      failed: (error) => failures.push(error),
      changed: () => undefined,
    });
    await deletes.begin(id, 'Deleted Warung Sate');
    await deletes.expire();
    expect(failures).toHaveLength(1);
    expect(deletes.pending().has(id)).toBe(false);
    expect(await ledger(s)).toEqual(before);
    await s.close();
  });
});

describe('a swipe discard with Undo', () => {
  it('puts the draft back exactly as it was read, sightings folded into it included', async () => {
    const s = await setup();
    const draft = await createDraft(s.database, s.ws, { source: 'notification', occurredOn: '2026-08-14', description: 'TOKO ROTI MANIS', amountMinor: 64_000, currency: 'IDR', accountId: s.bank, imageFile: 'capture-roti.jpg' });
    await createDraft(s.database, s.ws, { source: 'notification', occurredOn: '2026-08-14', description: 'TOKO ROTI MANIS', amountMinor: 64_000, currency: 'IDR', mergedInto: draft });
    const before = await s.database.db.values(sql`SELECT * FROM draft_transactions ORDER BY id`);
    const ledgerBefore = await ledger(s);

    await dismissDraft(s.database, s.ws, draft);
    expect((await listDrafts(s.database, s.ws)).map((d) => d.id)).not.toContain(draft);
    await reopenDraft(s.database, s.ws, draft);

    expect(await s.database.db.values(sql`SELECT * FROM draft_transactions ORDER BY id`)).toEqual(before);
    // A capture is not money: neither way touches the ledger.
    expect(await ledger(s)).toEqual(ledgerBefore);
    await s.close();
  });
});
