import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  createDatabase,
  createWorkspace,
  coretaxInputsFor,
  isBookShared,
  listAccounts,
  migrate,
  MIGRATIONS,
  sharingSchema,
  assetValuesAt,
} from '../../src/index';
import { createNodeExecutor, type NodeExecutor } from '../../src/node';
import { setupDb } from '../helpers';

/*
 * Household sharing spec §4.4: a placeholder account (one `book_member_accounts` row per other member, per book and
 * per currency) must never show up as the user's own money. One test per reader §4.4 names, each proving a
 * placeholder is excluded and an ordinary asset account of the same shape is not.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function fresh() {
  const db = await setupDb();
  executor = db.executor;
  return db;
}

/** Opens an ordinary asset account and marks it a placeholder by inserting its `book_member_accounts` row directly. */
async function makePlaceholder(database: Awaited<ReturnType<typeof fresh>>['database'], ws: Awaited<ReturnType<typeof fresh>>['ws'], bookId: string) {
  const account = await createAccount(database, ws, { name: 'Alex', kind: 'asset', subtype: 'cash', currency: ws.baseCurrency });
  await database.db.insert(sharingSchema.bookMemberAccounts).values({ accountId: account.id, bookId, memberId: 'member-alex', currency: ws.baseCurrency });
  return account;
}

describe('notPlaceholder: listAccounts', () => {
  it('excludes a placeholder account and keeps an ordinary one', async () => {
    const { database, ws } = await fresh();
    const placeholder = await makePlaceholder(database, ws, 'book-1');
    const ordinary = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: ws.baseCurrency });

    const rows = await listAccounts(database, ws, { includeArchived: true });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(placeholder.id);
    expect(ids).toContain(ordinary.id);
  });

  it('includes a placeholder when includePlaceholders is set, for the receipt and sync code', async () => {
    const { database, ws } = await fresh();
    const placeholder = await makePlaceholder(database, ws, 'book-1');

    const rows = await listAccounts(database, ws, { includeArchived: true, includePlaceholders: true });
    expect(rows.map((r) => r.id)).toContain(placeholder.id);
  });
});

describe('notPlaceholder: assetValuesAt', () => {
  it('excludes a placeholder account and keeps an ordinary one', async () => {
    const { database, ws } = await fresh();
    const placeholder = await makePlaceholder(database, ws, 'book-1');
    const ordinary = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: ws.baseCurrency });

    const values = await assetValuesAt(database, ws, '2026-09-27');
    const ids = values.map((v) => v.accountId);
    expect(ids).not.toContain(placeholder.id);
    expect(ids).toContain(ordinary.id);
  });
});

describe("notPlaceholder: coretaxInputsFor's own account read", () => {
  it('excludes a placeholder account from the cash rows and keeps an ordinary one', async () => {
    const { database, ws } = await fresh();
    const placeholder = await makePlaceholder(database, ws, 'book-1');
    const ordinary = await createAccount(database, ws, {
      name: 'BCA',
      kind: 'asset',
      subtype: 'bank',
      currency: ws.baseCurrency,
      openingBalanceMinor: 1_000_000,
      openedOn: '2026-01-01',
    });

    const inputs = await coretaxInputsFor(database, ws, 2026);
    const cashIds = inputs.cash.map((c) => c.accountId);
    expect(cashIds).not.toContain(placeholder.id);
    expect(cashIds).toContain(ordinary.id);
  });
});

describe('a database one version behind (migration 0056 not yet run)', () => {
  it('lets listAccounts, assetValuesAt and coretaxInputsFor read normally with no book_member_accounts table', async () => {
    const executor = createNodeExecutor();
    try {
      const database = createDatabase(executor);
      await migrate(database, MIGRATIONS.filter((m) => m.version < 56));
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      const ordinary = await createAccount(database, ws, {
        name: 'BCA',
        kind: 'asset',
        subtype: 'bank',
        currency: ws.baseCurrency,
        openingBalanceMinor: 1_000_000,
        openedOn: '2026-01-01',
      });

      expect((await listAccounts(database, ws)).map((r) => r.id)).toContain(ordinary.id);
      expect((await assetValuesAt(database, ws, '2026-09-27')).map((v) => v.accountId)).toContain(ordinary.id);
      expect((await coretaxInputsFor(database, ws, 2026)).cash.map((c) => c.accountId)).toContain(ordinary.id);
      expect(await isBookShared(database, 'any-book')).toBe(false);
    } finally {
      executor.close();
    }
  });
});

describe('isBookShared', () => {
  it('is true for a shared_books row in state active or needs_invite, and false otherwise', async () => {
    const { database } = await fresh();
    await database.db.insert(sharingSchema.sharedBooks).values({
      bookId: 'book-active',
      relayBookId: 'relay-1',
      epoch: 1,
      memberId: 'member-me',
      state: 'active',
      sharedAt: '2026-09-27T00:00:00.000Z',
    });
    await database.db.insert(sharingSchema.sharedBooks).values({
      bookId: 'book-needs-invite',
      relayBookId: 'relay-2',
      epoch: 1,
      memberId: 'member-me',
      state: 'needs_invite',
      sharedAt: '2026-09-27T00:00:00.000Z',
    });
    await database.db.insert(sharingSchema.sharedBooks).values({
      bookId: 'book-unshared',
      relayBookId: 'relay-3',
      epoch: 1,
      memberId: 'member-me',
      state: 'unshared',
      sharedAt: '2026-09-27T00:00:00.000Z',
    });

    expect(await isBookShared(database, 'book-active')).toBe(true);
    expect(await isBookShared(database, 'book-needs-invite')).toBe(true);
    expect(await isBookShared(database, 'book-unshared')).toBe(false);
    expect(await isBookShared(database, 'no-such-book')).toBe(false);
  });
});
