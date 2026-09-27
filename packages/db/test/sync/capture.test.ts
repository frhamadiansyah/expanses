import { expenseLines, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  archiveAccount,
  clearBudgetOverride,
  clearCategoryNeed,
  clearIncomeOverride,
  createAccount,
  deleteExpenseTemplate,
  listAccounts,
  personalBook,
  postTransaction,
  postTransactionTx,
  removeBudget,
  renameAccount,
  renameBook,
  replaceTransaction,
  saveBudget,
  saveCategoryNeed,
  saveExpectedIncome,
  saveExpenseTemplate,
  setBookEventsInBudget,
  setBudgetOverride,
  setIncomeOverride,
  skipBill,
  unskipBill,
  voidTransaction,
  voidTransactionTx,
} from '../../src/index';
import { budgets } from '../../src/schema-budget';
import { configureCapture, localDeviceId, pauseCapture, withCapture } from '../../src/sync/capture';
import { setupDb } from '../helpers';
import { clearOutbox, fieldClock, lineageRow, outboxChangeSets, outboxOps, shareBookForTest } from './sync-helpers';

async function sharedHousehold() {
  const t = await setupDb();
  const { database, ws } = t;
  const book = await personalBook(database, ws);
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const groceries = all.find((a) => a.name === 'Groceries')!;
  const dining = all.find((a) => a.kind === 'expense' && a.name !== 'Groceries' && a.parentId === groceries.parentId)!;
  await shareBookForTest(database, book.id, 'member-me');
  return { ...t, book, bca, groceries, dining };
}

describe('capture: the device id', () => {
  it('refuses to mint a stand-in id while a book is shared and no device is configured (final review, I3)', async () => {
    const { database, ws } = await setupDb();
    const book = await personalBook(database, ws);
    // Straight into the table, without the test helper's leave to use the stand-in: as the app would stand if it wrote
    // to a shared book before its engine existed.
    await database.db.run(
      sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${book.id}, 'relay-x', 1, 'member-x', 'active', '2026-09-01T00:00:00.000Z')`,
    );
    await expect(database.transaction((tx) => localDeviceId(tx))).rejects.toThrow(/no device/);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = 'sync.device'`)).toEqual([]);
    // Configured (as the engine does when it is made), it is that id.
    configureCapture(database, { deviceId: 'the-engine-device' });
    expect(await database.transaction((tx) => localDeviceId(tx))).toBe('the-engine-device');
  });
});

describe('capture: beside a book no longer shared', () => {
  it('a write aimed at another book costs the read-only check nothing (final review, minor 8)', async () => {
    const { executor, database, ws } = await setupDb();
    const personal = await personalBook(database, ws);
    // Every statement the transaction sends, counted at the executor: the one seam every query passes.
    const queries = async (work: () => Promise<void>) => {
      let n = 0;
      const query = executor.query.bind(executor);
      executor.query = (...args: Parameters<typeof query>) => {
        n += 1;
        return query(...args);
      };
      try {
        await work();
      } finally {
        executor.query = query;
      }
      return n;
    };
    // A write naming only Personal, before and after another book here has gone read-only (§8.6).
    const other = (await database.db.values<[string]>(sql`SELECT id FROM books WHERE workspace_id = ${ws.workspaceId} AND id <> ${personal.id} LIMIT 1`))[0]?.[0]
      ?? (await database.transaction(async (tx) => {
        await tx.run(sql`INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, archived_at, created_at) VALUES ('other-book', ${ws.workspaceId}, 'Other', 'shared', 'IDR', 0, 9, NULL, '2026-09-01T00:00:00.000Z')`);
        return 'other-book';
      }));
    // Targets that cannot be in the other book: one that names Personal, and Personal's own book row (keyed by its id).
    const aimed = () => database.transaction((tx) => withCapture(tx, [{ entity: 'budget', bookId: personal.id }, { entity: 'book', id: personal.id }], async () => undefined));
    const before = await queries(aimed);
    await database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at, unshared_reason) VALUES (${other}, 'relay-o', 1, 'member-o', 'unshared', '2026-09-01T00:00:00.000Z', 'stopped')`);
    const after = await queries(aimed);
    expect(after).toBe(before);
  });
});

describe('capture: outside a shared book', () => {
  it('emits nothing and makes no clock', async () => {
    const { database, ws } = await setupDb();
    const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!;
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 1_000_000 });
    await postTransaction(database, ws, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' }),
    });
    expect(await outboxOps(database)).toEqual([]);
    const clock = await database.db.values(sql`SELECT value FROM settings WHERE key = 'sync.hlc'`);
    expect(clock).toEqual([]);
  });
});

describe('capture: rows edited in place', () => {
  it('a category rename emits only its name, and the field clock is the change-set hlc', async () => {
    const { database, ws, groceries } = await sharedHousehold();
    await renameAccount(database, ws, groceries.id, 'Groceries & market');
    const sets = await outboxChangeSets(database);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.member).toBe('member-me');
    expect(sets[0]!.ops).toEqual([{ entity: 'category', id: groceries.id, op: 'upsert', fields: { name: 'Groceries & market' } }]);
    expect(await fieldClock(database, 'category', groceries.id, 'name')).toBe(sets[0]!.hlc);
    expect(sets[0]!.deviceId).toBe(await database.transaction((tx) => localDeviceId(tx)));
  });

  it('a new category emits every field', async () => {
    const { database, ws, groceries } = await sharedHousehold();
    const snacks = await createAccount(database, ws, { name: 'Snacks', kind: 'expense', subtype: 'category', currency: null, parentId: groceries.parentId });
    expect(await outboxOps(database)).toEqual([
      {
        entity: 'category',
        id: snacks.id,
        op: 'upsert',
        fields: {
          name: 'Snacks',
          parentId: groceries.parentId,
          kind: 'expense',
          subtype: 'category',
          currency: null,
          icon: null,
          systemKey: null,
          sortOrder: 0,
          archivedAt: null,
        },
      },
    ]);
  });

  it('an archived category emits archivedAt only', async () => {
    const { database, ws, groceries } = await sharedHousehold();
    await archiveAccount(database, ws, groceries.id);
    const ops = await outboxOps(database);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'category', id: groceries.id, op: 'upsert' });
    expect(Object.keys((ops[0] as { fields: object }).fields)).toEqual(['archivedAt']);
  });

  it('a category need is an upsert of need, and clearing it is a delete', async () => {
    const { database, ws, groceries } = await sharedHousehold();
    await saveCategoryNeed(database, ws, groceries.id, 'essential');
    await saveCategoryNeed(database, ws, groceries.id, 'lifestyle');
    await clearCategoryNeed(database, ws, groceries.id);
    expect(await outboxOps(database)).toEqual([
      { entity: 'category_need', id: groceries.id, op: 'upsert', fields: { need: 'essential' } },
      // A revivable row travels whole and names what changed (§7.2).
      { entity: 'category_need', id: groceries.id, op: 'upsert', fields: { need: 'lifestyle' }, changed: ['need'] },
      { entity: 'category_need', id: groceries.id, op: 'delete' },
    ]);
  });

  it('a budget, its frequency, its overrides, and its removal', async () => {
    const { database, ws, groceries } = await sharedHousehold();
    const budgetId = await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 3_000_000 });
    expect(await outboxOps(database)).toEqual([
      { entity: 'budget', id: budgetId, op: 'upsert', fields: { categoryAccountId: groceries.id, amountMinor: 3_000_000 } },
    ]);

    await clearOutbox(database);
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 700_000, frequency: 'weekly' });
    const ops = await outboxOps(database);
    const monthly = (await database.db.select({ amountMinor: budgets.amountMinor }).from(budgets))[0]!.amountMinor;
    expect(ops).toEqual([
      { entity: 'budget', id: budgetId, op: 'upsert', fields: { amountMinor: monthly } },
      { entity: 'budget_frequency', id: budgetId, op: 'upsert', fields: { frequency: 'weekly', amountAsSetMinor: 700_000 } },
    ]);

    await clearOutbox(database);
    await setBudgetOverride(database, ws, { categoryAccountId: groceries.id, month: '2026-12', amountMinor: 5_000_000 });
    const [override] = await outboxOps(database);
    expect(override).toMatchObject({ entity: 'budget_override', op: 'upsert', fields: { budgetId, month: '2026-12', amountMinor: 5_000_000 } });
    await setBudgetOverride(database, ws, { categoryAccountId: groceries.id, month: '2026-12', amountMinor: 4_000_000 });
    await clearBudgetOverride(database, ws, groceries.id, '2026-12');
    expect((await outboxOps(database)).slice(1)).toEqual([
      { entity: 'budget_override', id: override!.id, op: 'upsert', fields: { amountMinor: 4_000_000 } },
      { entity: 'budget_override', id: override!.id, op: 'delete' },
    ]);

    await clearOutbox(database);
    await removeBudget(database, ws, groceries.id);
    expect(await outboxOps(database)).toEqual([
      { entity: 'budget', id: budgetId, op: 'delete' },
      { entity: 'budget_frequency', id: budgetId, op: 'delete' },
    ]);
    const tombstones = await database.db.values(sql`SELECT entity, id FROM sync_tombstones ORDER BY entity`);
    expect(tombstones).toContainEqual(['budget', budgetId]);
  });

  it('book income and a bonus month', async () => {
    const { database, ws, book } = await sharedHousehold();
    await saveExpectedIncome(database, ws, 20_000_000);
    await setIncomeOverride(database, ws, { month: '2026-12', amountMinor: 40_000_000 });
    await clearIncomeOverride(database, ws, '2026-12');
    expect(await outboxOps(database)).toEqual([
      { entity: 'book_income', id: book.id, op: 'upsert', fields: { expectedIncomeMinor: 20_000_000 } },
      { entity: 'book_income_override', id: `${book.id}|2026-12`, op: 'upsert', fields: { amountMinor: 40_000_000 } },
      { entity: 'book_income_override', id: `${book.id}|2026-12`, op: 'delete' },
    ]);
  });

  it('the book itself: its name and its events setting', async () => {
    const { database, ws, book } = await sharedHousehold();
    await renameBook(database, ws, book.id, 'Rumah');
    await setBookEventsInBudget(database, ws, book.id, true);
    expect(await outboxOps(database)).toEqual([
      { entity: 'book', id: book.id, op: 'upsert', fields: { name: 'Rumah' } },
      { entity: 'book', id: book.id, op: 'upsert', fields: { countEventsInBudget: 1 } },
    ]);
  });

  it('a bill travels with its payer, its window, its skips, and its archive', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    const id = await saveExpenseTemplate(database, ws, {
      name: 'Internet',
      categoryAccountId: groceries.id,
      moneyAccountId: bca.id,
      amountMinor: 400_000,
      dayOfMonth: 5,
      payByDay: 10,
      startsMonth: '2026-09',
    });
    const ops = await outboxOps(database);
    expect(ops).toEqual([
      {
        entity: 'bill',
        id,
        op: 'upsert',
        fields: {
          name: 'Internet',
          categoryAccountId: groceries.id,
          amountMinor: 400_000,
          dayOfMonth: 5,
          active: 1,
          archivedAt: null,
          payer: { memberId: 'member-me', label: 'BCA Tahapan' },
        },
      },
      { entity: 'bill_window', id, op: 'upsert', fields: { payByDay: 10, startsMonth: '2026-09' } },
    ]);

    await clearOutbox(database);
    await saveExpenseTemplate(database, ws, { id, name: 'Internet', categoryAccountId: groceries.id, moneyAccountId: bca.id, amountMinor: 450_000, dayOfMonth: 5, payByDay: 10 });
    expect(await outboxOps(database)).toEqual([{ entity: 'bill', id, op: 'upsert', fields: { amountMinor: 450_000 } }]);

    await clearOutbox(database);
    await skipBill(database, ws, id, '2026-10');
    await skipBill(database, ws, id, '2026-10');
    await unskipBill(database, ws, id, '2026-10');
    await deleteExpenseTemplate(database, ws, id);
    const later = await outboxOps(database);
    expect(later.slice(0, 2)).toEqual([
      { entity: 'bill_skip', id: `${id}|2026-10`, op: 'upsert', fields: {} },
      { entity: 'bill_skip', id: `${id}|2026-10`, op: 'delete' },
    ]);
    expect(later[2]).toMatchObject({ entity: 'bill', id, op: 'upsert' });
    expect(Object.keys((later[2] as { fields: object }).fields)).toEqual(['archivedAt']);
    expect(later).toHaveLength(3);
  });

  it('a rolled-back write leaves nothing in the outbox', async () => {
    const { database, groceries } = await sharedHousehold();
    await expect(
      database.transaction(async (tx) => {
        await tx.update(budgets).set({ amountMinor: 1 });
        const { withCapture } = await import('../../src/sync/capture');
        await withCapture(tx, { entity: 'category', id: groceries.id }, async () => {
          await tx.run(sql`UPDATE accounts SET name = 'X' WHERE id = ${groceries.id}`);
        });
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(await outboxOps(database)).toEqual([]);
  });
});

describe('capture: purchases', () => {
  it('a post emits every field and starts a lineage paid by this member', async () => {
    const { database, ws, book, bca, groceries } = await sharedHousehold();
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      channel: 'offline',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' }),
    });
    const ops = await outboxOps(database);
    expect(ops).toEqual([
      {
        entity: 'purchase',
        id,
        op: 'upsert',
        fields: {
          occurredOn: '2026-09-10',
          description: 'Superindo',
          channel: 'offline',
          excluded: 0,
          bill: null,
          money: {
            lines: [{ categoryId: groceries.id, amountMinor: 50_000, currency: 'IDR', amountBaseMinor: 50_000, memo: null }],
            originalCurrency: null,
            originalAmountMinor: null,
            paidBy: 'member-me',
            paidLabel: 'BCA Tahapan',
          },
        },
      },
    ]);
    expect(await lineageRow(database, id)).toEqual({ bookId: book.id, head: id, paidBy: 'member-me', paidLabel: 'BCA Tahapan' });
    const hlc = (await outboxChangeSets(database))[0]!.hlc;
    for (const field of ['occurredOn', 'description', 'channel', 'excluded', 'bill', 'money']) {
      expect(await fieldClock(database, 'purchase', id, field)).toBe(hlc);
    }
  });

  it('a transfer between own accounts belongs to no book and emits nothing', async () => {
    const { database, ws, bca } = await sharedHousehold();
    const cash = await createAccount(database, ws, { name: 'Cash', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await postTransaction(database, ws, {
      occurredOn: '2026-09-10',
      description: 'ATM',
      lines: transferLines({ fromAccountId: bca.id, toAccountId: cash.id, amountMinor: 100_000, currency: 'IDR' }),
    });
    expect(await outboxOps(database)).toEqual([]);
  });

  it('a correction emits only what changed; the lineage id survives two corrections', async () => {
    const { database, ws, bca, groceries, dining } = await sharedHousehold();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' });
    const first = await postTransaction(database, ws, { occurredOn: '2026-09-10', description: 'Superindo', lines });
    await clearOutbox(database);

    const second = await replaceTransaction(database, ws, first, { occurredOn: '2026-09-10', description: 'Superindo Kemang', lines });
    expect(await outboxOps(database)).toEqual([{ entity: 'purchase', id: first, op: 'upsert', fields: { description: 'Superindo Kemang' } }]);
    expect((await lineageRow(database, first))!.head).toBe(second);

    await clearOutbox(database);
    const third = await replaceTransaction(database, ws, second, {
      occurredOn: '2026-09-11',
      description: 'Superindo Kemang',
      lines: expenseLines({ categoryAccountId: dining.id, paymentAccountId: bca.id, amountMinor: 55_000, currency: 'IDR' }),
    });
    const ops = await outboxOps(database);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'purchase', id: first, op: 'upsert' });
    const fields = (ops[0] as { fields: Record<string, unknown> }).fields;
    expect(Object.keys(fields).sort()).toEqual(['money', 'occurredOn']);
    expect(fields.money).toMatchObject({ lines: [{ categoryId: dining.id, amountMinor: 55_000 }], paidBy: 'member-me' });
    expect(await lineageRow(database, first)).toMatchObject({ head: third });
  });

  it('a correction that changes nothing emits nothing, but the lineage follows the new head', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    const input = { occurredOn: '2026-09-10', description: 'Superindo', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' }) };
    const first = await postTransaction(database, ws, input);
    await clearOutbox(database);
    const second = await replaceTransaction(database, ws, first, input);
    expect(await outboxOps(database)).toEqual([]);
    expect((await lineageRow(database, first))!.head).toBe(second);
  });

  it('a void emits { void: true } and closes the lineage', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' }),
    });
    await clearOutbox(database);
    await voidTransaction(database, ws, id);
    expect(await outboxOps(database)).toEqual([{ entity: 'purchase', id, op: 'upsert', fields: { void: true } }]);
    expect((await lineageRow(database, id))!.head).toBeNull();
  });

  it('a correction re-filed with no category leaves the book: a void', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    const cash = await createAccount(database, ws, { name: 'Cash', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' }),
    });
    await clearOutbox(database);
    await replaceTransaction(database, ws, id, {
      occurredOn: '2026-09-10',
      description: 'Actually a withdrawal',
      lines: transferLines({ fromAccountId: bca.id, toAccountId: cash.id, amountMinor: 50_000, currency: 'IDR' }),
    });
    expect(await outboxOps(database)).toEqual([{ entity: 'purchase', id, op: 'upsert', fields: { void: true } }]);
  });

  it('a void then a post that replaces it, in one transaction (trades.ts), is one correction, not a void', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' });
    const id = await postTransaction(database, ws, { occurredOn: '2026-09-10', description: 'Superindo', lines });
    await clearOutbox(database);
    const next = await database.transaction(async (tx) => {
      await voidTransactionTx(tx, ws, id);
      return postTransactionTx(tx, ws, { occurredOn: '2026-09-10', description: 'Superindo', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 60_000, currency: 'IDR' }), replacesTransactionId: id });
    });
    const ops = await outboxOps(database);
    expect(ops).toHaveLength(1);
    expect(Object.keys((ops[0] as { fields: object }).fields)).toEqual(['money']);
    expect((await lineageRow(database, id))!.head).toBe(next);
  });

  it('a purchase is ordered after the category it is filed in, when both are written in one transaction', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    await database.transaction(async (tx) => {
      const { createAccountTx } = await import('../../src/index');
      const snacks = await createAccountTx(tx, ws, { name: 'Snacks', kind: 'expense', subtype: 'category', currency: null, parentId: groceries.parentId });
      await postTransactionTx(tx, ws, {
        occurredOn: '2026-09-10',
        description: 'Chitato',
        lines: expenseLines({ categoryAccountId: snacks.id, paymentAccountId: bca.id, amountMinor: 10_000, currency: 'IDR' }),
      });
    });
    expect((await outboxOps(database)).map((op) => op.entity)).toEqual(['category', 'purchase']);
  });
});

describe('capture: switched off', () => {
  it('pauseCapture in a transaction emits nothing for that transaction', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    await database.transaction(async (tx) => {
      pauseCapture(tx);
      await postTransactionTx(tx, ws, {
        occurredOn: '2026-09-10',
        description: 'Superindo',
        lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' }),
      });
    });
    expect(await outboxOps(database)).toEqual([]);
    // The next transaction captures again.
    await renameAccount(database, ws, groceries.id, 'Market');
    expect(await outboxOps(database)).toHaveLength(1);
  });

  it('configureCapture({ enabled: false }) switches a database off', async () => {
    const { database, ws, groceries } = await sharedHousehold();
    configureCapture(database, { enabled: false });
    await renameAccount(database, ws, groceries.id, 'Market');
    expect(await outboxOps(database)).toEqual([]);
  });
});

describe('capture: size', () => {
  it('a write too big for one change-set is cut into several, with consecutive hlcs', async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    await database.transaction(async (tx) => {
      for (let i = 0; i < 205; i += 1) {
        await postTransactionTx(tx, ws, {
          occurredOn: '2026-09-10',
          description: `Row ${i}`,
          lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 1_000 + i, currency: 'IDR' }),
        });
      }
    });
    const sets = await outboxChangeSets(database);
    expect(sets.length).toBeGreaterThanOrEqual(2);
    expect(sets.flatMap((s) => s.ops)).toHaveLength(205);
    expect(new Set(sets.map((s) => s.hlc)).size).toBe(sets.length);
  });
});

describe('the audit author (§7.3)', () => {
  it("a replace writes the author into both its 'void' and its 'post' audit rows; a void with an author says so", async () => {
    const { database, ws, bca, groceries } = await sharedHousehold();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bca.id, amountMinor: 50_000, currency: 'IDR' });
    const first = await postTransaction(database, ws, { occurredOn: '2026-09-10', description: 'Superindo', lines });
    const { replaceTransactionTx } = await import('../../src/index');
    const second = await database.transaction((tx) => replaceTransactionTx(tx, ws, first, { occurredOn: '2026-09-10', description: 'Superindo 2', lines, syncAuthor: 'member-dewi' }));
    await database.transaction((tx) => voidTransactionTx(tx, ws, second, {}, 'member-dewi'));
    const rows = await database.db.values<[string, string, string]>(sql`SELECT action, entity_id, payload_json FROM audit_log WHERE entity = 'transaction' ORDER BY rowid`);
    const payload = (action: string, id: string) => JSON.parse(rows.find((r) => r[0] === action && r[1] === id)![2]) as { syncAuthor?: string };
    expect(payload('void', first).syncAuthor).toBe('member-dewi');
    expect(payload('post', second).syncAuthor).toBe('member-dewi');
    expect(payload('void', second).syncAuthor).toBe('member-dewi');
  });
});
