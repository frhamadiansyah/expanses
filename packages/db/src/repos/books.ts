import { isSupportedCurrency, uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { inBook, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, settings } from '../schema';
import { bookCategories, books, bookTransactions } from '../schema-books';
import { NOT_IN_A_SET } from '../schema-category-sets';
import { categoryMccs } from '../schema-points';
// Making a workspace is where three things meet: the book itself, the categories it starts with, and the card
// rules that name them. The other two live where they belong and are called from here.
import { replanCatalogProgramsTx } from './catalog';
import { ensureBookCategoryKeysTx } from './categories';
import { categoryTotalsIn } from './reports';

export type BookKind = 'personal' | 'business' | 'family' | 'shared';

export interface BookRow {
  id: string;
  name: string;
  kind: BookKind;
  baseCurrency: string;
  countEventsInBudget: boolean;
  archivedAt: string | null;
}

export class BookError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BookError';
  }
}

const KINDS: readonly BookKind[] = ['personal', 'business', 'family', 'shared'];

const toRow = (row: typeof books.$inferSelect): BookRow => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  baseCurrency: row.baseCurrency,
  countEventsInBudget: row.countEventsInBudget === 1,
  archivedAt: row.archivedAt,
});

/*
 * A database still stopped before migration 0042 has no book tables at all. Every write below is skipped in that
 * case so those databases keep working exactly as before books existed (the same reason cards, points and the
 * rest read the workspace whole). A positive result is memoised per database handle — the table never goes away
 * once created — but a negative one is not, since migrate() may run later on the same handle.
 */
const booksTableExists = new WeakMap<Db, boolean>();

export async function hasBooks(tx: Db): Promise<boolean> {
  if (booksTableExists.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'books'`);
  const exists = rows.length > 0;
  if (exists) booksTableExists.set(tx, true);
  return exists;
}

export async function listBooks(database: Database, ws: WorkspaceContext): Promise<BookRow[]> {
  const rows = await database.db
    .select()
    .from(books)
    .where(and(eq(books.workspaceId, ws.workspaceId), isNull(books.archivedAt)))
    .orderBy(asc(books.sortOrder), asc(books.createdAt));
  return rows.map(toRow);
}

/**
 * The workspace things fall back to: expected income, recreated default categories, default category sets, and a
 * category filed with no context. It is the book of kind 'personal' — never merely the first row, because archiving
 * or reordering would otherwise hand all of that to Business.
 */
export async function personalBook(database: Database, ws: WorkspaceContext): Promise<BookRow> {
  const open = await listBooks(database, ws);
  const found = open.find((book) => book.kind === 'personal') ?? open[0];
  if (!found) throw new BookError('NO_BOOK', 'This workspace has no workspaces in it');
  return found;
}

/**
 * personalBook's id, read inside a transaction (personalBook reads through database.db, which would wait on the
 * transaction's own lock). Null when the workspace has no books yet.
 */
export async function personalBookIdTx(tx: Db, workspaceId: string): Promise<string | null> {
  const rows = await tx
    .select({ id: books.id, kind: books.kind })
    .from(books)
    .where(and(eq(books.workspaceId, workspaceId), isNull(books.archivedAt)))
    .orderBy(asc(books.sortOrder), asc(books.createdAt));
  return (rows.find((row) => row.kind === 'personal') ?? rows[0])?.id ?? null;
}

/** Makes the Personal book for a workspace being created. Used inside createWorkspace's transaction. */
export async function createPersonalBookTx(tx: Db, workspaceId: string, baseCurrency: string, createdAt: string): Promise<string> {
  const id = uuidv7();
  await tx.insert(books).values({ id, workspaceId, name: 'Personal', kind: 'personal', baseCurrency, countEventsInBudget: 0, sortOrder: 0, archivedAt: null, createdAt });
  return id;
}

export async function bookOfCategory(tx: Db, categoryAccountId: string): Promise<string | null> {
  const [row] = await tx.select({ bookId: bookCategories.bookId }).from(bookCategories).where(eq(bookCategories.categoryAccountId, categoryAccountId));
  return row?.bookId ?? null;
}

/** A book of this workspace, archived or not — an id from another workspace is not here. */
async function bookOf(database: Database, ws: WorkspaceContext, bookId: string): Promise<BookRow> {
  const [row] = await database.db.select().from(books).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
  if (!row) throw new BookError('NOT_FOUND', 'That workspace is not here');
  return toRow(row);
}

export async function createBook(
  database: Database,
  ws: WorkspaceContext,
  input: { name: string; kind: BookKind; baseCurrency: string; countEventsInBudget?: boolean; copyCategoriesFrom?: string | null },
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new BookError('NAME_REQUIRED', 'A workspace needs a name');
  if (!KINDS.includes(input.kind)) throw new BookError('BAD_KIND', `${input.kind} is not a kind of workspace this app knows`);
  if (!isSupportedCurrency(input.baseCurrency)) throw new BookError('BAD_CURRENCY', `${input.baseCurrency} is not a currency this app knows`);
  const id = uuidv7();
  const now = new Date().toISOString();

  await database.transaction(async (tx) => {
    if (input.kind === 'personal') {
      const [existing] = await tx
        .select({ id: books.id })
        .from(books)
        .where(and(eq(books.workspaceId, ws.workspaceId), eq(books.kind, 'personal'), isNull(books.archivedAt)));
      if (existing) throw new BookError('ONE_PERSONAL', 'There is already a Personal workspace');
    }
    const [{ count }] = (await tx.select({ count: sql<number>`count(*)` }).from(books).where(eq(books.workspaceId, ws.workspaceId))) as [{ count: number }];
    await tx.insert(books).values({
      id,
      workspaceId: ws.workspaceId,
      name,
      kind: input.kind,
      baseCurrency: input.baseCurrency,
      countEventsInBudget: input.countEventsInBudget ? 1 : 0,
      sortOrder: Number(count),
      archivedAt: null,
      createdAt: now,
    });
    if (input.copyCategoriesFrom) await copyCategoriesTx(tx, ws, input.copyCategoriesFrom, id, now);

    // Whether it copied a tree or starts with none, the new workspace owns the categories the app posts into
    // itself, so a loan payment or a sale records here rather than in Personal.
    await ensureBookCategoryKeysTx(tx, ws, id, now);
    // A card is the owner's and its earning rules name category ids, so the categories that have just arrived
    // earn nothing until every catalogue program is planned again over them.
    await replanCatalogProgramsTx(tx, ws, now.slice(0, 10));
  });
  return id;
}

/** Copies one book's category tree into another: new ids, parents remapped, keys, icons and typed MCCs kept. */
async function copyCategoriesTx(tx: Db, ws: WorkspaceContext, fromBookId: string, toBookId: string, now: string): Promise<void> {
  // Only a book of this same workspace can be copied from, and only while it is still open — an id from
  // another workspace, or one that has been archived, refuses rather than silently copying nothing (or,
  // without the workspace check, another workspace's categories).
  const [sourceBook] = await tx
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, fromBookId), eq(books.workspaceId, ws.workspaceId), isNull(books.archivedAt)));
  if (!sourceBook) throw new BookError('NO_SOURCE', 'The workspace to copy categories from was not found in this workspace');

  // A copy is a new tree: new ids, parents remapped, system keys kept so a copy still means what the original
  // meant. Card earning rules are not kept by that alone — they name ids — so createBook plans them again.
  // Category-set members are excluded (NOT_IN_A_SET, as ensureCategoryKeys uses): they are event categories,
  // not part of the book's regular tree, even though a database migrated by 0042 filed them in a book too.
  const source = (
    await tx
      .select()
      .from(accounts)
      .innerJoin(bookCategories, eq(bookCategories.categoryAccountId, accounts.id))
      .where(
        and(
          eq(bookCategories.bookId, fromBookId),
          eq(bookCategories.workspaceId, ws.workspaceId),
          eq(accounts.workspaceId, ws.workspaceId),
          isNull(accounts.archivedAt),
          NOT_IN_A_SET,
        ),
      )
  ).map(({ accounts: a }) => a);
  const sourceIds = new Set(source.map((a) => a.id));
  const newIds = new Map(source.map((a) => [a.id, uuidv7()]));

  // Parents must be inserted (and their new id known) before children that reference them via parent_id, a
  // foreign key. Order is not guaranteed by the query above, so insert in dependency order rather than row
  // order. A parent excluded from the copy (archived, or claimed by a category set) never arrives, so its
  // child is ready immediately too and is filed at the top level instead of waiting forever.
  const remaining = [...source];
  const insertedOldIds = new Set<string>();
  while (remaining.length) {
    const readyIndex = remaining.findIndex((a) => !a.parentId || insertedOldIds.has(a.parentId) || !sourceIds.has(a.parentId));
    // Every parent a remaining row could be waiting on is itself in source, so this can only be -1 if the
    // tree has a cycle, which createAccountTx never allows (a parent must exist before its child does).
    if (readyIndex === -1) throw new BookError('CYCLE', 'Category tree has a cycle it cannot copy');
    const a = remaining.splice(readyIndex, 1)[0]!;
    const parentId = a.parentId && newIds.has(a.parentId) ? newIds.get(a.parentId)! : null;
    await tx.insert(accounts).values({ ...a, id: newIds.get(a.id)!, workspaceId: ws.workspaceId, parentId, createdAt: now });
    await tx.insert(bookCategories).values({ categoryAccountId: newIds.get(a.id)!, workspaceId: ws.workspaceId, bookId: toBookId });
    insertedOldIds.add(a.id);
  }

  if (sourceIds.size === 0) return;
  // The typed MCC is a property of "this category means restaurants", which is exactly what was copied. Without
  // it a copied workspace earns at the card's base rate until somebody notices. `catalog_category_choices` is
  // keyed by (program_id, option_key) — it belongs to the card, not to a category — so there is nothing of it
  // to copy.
  const typed = await tx
    .select({ categoryId: categoryMccs.categoryId, mcc: categoryMccs.mcc })
    .from(categoryMccs)
    .where(and(eq(categoryMccs.workspaceId, ws.workspaceId), inArray(categoryMccs.categoryId, [...sourceIds])));
  for (const row of typed) {
    await tx.insert(categoryMccs).values({ categoryId: newIds.get(row.categoryId)!, workspaceId: ws.workspaceId, mcc: row.mcc });
  }
}

export async function renameBook(database: Database, ws: WorkspaceContext, bookId: string, name: string): Promise<void> {
  await bookOf(database, ws, bookId);
  const trimmed = name.trim();
  if (!trimmed) throw new BookError('NAME_REQUIRED', 'A workspace needs a name');
  await database.db.update(books).set({ name: trimmed }).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
}

export async function archiveBook(database: Database, ws: WorkspaceContext, bookId: string): Promise<void> {
  const book = await bookOf(database, ws, bookId);
  if (book.kind === 'personal') throw new BookError('PERSONAL_BOOK', 'Personal is where categories and expected income fall back to, so it stays');
  const open = await listBooks(database, ws);
  if (open.length <= 1) throw new BookError('LAST_BOOK', 'The last workspace cannot be archived');
  await database.db.update(books).set({ archivedAt: new Date().toISOString() }).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
}

const activeKey = (ws: WorkspaceContext) => `active_book:${ws.workspaceId}`;

/** The book the app last had open, or Personal when it was never set or has since been archived. */
export async function activeBookId(database: Database, ws: WorkspaceContext): Promise<string> {
  const open = await listBooks(database, ws);
  const [row] = await database.db.select({ value: settings.value }).from(settings).where(eq(settings.key, activeKey(ws)));
  const remembered = open.find((book) => book.id === row?.value);
  return (remembered ?? open[0])!.id;
}

export async function setActiveBook(database: Database, ws: WorkspaceContext, bookId: string): Promise<void> {
  const book = await bookOf(database, ws, bookId);
  if (book.archivedAt) throw new BookError('NOT_FOUND', 'That workspace is not here');
  await database.db.insert(settings).values({ key: activeKey(ws), value: bookId }).onConflictDoUpdate({ target: settings.key, set: { value: bookId } });
}

/** Whether this workspace's monthly caps count spending tagged to an event. */
export async function setBookEventsInBudget(database: Database, ws: WorkspaceContext, bookId: string, on: boolean): Promise<void> {
  await bookOf(database, ws, bookId);
  await database.db.update(books).set({ countEventsInBudget: on ? 1 : 0 }).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, bookId)));
}

/**
 * Which workspace each of these transactions was filed in. Ones filed nowhere — a transfer, a card-funded
 * purchase — are simply absent, so a row that belongs to every workspace is badged in none.
 */
export async function bookNamesOf(
  database: Database,
  ws: WorkspaceContext,
  transactionIds: readonly string[],
): Promise<Record<string, { id: string; name: string; kind: BookKind }>> {
  if (transactionIds.length === 0 || !(await hasBooks(database.db))) return {};
  const rows = await database.db
    .select({ transactionId: bookTransactions.transactionId, id: books.id, name: books.name, kind: books.kind })
    .from(bookTransactions)
    .innerJoin(books, eq(books.id, bookTransactions.bookId))
    .where(and(eq(bookTransactions.workspaceId, ws.workspaceId), inArray(bookTransactions.transactionId, [...transactionIds])));
  return Object.fromEntries(rows.map((row) => [row.transactionId, { id: row.id, name: row.name, kind: row.kind }]));
}

/**
 * What each workspace spent between two dates, each in the currency that workspace reads in.
 *
 * A loop rather than one grouped query: a workspace reading in dollars converts amount by amount, at the rate on
 * each day, and there are only ever a handful of workspaces. Reusing the same reading its own screens use is what
 * keeps the switcher's figure and the workspace's own chart from disagreeing. Transfers and card payments are filed
 * in no workspace, so they are in nobody's figure — which is the rule everywhere else too.
 */
export async function spentThisMonthByBook(
  database: Database,
  ws: WorkspaceContext,
  from: string,
  to: string,
): Promise<Record<string, { amountMinor: number; currency: string }>> {
  if (!(await hasBooks(database.db))) return {};
  const spent: Record<string, { amountMinor: number; currency: string }> = {};
  for (const book of await listBooks(database, ws)) {
    const totals = await categoryTotalsIn(database, inBook(ws, book.id), 'expense', from, to);
    spent[book.id] = { amountMinor: totals.rows.reduce((sum, row) => sum + row.amountBaseMinor, 0), currency: totals.currency };
  }
  return spent;
}

/** Category ids filed in a book, for narrowing owner-wide queries to it. */
export async function categoryIdsOfBook(database: Database, bookId: string): Promise<string[]> {
  const rows = await database.db.select({ id: bookCategories.categoryAccountId }).from(bookCategories).where(eq(bookCategories.bookId, bookId));
  return rows.map((row) => row.id);
}
