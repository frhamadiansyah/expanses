import { expenseLines, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addPhoto,
  allPhotoFileNames,
  allPhotoRows,
  cardSpendLines,
  createAccount,
  createDatabase,
  createWorkspace,
  deletePhoto,
  listAccounts,
  listPhotos,
  listTransactions,
  migrate,
  MIGRATIONS,
  postTransaction,
  replaceTransaction,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('migration 0048', () => {
  it('is version 48 and named transaction_extras', () => {
    expect(MIGRATIONS.find((m) => m.version === 48)).toMatchObject({ name: 'transaction_extras' });
  });

  it('adds the tables to a database stopped at 47, changing no figure', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 47));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
    });

    // Before the migration: the reads behave exactly as they did, and say nothing was chosen.
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, channel: null, excluded: false, photoCount: 0 });

    // `migrate` is set-based and sorted (migrations.ts:179), so it applies everything this build has that the
    // database has not: 0048, the 0049 that is already on main, and 0054.
    expect(await migrate(database)).toEqual([48, 49, 54]);
    const rows = await database.db.values<[number]>(sql`SELECT count(*) FROM transaction_flags`);
    expect(Number(rows[0]![0])).toBe(0);
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, channel: null, excluded: false, photoCount: 0 });
  });

  /*
   * The path every existing install actually takes. 0049 shipped before this branch, so on a real database 0048 is
   * applied *after* it, not before. It is benign — 0048 is two CREATE TABLEs that touch nothing 0049 made — but
   * "benign" is a claim, and a claim the other test cannot make: there the two arrive together, lowest first.
   */
  it('applies on top of a database that already has 0049', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 47 || m.version === 49));
    expect(await migrate(database)).toEqual([48, 54]);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Superindo',
      channel: 'offline',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
    });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, channel: 'offline', excluded: false });
  });

  /*
   * A database stopped at 47 must not merely read as "nothing chosen": a form that asks for a channel there must
   * still post, and still correct. Without the guards the insert would fail on a missing table and the whole
   * posting would roll back.
   */
  it('still posts and corrects on a database that never got 0048', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 47));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Superindo',
      channel: 'online',
      excludedFromReport: true,
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
    });
    const replacement = await replaceTransaction(database, ws, id, {
      occurredOn: '2026-09-17',
      description: 'Superindo, corrected',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 260_000, currency: 'IDR' }),
    });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id: replacement, channel: null, excluded: false, photoCount: 0 });
  });

  /*
   * The ledger side of the guard is covered above and in transaction-extras.test.ts's mutation table (12, O, P all
   * fail without it). Nothing covered the photo repository's own guards: on a database stopped at 47,
   * transaction_photos does not exist, so a guard removed from any function below throws `no such table:
   * transaction_photos` instead of behaving as it does today. Each assertion here is that it does not throw.
   */
  /*
   * cardSpendLines grew a LEFT JOIN onto transaction_flags for Task 4 (the points engine reading channel).
   * On a database stopped at 47 that table does not exist, so the join is skipped and every line must still
   * come back with channel: null rather than throwing on a missing table.
   */
  it('cardSpendLines does not throw on a database that never got 0048, and reads channel as null', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 47));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const electronics = (await listAccounts(database, ws)).find((a) => a.systemKey === 'shopping.electronics')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'iPhone for Mama',
      lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: card.id, amountMinor: 18_999_000, currency: 'IDR' }),
    });
    const lines = await cardSpendLines(database, ws, card.id, '2026-09-01', '2026-09-30');
    expect(lines.find((l) => l.transactionId === id)).toMatchObject({ channel: null });
  });

  describe('the photo repository on a database that never got 0048', () => {
    async function stoppedAt47() {
      executor = createNodeExecutor();
      const database = createDatabase(executor);
      await migrate(database, MIGRATIONS.filter((m) => m.version <= 47));
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
      const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
      const id = await postTransaction(database, ws, {
        occurredOn: '2026-09-17',
        description: 'Superindo',
        lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
      });
      return { database, ws, id };
    }

    /*
     * It throws, and that is the point. There is no table to write to here, so there is no row and no id; an id
     * answered anyway is one a draft would carry into `photoIds`, where `writeExtrasTx` would match nothing and
     * the user would be shown a form that accepted a photograph the transaction does not have. `savePhotoBytes`
     * throws on a missing OPFS for the same reason. A caller must hear "no", not a plausible identifier.
     */
    it('addPhoto refuses, rather than answering an id for a row it did not write', async () => {
      const { database, ws, id } = await stoppedAt47();
      const attempt = addPhoto(database, ws, { transactionId: id, fileName: 'a.jpg', mime: 'image/jpeg', byteSize: 1 });
      await expect(attempt).rejects.toThrow(/transaction_photos/);
      // And nothing was left behind for a later reader to find.
      await expect(listPhotos(database, ws, id)).resolves.toEqual([]);
    });

    it('listPhotos does not throw', async () => {
      const { database, ws, id } = await stoppedAt47();
      await expect(listPhotos(database, ws, id)).resolves.toEqual([]);
    });

    it('deletePhoto does not throw', async () => {
      const { database, ws } = await stoppedAt47();
      await expect(deletePhoto(database, ws, uuidv7())).resolves.toBeUndefined();
    });

    it('allPhotoRows does not throw', async () => {
      const { database, ws } = await stoppedAt47();
      await expect(allPhotoRows(database, ws)).resolves.toEqual([]);
    });

    /*
     * Not `[]`. An empty list would say "this database holds no photos", and the orphan sweep — the only caller
     * — would then read every file on the device as unreferenced and delete it, including a picture taken a
     * minute ago on this very device. Null says "there is no table to ask", which is the fact, and the sweep
     * refuses to delete anything on it.
     */
    it('allPhotoFileNames says it cannot tell, rather than saying there are none', async () => {
      const { database } = await stoppedAt47();
      await expect(allPhotoFileNames(database)).resolves.toBeNull();
    });
  });
});

