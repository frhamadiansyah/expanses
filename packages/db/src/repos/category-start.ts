import { BUSINESS_CATEGORIES, DEFAULT_CATEGORIES, isUncategorisedKey, uuidv7 } from '@expanses/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { bookCategories, books } from '../schema-books';
import { NOT_IN_A_SET } from '../schema-category-sets';
import { withCapture } from '../sync/capture';
import { BookError, isJoinedBookTx } from './books';
import { POSTED_INTO_KEYS } from './categories';
import { categoryUsesTx } from './category-delete';

export type CategoryStart = 'business' | 'personal' | 'empty';

export interface CategoryStartResult {
  /** Names of the business categories that were added. */
  added: string[];
  /** Ids of the categories archived. */
  archived: string[];
}

/**
 * Keys that stay open whatever the start: the app posts into them without anyone choosing (`POSTED_INTO_KEYS`) or makes
 * them on first need (top-ups, refunds), and a second copy would be made the moment the first was archived. Their
 * parents stay too, because a parent with an open child is never archived.
 */
const KEPT_KEYS: ReadonlySet<string> = new Set([...POSTED_INTO_KEYS, 'miscellaneous.top_ups', 'miscellaneous.refunds', 'business']);

/** Default key -> its seed name, to tell a default the owner has not renamed from one they have. */
const DEFAULT_NAMES = new Map<string, string>(
  DEFAULT_CATEGORIES.flatMap((category) => [[category.key, category.name] as const, ...(category.children ?? []).map((child) => [child.key, child.name] as const)]),
);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Sets how one workspace's category list starts, in one transaction.
 *
 * - `business`: archives the book's untouched default personal categories that nothing uses, then adds the business
 *   list (`BUSINESS_CATEGORIES`), skipping a name (same kind, top level) the book still has open.
 * - `personal`: nothing; the book keeps what it has.
 * - `empty`: archives every category of the book that nothing uses.
 *
 * "Nothing uses it" is `categoryUsesTx`: a transaction (voided included), draft, budget, bill, event plan or card rule.
 * A category is archived (reversible), never deleted. One that is used, or that the owner made or renamed (for
 * `business`), or that the app posts into itself, is left. A parent is archived only when all its open children are.
 * Idempotent. A workspace joined from someone else's share is refused: its categories arrive by sync under the owner's
 * ids. The owner's own shared workspace is captured, so the change travels.
 */
export async function applyCategoryStart(
  database: Database,
  ws: WorkspaceContext,
  input: { bookId: string; start: CategoryStart },
): Promise<CategoryStartResult> {
  if (input.start !== 'business' && input.start !== 'personal' && input.start !== 'empty') {
    throw new BookError('BAD_START', `${String(input.start)} is not a way to start a category list`);
  }
  const [book] = await database.db.select().from(books).where(and(eq(books.workspaceId, ws.workspaceId), eq(books.id, input.bookId)));
  if (!book) throw new BookError('NOT_FOUND', 'That workspace is not here');
  if (input.start === 'personal') return { added: [], archived: [] };
  if (book.archivedAt !== null) throw new BookError('ARCHIVED', 'An archived workspace cannot change its categories');
  if (book.kind === 'shared' || (await isJoinedBookTx(database.db, book.id))) {
    throw new BookError('SHARED', 'The categories of a shared workspace are set by its owner');
  }

  return database.transaction((tx) =>
    withCapture(tx, { entity: 'category', bookId: book.id }, async () => {
      const now = new Date().toISOString();
      const open = (
        await tx
          .select({ account: accounts })
          .from(accounts)
          .innerJoin(bookCategories, eq(bookCategories.categoryAccountId, accounts.id))
          .where(
            and(
              eq(bookCategories.bookId, book.id),
              eq(bookCategories.workspaceId, ws.workspaceId),
              eq(accounts.workspaceId, ws.workspaceId),
              eq(accounts.subtype, 'category'),
              isNull(accounts.archivedAt),
              NOT_IN_A_SET,
            ),
          )
      ).map((row) => row.account);

      // Who may go: for `business` only an untouched default, for `empty` any category; never a kept key.
      const mayGo = (row: (typeof open)[number]) => {
        if (isUncategorisedKey(row.systemKey)) return false;
        if (row.systemKey !== null && KEPT_KEYS.has(row.systemKey)) return false;
        if (input.start === 'empty') return true;
        return row.systemKey !== null && DEFAULT_NAMES.get(row.systemKey) === row.name;
      };
      const candidates = new Set<string>();
      for (const row of open) {
        if (!mayGo(row)) continue;
        // Subcategories are settled below, from the open children; an archived child does not hold its parent.
        const uses = (await categoryUsesTx(tx, row.id)).filter((use) => use.use !== 'subcategories');
        if (uses.length === 0) candidates.add(row.id);
      }
      for (let changed = true; changed; ) {
        changed = false;
        for (const id of [...candidates]) {
          if (open.some((child) => child.parentId === id && !candidates.has(child.id))) {
            candidates.delete(id);
            changed = true;
          }
        }
      }
      const archived = [...candidates];
      if (archived.length > 0) await tx.update(accounts).set({ archivedAt: now }).where(inArray(accounts.id, archived));

      const added: string[] = [];
      if (input.start === 'business') {
        const stillOpen = open.filter((row) => !candidates.has(row.id));
        const next = (kind: 'income' | 'expense') =>
          Math.max(-1, ...stillOpen.filter((row) => row.parentId === null && row.kind === kind).map((row) => row.sortOrder)) + 1;
        const order = { income: next('income'), expense: next('expense') };
        for (const spec of BUSINESS_CATEGORIES) {
          if (stillOpen.some((row) => row.parentId === null && row.kind === spec.kind && sameName(row.name, spec.name))) continue;
          const id = uuidv7();
          await tx.insert(accounts).values({
            id,
            workspaceId: ws.workspaceId,
            parentId: null,
            kind: spec.kind,
            subtype: 'category',
            name: spec.name,
            icon: spec.icon,
            currency: null,
            valuationMode: 'derived',
            systemKey: spec.key,
            sortOrder: order[spec.kind]++,
            archivedAt: null,
            createdAt: now,
          });
          await tx.insert(bookCategories).values({ categoryAccountId: id, workspaceId: ws.workspaceId, bookId: book.id });
          added.push(spec.name);
        }
      }
      return { added, archived };
    }),
  );
}
