import { type Database, heldElsewhereOf, type HeldRow, listArchivedBooks, listBooks, listSharedBooks, type WorkspaceContext } from '@expanses/db';
import { copyLabel, heldLine } from './sharing-copy';
import { workspaceBooks } from './workspace-books';

export interface CopyRef {
  bookId: string;
  /** "Home · joined 3 Oct": the name, and when, so two copies of one name are told apart (A8 review I-2). */
  label: string;
}

export interface CopyRoles {
  label: string;
  /** Newer active shares here waiting on rows this copy holds: deleting this copy lets them come in. */
  holdsFor: CopyRef[];
  /** Old copies of this workspace holding rows of this copy's share, while that share is active: this is the newer share. */
  heldBy: CopyRef[];
  /** Separate workspaces that happen to hold rows of this share (a category tagged into both): never to leave or delete. */
  alsoIn: CopyRef[];
  /** Every workspace's label here, by book id. */
  labels: Record<string, string>;
  /** By holder book id: an old copy of this workspace (true) or a separate workspace (false). */
  oldCopy: Record<string, boolean>;
  /** By book id: shared and active here. */
  active: Record<string, boolean>;
  /**
   * Whether a share of this workspace may still arrive or is already here elsewhere (re-review m-2): another active
   * copy of the same name and owner, or this copy waiting for an invite, stopped by its owner, or lost here. Only then
   * does the delete sheet warn to join first.
   */
  newShareLikely: boolean;
}

/**
 * Which copy a workspace is, beside others of the same workspace here (A8 review I-2, I-5; re-review N-1, N-2). Read
 * from local rows only.
 *
 * - Roles hold only while the share in question is active: a copy whose share ended keeps its `HELD_ELSEWHERE` rows in
 *   `sync_skipped`, but nothing comes in from it any more, so it is neither the newer share nor waited on (N-1).
 * - A holder is the OLD copy only when it has this workspace's very name and an owner in common, or holds a purchase
 *   of this share's log (a held purchase naming it). Anything else is a separate workspace — Business beside Home —
 *   which is never told to leave or delete for another share's sake (N-2).
 */
export async function copyRolesOf(database: Database, ws: WorkspaceContext, bookId: string, nowMs: number, lost = false): Promise<CopyRoles> {
  const shared = workspaceBooks(await listSharedBooks(database));
  const books = [...(await listBooks(database, ws)), ...(await listArchivedBooks(database, ws))];
  const rowOf = (id: string) => shared.find((each) => each.bookId === id);
  const labelOf = (id: string): string => {
    const book = books.find((each) => each.id === id);
    if (!book) return 'another copy';
    return copyLabel({ name: book.name, joined: book.kind === 'shared', sharedAt: rowOf(id)?.sharedAt ?? null }, nowMs);
  };
  const nameOf = (id: string) => books.find((each) => each.id === id)?.name ?? null;
  const ownersOf = (id: string) => new Set((rowOf(id)?.members ?? []).filter((m) => m.role === 'owner').map((m) => m.name));
  const isActive = (id: string) => rowOf(id)?.state === 'active';

  /** Whether `holder` is an old copy of `share`'s workspace, given the share's held rows that name it. */
  const oldCopyOf = (share: string, holder: string, heldPurchase: boolean): boolean => {
    if (heldPurchase) return true;
    const sameName = nameOf(holder) !== null && nameOf(holder) === nameOf(share);
    const commonOwner = [...ownersOf(holder)].some((name) => ownersOf(share).has(name));
    return sameName && commonOwner;
  };

  const oldCopy: Record<string, boolean> = {};
  const heldBy: string[] = [];
  const alsoIn: string[] = [];
  if (isActive(bookId)) {
    const held = (await heldElsewhereOf(database, bookId)).filter((row) => row.holderExists);
    for (const holder of new Set(held.map((row) => row.holderBookId))) {
      const old = oldCopyOf(bookId, holder, held.some((row) => row.holderBookId === holder && row.entity === 'purchase'));
      oldCopy[holder] = old;
      (old ? heldBy : alsoIn).push(holder);
    }
  }
  const holdsFor: string[] = [];
  for (const other of shared) {
    if (other.bookId === bookId || other.state !== 'active') continue;
    const naming = (await heldElsewhereOf(database, other.bookId)).filter((row) => row.holderBookId === bookId);
    if (naming.length > 0 && oldCopyOf(other.bookId, bookId, naming.some((row) => row.entity === 'purchase'))) holdsFor.push(other.bookId);
  }
  const ref = (id: string): CopyRef => ({ bookId: id, label: labelOf(id) });
  const self = rowOf(bookId);
  const sameElsewhere = shared.some((other) => other.bookId !== bookId && other.state === 'active' && oldCopyOf(other.bookId, bookId, false));
  const newShareLikely = sameElsewhere || lost || self?.state === 'needs_invite' || (self?.state === 'unshared' && self.unsharedReason === 'stopped');
  return {
    label: labelOf(bookId),
    holdsFor: holdsFor.map(ref),
    heldBy: heldBy.map(ref),
    alsoIn: alsoIn.map(ref),
    labels: Object.fromEntries(books.map((b) => [b.id, labelOf(b.id)])),
    oldCopy,
    active: Object.fromEntries(shared.map((b) => [b.bookId, b.state === 'active'])),
    newShareLikely,
  };
}

/** The held line of a share, its holders named by label and told apart as old copies or separate workspaces. */
export function heldLineOf(held: readonly HeldRow[], roles: CopyRoles | undefined): string | null {
  return heldLine(
    held.map((row) => ({
      holderName: roles?.labels[row.holderBookId] ?? row.holderName,
      holderExists: row.holderExists,
      // Until the roles are read, a holder counts as an old copy: the line then says what it always said.
      holderSeparate: roles ? roles.oldCopy[row.holderBookId] === false : false,
      holderActive: roles?.active[row.holderBookId] ?? false,
    })),
  );
}
