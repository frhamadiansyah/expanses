import { expenseLines, splitExpenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOINED_MESSAGE,
  createAccount,
  createBook,
  deleteBook,
  inBook,
  listEarmarks,
  listGoals,
  nativeBalances,
  personalBook,
  planBookDelete,
  postTransaction,
  replaceTransaction,
  saveEarmark,
  saveExpenseTemplate,
  saveGoal,
  shareGoal,
  type Database,
} from '../../src/index';
import { setupDb } from '../helpers';
import { categoryOf, Household, type Device } from './household';

/*
 * Deleting a workspace that is or was shared erases what only it holds (spec 2026-11-11 sharing resilience §5), instead
 * of voiding it, so no id of it is left on the phone to stand in the way of a later share. Invented names and figures:
 * Dewi shares her Personal workspace, Fandri joins; each records a few purchases.
 */

const ON = '2026-10-14';

/** Every row of `table` that names the book. */
async function count(d: Device, table: string, bookId: string): Promise<number> {
  const [[n]] = (await d.database.db.values<[number]>(sql`SELECT count(*) FROM ${sql.raw(table)} WHERE book_id = ${bookId}`)) as [[number]];
  return Number(n);
}

async function balanceOf(d: Device, accountId: string): Promise<number> {
  return (await nativeBalances(d.database, d.ws))[accountId] ?? 0;
}

async function accountExists(d: Device, accountId: string): Promise<boolean> {
  return (await d.database.db.values(sql`SELECT 1 FROM accounts WHERE id = ${accountId}`)).length > 0;
}

async function spend(d: Device, bookId: string, description: string, amountMinor: number, from: string = d.bank): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: ON,
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: from, amountMinor, currency: 'IDR' }),
  });
}

/** Every transaction the book holds on this phone: filed in it, or one of its purchases' rows. */
async function idsOf(d: Device, bookId: string): Promise<string[]> {
  const rows = await d.database.db.values<[string]>(sql`
    SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId}
    UNION SELECT head_transaction_id FROM sync_lineage WHERE book_id = ${bookId} AND head_transaction_id IS NOT NULL`);
  return rows.map(([id]) => id);
}

/**
 * Fandri's phone before the share: Personal holds a 20_000 purchase from his bank on its own 'Groceries', and he has a
 * joint account. Then Dewi shares her Personal workspace with a bill on it, Fandri joins, and both record: Fandri
 * 30_000 and 12_500 from his bank and 7_000 from the joint account, Dewi 50_000.
 */
async function world() {
  const home = new Household();
  const dewi = await home.device('Dewi', 'member-Dewi', 'IDR', '0.5.0');
  const fandri = await home.device('Fandri', 'member-Fandri', 'IDR', '0.5.0');
  const personal = await personalBook(fandri.database, fandri.ws);
  const personalGroceries = await categoryOf(fandri.database, personal.id, 'Groceries');
  const corner = await postTransaction(fandri.database, fandri.ws, {
    occurredOn: ON,
    description: 'Corner stall',
    lines: expenseLines({ categoryAccountId: personalGroceries, paymentAccountId: fandri.bank, amountMinor: 20_000, currency: 'IDR' }),
  });
  const jointAccount = (await createAccount(fandri.database, fandri.ws, { name: 'Household Pot', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  await fandri.database.db.run(sql`INSERT INTO nw_joint_accounts (account_id) VALUES (${jointAccount})`);

  const bookId = await home.share(dewi);
  await saveExpenseTemplate(dewi.database, dewi.ws, {
    name: 'Water bill',
    categoryAccountId: await categoryOf(dewi.database, bookId, 'Groceries'),
    moneyAccountId: dewi.bank,
    amountMinor: 85_000,
    dayOfMonth: 9,
  });
  await home.join(fandri, dewi);
  const own = [await spend(fandri, bookId, 'Night market', 30_000), await spend(fandri, bookId, 'Bakery', 12_500)];
  const fromJoint = await spend(fandri, bookId, 'Fruit stand', 7_000, jointAccount);
  await spend(dewi, bookId, 'Weekly shop', 50_000);
  await home.settle();
  return { home, dewi, fandri, bookId, personal, personalGroceries, corner, jointAccount, own, fromJoint };
}
type World = Awaited<ReturnType<typeof world>>;

/** The world after Fandri leaves the share: his copy stays, read-only (`unshared`, left). */
async function left(): Promise<World> {
  const w = await world();
  await w.fandri.engine.leave(w.bookId);
  return w;
}

/** What Personal lists as moved there from the copy: description and amount spent, by Personal's category. */
async function personalRows(w: World): Promise<[string, number, string][]> {
  return w.fandri.database.db.values<[string, number, string]>(sql`
    SELECT t.description, e.amount_minor, e.account_id FROM transactions t
    JOIN book_transactions b ON b.transaction_id = t.id
    JOIN entries e ON e.transaction_id = t.id JOIN accounts a ON a.id = e.account_id AND a.kind = 'expense'
    WHERE b.book_id = ${w.personal.id} AND t.status = 'posted' ORDER BY t.description`);
}

const SYNC_TABLES = [
  'shared_books',
  'book_members',
  'book_devices',
  'book_epoch_keys',
  'sync_lineage',
  'sync_outbox',
  'sync_cursor',
  'sync_field_clocks',
  'sync_kept_clocks',
  'sync_tombstones',
  'sync_skipped',
  'sync_authority',
  'sync_authority_devices',
  'sync_invites_used',
  'book_member_accounts',
  'book_transactions',
  'book_transaction_splits',
  'book_categories',
  'book_category_sets',
  'book_budget_settings',
  'book_income_overrides',
  'shared_transfers',
  'goal_shares',
];

describe('deleting a once-shared workspace erases it (spec §5)', () => {
  it('erases every row of a joined copy after leaving', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    const idsBefore = await idsOf(fandri, bookId);
    expect(idsBefore.length).toBe(4);
    const placeholders = (await fandri.database.db.values<[string]>(sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId}`)).map(([id]) => id);
    expect(placeholders.length).toBeGreaterThan(0);
    const categories = (await fandri.database.db.values<[string]>(sql`SELECT category_account_id FROM book_categories WHERE book_id = ${bookId}`)).map(([id]) => id);

    const plan = await planBookDelete(fandri.database, fandri.ws, bookId);
    expect(plan).toMatchObject({ refusal: null, refusalCode: null, erases: true, ownPurchases: 2 });
    await deleteBook(fandri.database, fandri.ws, bookId);

    for (const table of SYNC_TABLES) expect([table, await count(fandri, table, bookId)]).toEqual([table, 0]);
    expect(await fandri.database.db.values(sql`SELECT id FROM books WHERE id = ${bookId}`)).toEqual([]);
    // Erased, not void: not a row of them is left, nor of their lines.
    expect(await fandri.database.db.values(sql`SELECT id FROM transactions WHERE id IN ${idsBefore}`)).toEqual([]);
    expect(await fandri.database.db.values(sql`SELECT id FROM entries WHERE transaction_id IN ${idsBefore}`)).toEqual([]);
    expect(await fandri.database.db.values(sql`SELECT id FROM accounts WHERE id IN ${[...placeholders, ...categories]}`)).toEqual([]);
    // The bill Dewi pays (from her placeholder here) goes with its category.
    expect(await fandri.database.db.values(sql`SELECT id FROM expense_templates`)).toEqual([]);
    expect(
      await fandri.database.db.values(sql`SELECT value FROM settings WHERE key IN (${`sharing.member.${bookId}`}, ${`sharing.seen.${bookId}`}, ${`active_book:${fandri.ws.workspaceId}`})`),
    ).toEqual([]);
    // The moved purchases are ordinary local ones: no lineage, nothing they replace.
    const moved = await fandri.database.db.values<[string, string | null]>(sql`
      SELECT t.id, t.replaces_transaction_id FROM transactions t JOIN book_transactions b ON b.transaction_id = t.id
      WHERE b.book_id = ${w.personal.id} AND t.status = 'posted' AND t.description IN ('Night market', 'Bakery')`);
    expect(moved.map(([, replaces]) => replaces)).toEqual([null, null]);
    expect(await fandri.database.db.values(sql`SELECT 1 FROM sync_lineage WHERE head_transaction_id IN ${moved.map(([id]) => id)}`)).toEqual([]);
  });

  it('never touches what other workspaces use', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    await deleteBook(fandri.database, fandri.ws, bookId, { keepOwnInPersonal: false });
    expect(await balanceOf(fandri, fandri.bank)).toBe(-20_000); // only Personal's purchase left on it
    expect(await balanceOf(fandri, w.jointAccount)).toBe(0);
    expect(await categoryOf(fandri.database, w.personal.id, 'Groceries')).toBe(w.personalGroceries);
    expect(await fandri.database.db.values(sql`SELECT status FROM transactions WHERE id = ${w.corner}`)).toEqual([['posted']]);
    expect(await fandri.database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${w.corner}`)).toEqual([[w.personal.id]]);
    expect(await accountExists(fandri, w.jointAccount)).toBe(true);
    expect(await fandri.database.db.values(sql`SELECT account_id FROM nw_joint_accounts`)).toEqual([[w.jointAccount]]);
    expect(await accountExists(fandri, fandri.bank)).toBe(true);
    expect(await accountExists(fandri, fandri.cash)).toBe(true);
  });

  it('refuses a purchase split between the joined copy and Personal, with nothing changed', async () => {
    const w = await world();
    const { fandri, bookId } = w;
    await postTransaction(fandri.database, inBook(fandri.ws, bookId), {
      occurredOn: ON,
      description: 'Two-way shop',
      lines: splitExpenseLines({
        paymentAccountId: fandri.bank,
        currency: 'IDR',
        splits: [
          { categoryAccountId: await categoryOf(fandri.database, bookId, 'Groceries'), amountMinor: 16_000 },
          { categoryAccountId: w.personalGroceries, amountMinor: 4_000 },
        ],
      }),
      acrossBooks: true,
    });
    await w.home.settle();
    await fandri.engine.leave(bookId);
    const before = await count(fandri, 'book_transactions', bookId);
    const balance = await balanceOf(fandri, fandri.bank);
    expect((await planBookDelete(fandri.database, fandri.ws, bookId)).refusalCode).toBe('SPLIT');
    await expect(deleteBook(fandri.database, fandri.ws, bookId)).rejects.toMatchObject({ code: 'SPLIT' });
    expect(await count(fandri, 'book_transactions', bookId)).toBe(before);
    expect(await count(fandri, 'shared_books', bookId)).toBe(1);
    expect(await balanceOf(fandri, fandri.bank)).toBe(balance);
  });

  it('refuses an active joined copy with the Leave and delete message', async () => {
    const w = await world();
    const before = await idsOf(w.fandri, w.bookId);
    const plan = await planBookDelete(w.fandri.database, w.fandri.ws, w.bookId);
    expect(plan).toMatchObject({ refusal: ACTIVE_JOINED_MESSAGE, refusalCode: 'SHARED', erases: true });
    await expect(deleteBook(w.fandri.database, w.fandri.ws, w.bookId)).rejects.toMatchObject({ code: 'SHARED', message: ACTIVE_JOINED_MESSAGE });
    expect(await idsOf(w.fandri, w.bookId)).toEqual(before);
    expect(await count(w.fandri, 'shared_books', w.bookId)).toBe(1);
  });

  it('allows an active joined copy that is frozen (no owner device left in the view), erasing it', async () => {
    const w = await world();
    const { fandri, bookId } = w;
    // As the log would have it after Dewi's only device went: still in the share, no owner device among those in.
    await fandri.database.db.run(sql`UPDATE sync_authority SET role = 'member' WHERE book_id = ${bookId}`);
    expect(await fandri.engine.isFrozen(bookId)).toBe(true);
    expect(await planBookDelete(fandri.database, fandri.ws, bookId)).toMatchObject({ refusal: null, erases: true, ownPurchases: 2 });
    const bank = await balanceOf(fandri, fandri.bank);
    await deleteBook(fandri.database, fandri.ws, bookId);
    for (const table of SYNC_TABLES) expect([table, await count(fandri, table, bookId)]).toEqual([table, 0]);
    expect(await balanceOf(fandri, fandri.bank)).toBe(bank);
  });

  it('allows a joined copy waiting for an invite (needs_invite), erasing it', async () => {
    const w = await world();
    await w.fandri.database.db.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${w.bookId}`);
    expect(await planBookDelete(w.fandri.database, w.fandri.ws, w.bookId)).toMatchObject({ refusal: null, erases: true });
    await deleteBook(w.fandri.database, w.fandri.ws, w.bookId);
    for (const table of SYNC_TABLES) expect([table, await count(w.fandri, table, w.bookId)]).toEqual([table, 0]);
  });

  it('an owner’s workspace that was shared before erases too; a never-shared one still voids', async () => {
    const w = await world();
    const { dewi } = w;
    const dewiPersonal = w.bookId;
    const homeBook = await createBook(dewi.database, dewi.ws, { name: 'Home', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: dewiPersonal });
    const tiles = await spend(dewi, homeBook, 'Floor tiles', 15_000);
    await dewi.engine.shareBook(homeBook, { memberId: dewi.memberId, memberName: 'Dewi', deviceName: 'Dewi phone' });
    await dewi.engine.syncOnce(homeBook);
    await dewi.engine.stopSharing(homeBook);
    expect(await count(dewi, 'shared_books', homeBook)).toBe(0);
    const bankBefore = await balanceOf(dewi, dewi.bank);

    const plan = await planBookDelete(dewi.database, dewi.ws, homeBook);
    expect(plan).toMatchObject({ refusal: null, erases: true, ownPurchases: 0 });
    await deleteBook(dewi.database, dewi.ws, homeBook);
    expect(await dewi.database.db.values(sql`SELECT id FROM transactions WHERE id = ${tiles}`)).toEqual([]);
    expect(await balanceOf(dewi, dewi.bank)).toBe(bankBefore + 15_000);
    expect(await dewi.database.db.values(sql`SELECT key FROM settings WHERE key = ${`sharing.member.${homeBook}`}`)).toEqual([]);
    for (const table of SYNC_TABLES) expect([table, await count(dewi, table, homeBook)]).toEqual([table, 0]);
    // Her shared Personal is untouched.
    expect(await count(dewi, 'shared_books', dewiPersonal)).toBe(1);

    const trips = await createBook(dewi.database, dewi.ws, { name: 'Trips', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: dewiPersonal });
    const ferry = await spend(dewi, trips, 'Ferry', 9_000);
    expect((await planBookDelete(dewi.database, dewi.ws, trips)).erases).toBe(false);
    await deleteBook(dewi.database, dewi.ws, trips);
    expect(await dewi.database.db.values(sql`SELECT status FROM transactions WHERE id = ${ferry}`)).toEqual([['void']]);
  });

  it('a category another book also tags loses only the tag', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    // A shared event's book earns by this category (event_category_accounts names it); nothing else does.
    await fandri.database.db.run(sql`
      INSERT INTO event_category_accounts (book_id, category_id, account_id, earn_category_id) VALUES ('event-book-1', 'food', 'event-account-1', ${groceries})`);
    await deleteBook(fandri.database, fandri.ws, bookId, { keepOwnInPersonal: false });
    expect(await count(fandri, 'book_categories', bookId)).toBe(0);
    const [[archived]] = (await fandri.database.db.values<[string | null]>(sql`SELECT archived_at FROM accounts WHERE id = ${groceries}`)) as [[string | null]];
    expect(archived).not.toBeNull();
    expect(await fandri.database.db.values(sql`SELECT earn_category_id FROM event_category_accounts WHERE book_id = 'event-book-1'`)).toEqual([[groceries]]);
    // Its siblings that nothing names are gone.
    expect(await fandri.database.db.values(sql`SELECT 1 FROM accounts WHERE kind = 'expense' AND archived_at IS NULL AND id NOT IN (SELECT category_account_id FROM book_categories)`)).toEqual([]);
  });

  it('goals that came through the share go; this member’s own goal stays as a private copy', async () => {
    const w = await world();
    const { dewi, fandri, bookId, home } = w;
    const stage = (name: string) => [{ name, targetMinor: 90_000_000, targetMonths: null, dueOn: '2031-03-01' }];
    const theirs = await saveGoal(dewi.database, dewi.ws, { name: 'Roof repair', kind: 'other', growthBps: 0, returnBps: 0, stages: stage('Roof') });
    const helped = await saveGoal(dewi.database, dewi.ws, { name: 'School fees', kind: 'other', growthBps: 0, returnBps: 0, stages: stage('Term one') });
    await shareGoal(dewi.database, dewi.ws, theirs, bookId);
    await shareGoal(dewi.database, dewi.ws, helped, bookId);
    const mine = await saveGoal(fandri.database, fandri.ws, { name: 'Bicycle', kind: 'other', growthBps: 0, returnBps: 0, stages: stage('Bike') });
    await shareGoal(fandri.database, fandri.ws, mine, bookId);
    await home.settle();
    const savings = (
      await createAccount(fandri.database, fandri.ws, { name: 'Fandri Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' })
    ).id;
    await saveEarmark(fandri.database, fandri.ws, { goalId: helped, accountId: savings, amountMinor: 1_000_000 });
    expect((await listGoals(fandri.database, fandri.ws)).map((g) => g.name).sort()).toEqual(['Bicycle', 'Roof repair', 'School fees']);

    // A restored phone waiting for an invite: the share has not ended here, so the goals are still linked.
    await fandri.database.db.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
    await deleteBook(fandri.database, fandri.ws, bookId);

    const goals = await listGoals(fandri.database, fandri.ws);
    expect(goals.map((g) => g.name).sort()).toEqual(['Bicycle', 'School fees']);
    expect(goals.find((g) => g.name === 'Bicycle')!.id).toBe(mine);
    const copy = goals.find((g) => g.name === 'School fees')!;
    expect(copy.id).not.toBe(helped);
    expect(await listEarmarks(fandri.database, fandri.ws)).toEqual([{ goalId: copy.id, accountId: savings, amountMinor: 1_000_000 }]);
    expect(await fandri.database.db.values(sql`SELECT goal_id FROM goal_shares`)).toEqual([]);
    expect(await fandri.database.db.values(sql`SELECT 1 FROM goals WHERE id = ${theirs}`)).toEqual([]);
    expect(await fandri.database.db.values(sql`SELECT 1 FROM goal_stages WHERE goal_id = ${theirs}`)).toEqual([]);
  });

  it('after a leave the private copies the share left stay', async () => {
    const w = await world();
    const { dewi, fandri, bookId, home } = w;
    const roof = await saveGoal(dewi.database, dewi.ws, { name: 'Roof repair', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'Roof', targetMinor: 90_000_000, targetMonths: null, dueOn: '2031-03-01' }] });
    await shareGoal(dewi.database, dewi.ws, roof, bookId);
    await home.settle();
    await fandri.engine.leave(bookId);
    const kept = (await listGoals(fandri.database, fandri.ws)).map((g) => g.id);
    expect(kept.length).toBe(1);
    await deleteBook(fandri.database, fandri.ws, bookId);
    expect((await listGoals(fandri.database, fandri.ws)).map((g) => g.id)).toEqual(kept);
  });
});

describe('purchases paid from this member’s own accounts (owner decision)', () => {
  it('are kept in Personal by default: own balances unchanged to the unit, listed in Personal', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    const bank = await balanceOf(fandri, fandri.bank);
    expect(bank).toBe(-20_000 - 30_000 - 12_500);
    await deleteBook(fandri.database, fandri.ws, bookId);
    expect(await balanceOf(fandri, fandri.bank)).toBe(bank);
    expect(await personalRows(w)).toEqual([
      ['Bakery', 12_500, w.personalGroceries],
      ['Corner stall', 20_000, w.personalGroceries],
      ['Night market', 30_000, w.personalGroceries],
    ]);
    // The joint account's purchase was never own: it goes with the copy.
    expect(await balanceOf(fandri, w.jointAccount)).toBe(0);
  });

  it('are erased with everything else when asked: balances drop by exactly those amounts', async () => {
    const w = await left();
    const bank = await balanceOf(w.fandri, w.fandri.bank);
    await deleteBook(w.fandri.database, w.fandri.ws, w.bookId, { keepOwnInPersonal: false });
    expect(await balanceOf(w.fandri, w.fandri.bank)).toBe(bank + 30_000 + 12_500);
    expect(await personalRows(w)).toEqual([['Corner stall', 20_000, w.personalGroceries]]);
  });

  it('never counts a purchase paid from a received or joint account', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    // Dewi's purchase reaches this phone on her placeholder; Fandri's 7_000 was from the joint account.
    expect((await planBookDelete(fandri.database, fandri.ws, bookId)).ownPurchases).toBe(2);
    await deleteBook(fandri.database, fandri.ws, bookId);
    expect((await personalRows(w)).map(([description]) => description)).not.toContain('Fruit stand');
    expect((await personalRows(w)).map(([description]) => description)).not.toContain('Weekly shop');
  });

  it('a category Personal has no copy of is made there for the moved purchase', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    // Personal's Groceries is renamed and loses its key, so nothing in Personal matches the copy's.
    await fandri.database.db.run(sql`UPDATE accounts SET name = 'Market', system_key = NULL WHERE id = ${w.personalGroceries}`);
    await deleteBook(fandri.database, fandri.ws, bookId);
    const rows = await personalRows(w);
    expect(rows.map(([d, a]) => [d, a])).toEqual([
      ['Bakery', 12_500],
      ['Corner stall', 20_000],
      ['Night market', 30_000],
    ]);
    const made = rows.find(([d]) => d === 'Bakery')![2];
    expect(made).not.toBe(w.personalGroceries);
    expect(await fandri.database.db.values(sql`SELECT a.name, b.book_id FROM accounts a JOIN book_categories b ON b.category_account_id = a.id WHERE a.id = ${made}`)).toEqual([['Groceries', w.personal.id]]);
  });
});

describe('fix round 1: nothing outside the copy changes but by the erased rows', () => {
  it('a transfer between partners on the copy’s placeholder is never voided or erased (C1)', async () => {
    const w = await world();
    const { fandri, bookId } = w;
    const [[placeholder]] = (await fandri.database.db.values<[string]>(
      sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${w.dewi.memberId}`,
    )) as [[string]];
    // As a joint net-worth transfer posts it: from his own bank to Dewi's placeholder, filed in no workspace.
    const sent = await postTransaction(fandri.database, fandri.ws, {
      occurredOn: ON,
      description: 'Transfer to Dewi',
      lines: [
        { accountId: fandri.bank, amountMinor: -100_000, currency: 'IDR' },
        { accountId: placeholder, amountMinor: 100_000, currency: 'IDR' },
      ],
    });
    await fandri.database.db.run(sql`INSERT INTO member_transfer_postings (book_id, transfer_id, transaction_id) VALUES ('group-1', 'tr-1', ${sent})`);
    await fandri.engine.leave(bookId);
    const bank = await balanceOf(fandri, fandri.bank);
    expect(await planBookDelete(fandri.database, fandri.ws, bookId)).toMatchObject({ refusal: null, ownPurchases: 2 });
    await deleteBook(fandri.database, fandri.ws, bookId);
    expect(await balanceOf(fandri, fandri.bank)).toBe(bank);
    expect(await fandri.database.db.values(sql`SELECT status FROM transactions WHERE id = ${sent}`)).toEqual([['posted']]);
    // Its placeholder stays, still hidden as one: the group log's transfer names it.
    expect(await fandri.database.db.values(sql`SELECT archived_at FROM accounts WHERE id = ${placeholder}`)).toEqual([[null]]);
    expect(await fandri.database.db.values(sql`SELECT member_id FROM book_member_accounts WHERE account_id = ${placeholder}`)).toEqual([[w.dewi.memberId]]);
  });

  it('a live row that only shares its id with a lineage of the copy survives (I1, a remap holder)', async () => {
    const w = await world();
    const { fandri, bookId } = w;
    const move = await postTransaction(fandri.database, fandri.ws, {
      occurredOn: ON,
      description: 'Own move',
      lines: [
        { accountId: fandri.bank, amountMinor: -40_000, currency: 'IDR' },
        { accountId: fandri.cash, amountMinor: 40_000, currency: 'IDR' },
      ],
    });
    // A remapped purchase keeps the log's id as its lineage id, while its row here is under a local one (D-A2).
    await fandri.database.db.run(
      sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${move}, ${bookId}, NULL, ${w.dewi.memberId}, 'Bank')`,
    );
    await fandri.engine.leave(bookId);
    const [bank, cash] = [await balanceOf(fandri, fandri.bank), await balanceOf(fandri, fandri.cash)];
    expect(cash).toBe(40_000);
    await deleteBook(fandri.database, fandri.ws, bookId);
    expect(await balanceOf(fandri, fandri.cash)).toBe(cash);
    expect(await balanceOf(fandri, fandri.bank)).toBe(bank);
    expect(await fandri.database.db.values(sql`SELECT status FROM transactions WHERE id = ${move}`)).toEqual([['posted']]);
  });

  it('a copy purchase edited into a transfer stays as an ordinary transfer: balances unchanged (I2)', async () => {
    const w = await world();
    const { fandri, bookId, home } = w;
    const lunch = await spend(fandri, bookId, 'Lunch', 9_000);
    const moved = await replaceTransaction(fandri.database, fandri.ws, lunch, {
      occurredOn: ON,
      description: 'To wallet',
      lines: [
        { accountId: fandri.bank, amountMinor: -9_000, currency: 'IDR' },
        { accountId: fandri.cash, amountMinor: 9_000, currency: 'IDR' },
      ],
    });
    await home.settle();
    await fandri.engine.leave(bookId);
    const [bank, cash] = [await balanceOf(fandri, fandri.bank), await balanceOf(fandri, fandri.cash)];
    await deleteBook(fandri.database, fandri.ws, bookId);
    expect([await balanceOf(fandri, fandri.bank), await balanceOf(fandri, fandri.cash)]).toEqual([bank, cash]);
    // The purchase it replaced is erased; the transfer is filed nowhere and replaces nothing now.
    expect(await fandri.database.db.values(sql`SELECT status, replaces_transaction_id FROM transactions WHERE id = ${moved}`)).toEqual([['posted', null]]);
    expect(await fandri.database.db.values(sql`SELECT 1 FROM transactions WHERE id = ${lunch}`)).toEqual([]);
  });

  it('an own row the copy holds only as a lineage head, filed nowhere, is counted and kept in Personal (I2)', async () => {
    const w = await world();
    const { fandri, bookId } = w;
    const transfer = await postTransaction(fandri.database, fandri.ws, {
      occurredOn: ON,
      description: 'Top up wallet',
      lines: [
        { accountId: fandri.bank, amountMinor: -6_000, currency: 'IDR' },
        { accountId: fandri.cash, amountMinor: 6_000, currency: 'IDR' },
      ],
    });
    await fandri.engine.leave(bookId);
    // The copy's lineage holds it as its head, though no filing row puts it in the copy.
    await fandri.database.db.run(
      sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES ('lineage-top-up', ${bookId}, ${transfer}, ${fandri.memberId}, 'Fandri Bank')`,
    );
    const [bank, cash] = [await balanceOf(fandri, fandri.bank), await balanceOf(fandri, fandri.cash)];
    expect((await planBookDelete(fandri.database, fandri.ws, bookId)).ownPurchases).toBe(3);
    await deleteBook(fandri.database, fandri.ws, bookId);
    expect([await balanceOf(fandri, fandri.bank), await balanceOf(fandri, fandri.cash)]).toEqual([bank, cash]);
    const [[filed]] = (await fandri.database.db.values<[string]>(sql`
      SELECT b.book_id FROM transactions t JOIN book_transactions b ON b.transaction_id = t.id WHERE t.description = 'Top up wallet' AND t.status = 'posted'`)) as [[string]];
    expect(filed).toBe(w.personal.id);
  });

  it('refuses, with nothing changed, a copy whose transactions another record keeps (I3)', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    // A record this erase cannot take names one of the copy's purchases (a partner transfer's posting, here).
    await fandri.database.db.run(sql`INSERT INTO member_transfer_postings (book_id, transfer_id, transaction_id) VALUES ('group-1', 'tr-2', ${w.own[0]})`);
    const bank = await balanceOf(fandri, fandri.bank);
    const plan = await planBookDelete(fandri.database, fandri.ws, bookId);
    expect(plan).toMatchObject({ refusalCode: 'RECORDS', kept: 1 });
    expect(plan.refusal).toContain('1 transaction');
    await expect(deleteBook(fandri.database, fandri.ws, bookId)).rejects.toMatchObject({ code: 'RECORDS' });
    expect(await balanceOf(fandri, fandri.bank)).toBe(bank);
    expect(await fandri.database.db.values(sql`SELECT status FROM transactions WHERE id = ${w.own[0]}`)).toEqual([['posted']]);
    expect(await count(fandri, 'shared_books', bookId)).toBe(1);
  });

  it('a line whose spending category is another workspace’s counts as filed there: refused as a split (M1)', async () => {
    const w = await left();
    const { fandri, bookId } = w;
    await fandri.database.db.run(
      sql`UPDATE entries SET spend_category_id = ${w.personalGroceries} WHERE transaction_id = ${w.own[0]} AND account_id = ${fandri.bank}`,
    );
    await expect(deleteBook(fandri.database, fandri.ws, bookId)).rejects.toMatchObject({ code: 'SPLIT' });
    expect(await fandri.database.db.values(sql`SELECT status FROM transactions WHERE id = ${w.own[0]}`)).toEqual([['posted']]);
  });
});

describe('wasEverShared', () => {
  async function plain() {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const book = await createBook(database, ws, { name: 'Side job', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
    return { database, ws, book };
  }
  const erases = async (database: Database, ws: Awaited<ReturnType<typeof plain>>['ws'], book: string) => (await planBookDelete(database, ws, book)).erases;

  it('is false for a workspace never shared, and true for each trace of a share', async () => {
    const a = await plain();
    expect(await erases(a.database, a.ws, a.book)).toBe(false);
    await a.database.db.run(sql`INSERT INTO settings (key, value) VALUES (${`sharing.member.${a.book}`}, 'member-x')`);
    expect(await erases(a.database, a.ws, a.book)).toBe(true);

    const b = await plain();
    await b.database.db.run(sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES ('lin-1', ${b.book}, NULL, 'member-x', 'Bank')`);
    expect(await erases(b.database, b.ws, b.book)).toBe(true);

    const c = await plain();
    await c.database.db.run(sql`UPDATE books SET kind = 'shared' WHERE id = ${c.book}`);
    expect(await erases(c.database, c.ws, c.book)).toBe(true);

    const d = await plain();
    await d.database.db.run(sql`
      INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at, unshared_reason) VALUES (${d.book}, 'relay-1', 1, 'member-x', 'unshared', '2026-10-01', 'stopped')`);
    expect(await planBookDelete(d.database, d.ws, d.book)).toMatchObject({ erases: true, refusal: null });
  });
});
