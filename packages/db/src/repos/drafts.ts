import { expenseLines, incomeLines, type Reading, transferLines, uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { draftTransactions } from '../schema-drafts';
import { existingExternalRefs } from './imports';
import { ledgerSourceOf, postTransactionTx, type TransactionSource } from './ledger';
import type { SetAsideChoice } from './set-aside-tx';

export class DraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

export interface DraftRow {
  id: string;
  source: TransactionSource;
  /** What confirming it will post. */
  kind: DraftKind;
  status: 'pending' | 'confirmed' | 'dismissed';
  rawPayload: string | null;
  occurredOn: string;
  description: string;
  /** Positive is money out, matching the import convention. */
  amountMinor: number;
  currency: string;
  accountId: string | null;
  /** Where a transfer's money went. Null for anything else. */
  toAccountId: string | null;
  categoryAccountId: string | null;
  cardId: string | null;
  /** The source this capture was recognised as, once there is one. */
  sourceId: string | null;
  /** The captures it was read out of. */
  captureIds: string[];
  /** The picture it came from, when it came from one. */
  imageFile: string | null;
  /** What the reader made of it, as it made it. */
  reading: Reading | null;
  /** The draft this one was found to be a duplicate of. Hidden from the queue while it is set. */
  mergedInto: string | null;
  confidence: number | null;
  externalRef: string | null;
  transactionId: string | null;
}

/** What a draft turns out to be: money out, money in, or money moved between two of the owner's own accounts. */
export type DraftKind = 'expense' | 'income' | 'transfer';

export interface NewDraft {
  source: TransactionSource;
  occurredOn: string;
  description: string;
  amountMinor: number;
  currency: string;
  /** Defaults by the sign: money in (negative) is income, money out an expense, as an imported row always meant. */
  kind?: DraftKind;
  accountId?: string | null;
  toAccountId?: string | null;
  categoryAccountId?: string | null;
  cardId?: string | null;
  sourceId?: string | null;
  captureIds?: readonly string[];
  imageFile?: string | null;
  reading?: Reading | null;
  mergedInto?: string | null;
  confidence?: number | null;
  externalRef?: string | null;
  rawPayload?: string | null;
}

/** How long a captured payload is kept after the draft is resolved. */
const RAW_RETENTION_DAYS = 90;

const addDays = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const toRow = (row: typeof draftTransactions.$inferSelect): DraftRow => ({
  id: row.id,
  source: row.source,
  kind: row.kind,
  status: row.status,
  rawPayload: row.rawPayload,
  occurredOn: row.occurredOn,
  description: row.description,
  amountMinor: row.amountMinor,
  currency: row.currency,
  accountId: row.accountId,
  toAccountId: row.toAccountId,
  categoryAccountId: row.categoryAccountId,
  cardId: row.cardId,
  sourceId: row.sourceId,
  captureIds: captureIdsOf(row.captureIds),
  imageFile: row.imageFile,
  reading: readingOf(row.readingJson),
  mergedInto: row.mergedInto,
  confidence: row.confidence,
  externalRef: row.externalRef,
  transactionId: row.transactionId,
});

/** The captures a draft was read out of, as they were written. A row written by hand may carry none. */
export function captureIdsOf(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** What the reader made of it. A draft typed by a person, or read before this column existed, carries none. */
export function readingOf(json: string | null): Reading | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Reading;
  } catch {
    return null;
  }
}

/** Every column a new draft fills, in one place: two doors in, one shape. */
function insertValues(ws: WorkspaceContext, draft: NewDraft, now: string) {
  return {
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    source: draft.source,
    // A row that names no kind says what it is by its sign: negative is money in (the import convention).
    kind: draft.kind ?? (draft.amountMinor < 0 ? 'income' : 'expense'),
    status: 'pending' as const,
    rawPayload: draft.rawPayload ?? null,
    rawPurgeAfter: null,
    occurredOn: draft.occurredOn,
    description: draft.description,
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    accountId: draft.accountId ?? null,
    toAccountId: draft.toAccountId ?? null,
    categoryAccountId: draft.categoryAccountId ?? null,
    cardId: draft.cardId ?? null,
    sourceId: draft.sourceId ?? null,
    captureIds: draft.captureIds && draft.captureIds.length > 0 ? JSON.stringify(draft.captureIds) : null,
    imageFile: draft.imageFile ?? null,
    readingJson: draft.reading ? JSON.stringify(draft.reading) : null,
    mergedInto: draft.mergedInto ?? null,
    confidence: draft.confidence ?? null,
    externalRef: draft.externalRef ?? null,
    transactionId: null,
    createdAt: now,
    resolvedAt: null,
  };
}

/**
 * One draft typed into the transactions table, returning its id so the row can keep being filled in.
 *
 * Unlike a capture there is nothing to deduplicate: a person typing a row means it, even if it looks
 * like one already there.
 */
export async function createDraft(database: Database, ws: WorkspaceContext, draft: NewDraft): Promise<string> {
  const values = insertValues(ws, draft, new Date().toISOString());
  await database.db.insert(draftTransactions).values(values);
  return values.id;
}

/**
 * Writes one draft row for a caller that is deciding what an arriving capture becomes, inside its own transaction.
 *
 * Asking "have I seen this payment already?" and writing the answer have to be one step: two captures of the same
 * payment arriving together would otherwise both look like the first one and the second would be queued as a
 * separate thing to do.
 */
export async function insertDraftRow(tx: Db, ws: WorkspaceContext, draft: NewDraft, now: string): Promise<string> {
  const values = insertValues(ws, draft, now);
  await tx.insert(draftTransactions).values(values);
  return values.id;
}

/**
 * Takes captured rows into the queue, skipping any already posted or already queued.
 *
 * Dedupe happens on the way in rather than on the way out: a source re-read — the same CSV imported
 * twice, the same statement opened again — should not make the owner dismiss the same rows a second
 * time.
 */
export async function captureDrafts(
  database: Database,
  ws: WorkspaceContext,
  drafts: readonly NewDraft[],
): Promise<{ captured: number; skipped: number }> {
  const refs = drafts.flatMap((draft) => (draft.externalRef ? [draft.externalRef] : []));
  const posted = await existingExternalRefs(database, ws, refs);
  const queuedRows = refs.length
    ? await database.db
        .select({ externalRef: draftTransactions.externalRef })
        .from(draftTransactions)
        .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), inArray(draftTransactions.externalRef, refs)))
    : [];
  const seen = new Set([...posted, ...queuedRows.flatMap((row) => (row.externalRef ? [row.externalRef] : []))]);

  const now = new Date().toISOString();
  let captured = 0;
  let skipped = 0;
  for (const draft of drafts) {
    if (draft.externalRef && seen.has(draft.externalRef)) {
      skipped++;
      continue;
    }
    await database.db.insert(draftTransactions).values(insertValues(ws, draft, now));
    if (draft.externalRef) seen.add(draft.externalRef);
    captured++;
  }
  return { captured, skipped };
}

/**
 * The queue: what is waiting to be dealt with.
 *
 * A draft that was merged into another is not waiting — it *is* that other row — so it is left out here and found
 * again only by Unmerge, which reads its pointer.
 */
export async function listDrafts(database: Database, ws: WorkspaceContext, status: DraftRow['status'] = 'pending'): Promise<DraftRow[]> {
  const rows = await database.db
    .select()
    .from(draftTransactions)
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.status, status), isNull(draftTransactions.mergedInto)))
    .orderBy(asc(draftTransactions.occurredOn), asc(draftTransactions.createdAt));
  return rows.map(toRow);
}

export async function countPendingDrafts(database: Database, ws: WorkspaceContext): Promise<number> {
  const [row] = await database.db
    .select({ count: sql<number>`count(*)` })
    .from(draftTransactions)
    // A draft that was merged into another is not something to deal with: it is the row it was merged into.
    .where(
      and(
        eq(draftTransactions.workspaceId, ws.workspaceId),
        eq(draftTransactions.status, 'pending'),
        isNull(draftTransactions.mergedInto),
      ),
    );
  return Number(row?.count ?? 0);
}

/** Corrects what was read out of a capture, before it is confirmed. */
export async function editDraft(
  database: Database,
  ws: WorkspaceContext,
  id: string,
  patch: Partial<Pick<NewDraft, 'occurredOn' | 'description' | 'amountMinor' | 'currency' | 'kind' | 'accountId' | 'toAccountId' | 'categoryAccountId' | 'cardId'>>,
): Promise<void> {
  await database.db
    .update(draftTransactions)
    .set(patch)
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.id, id), eq(draftTransactions.status, 'pending')));
}

/**
 * Turns a reviewed draft into a transaction, through the same posting engine everything else uses.
 *
 * What it posts is what the draft turned out to be. An expense moves money out of an account into a spending category;
 * money received moves it the other way, into an income category; a transfer moves it between two of the owner's own
 * accounts and asks for no category at all, because nothing was earned or spent.
 *
 * The draft is kept, marked confirmed and pointing at what it became, so a queue that was worked through can still be
 * read back afterwards. A capture that was photographed hands its picture back to the caller, which is what writes it
 * into the owner's own photo storage; the reading here never touches those bytes.
 */
export async function confirmDraft(
  database: Database,
  ws: WorkspaceContext,
  id: string,
  opts: {
    /** Which goal the money came out of, when it took more than was free (spec §4.4). */
    setAside?: SetAsideChoice | null;
    /** Keep the capture's picture with the transaction. The caller copies the bytes; this only says which file. */
    keepPhoto?: boolean;
  } = {},
): Promise<{ transactionId: string; keptImage: string | null }> {
  const [draft] = await database.db
    .select()
    .from(draftTransactions)
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.id, id)));
  if (!draft) throw new DraftError('NOT_FOUND', 'That draft is not in this workspace');
  if (draft.status !== 'pending') throw new DraftError('ALREADY_RESOLVED', 'That draft has already been dealt with');
  if (!draft.accountId) throw new DraftError('NO_ACCOUNT', 'Say which account paid before confirming');
  if (draft.kind === 'transfer') {
    if (!draft.toAccountId) throw new DraftError('NO_TO_ACCOUNT', 'Say which account the money went to');
  } else if (!draft.categoryAccountId) {
    throw new DraftError('NO_CATEGORY', 'Choose a category before confirming');
  }

  // The magnitude: the draft's own sign is the reader's convention, and the lines decide the direction.
  const amountMinor = Math.abs(draft.amountMinor);
  const currency = draft.currency;
  const lines =
    draft.kind === 'income'
      ? incomeLines({ incomeAccountId: draft.categoryAccountId!, depositAccountId: draft.accountId, amountMinor, currency })
      : draft.kind === 'transfer'
        ? transferLines({ fromAccountId: draft.accountId, toAccountId: draft.toAccountId!, amountMinor, currency })
        : expenseLines({ categoryAccountId: draft.categoryAccountId!, paymentAccountId: draft.accountId, amountMinor, currency });

  const keptImage = opts.keepPhoto === true ? draft.imageFile : null;
  const now = new Date().toISOString();
  return database.transaction(async (tx) => {
    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: draft.occurredOn,
      description: draft.description,
      source: ledgerSourceOf(draft.source),
      externalRef: draft.externalRef,
      cardId: draft.cardId,
      lines,
      setAside: opts.setAside ?? null,
    });
    const purgeAfter = addDays(now.slice(0, 10), RAW_RETENTION_DAYS);
    await tx
      .update(draftTransactions)
      .set({ status: 'confirmed', transactionId, resolvedAt: now, rawPurgeAfter: purgeAfter })
      .where(eq(draftTransactions.id, id));
    // The sightings folded into it are dealt with too, so what they were read from is swept with it.
    await tx
      .update(draftTransactions)
      .set({ status: 'confirmed', resolvedAt: now, rawPurgeAfter: purgeAfter })
      .where(and(eq(draftTransactions.mergedInto, id), eq(draftTransactions.status, 'pending')));
    return { transactionId, keptImage };
  });
}

/** Says a draft is not something to record. It stays, so the same capture is not offered again. */
export async function dismissDraft(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  const now = new Date().toISOString();
  const resolution = { status: 'dismissed' as const, resolvedAt: now, rawPurgeAfter: addDays(now.slice(0, 10), RAW_RETENTION_DAYS) };
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: draftTransactions.id })
      .from(draftTransactions)
      .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.id, id), eq(draftTransactions.status, 'pending')));
    if (!row) return;
    await tx.update(draftTransactions).set(resolution).where(eq(draftTransactions.id, id));
    // The sightings folded into it go with it.
    await tx
      .update(draftTransactions)
      .set(resolution)
      .where(and(eq(draftTransactions.mergedInto, id), eq(draftTransactions.status, 'pending')));
  });
}

/**
 * Puts a resolved draft back in the queue — the same way back from Record and from Discard.
 *
 * It is what the toast's Undo calls. The transaction a confirm posted is not this function's business: the ledger
 * takes it back through `voidTransaction`, and the draft returns with no transaction of its own, ready to be read
 * again. The keeping date goes with the resolution, so a reopened draft's payload is not purged under it.
 */
export async function reopenDraft(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: draftTransactions.id })
      .from(draftTransactions)
      .where(
        and(
          eq(draftTransactions.workspaceId, ws.workspaceId),
          eq(draftTransactions.id, id),
          // Only what was resolved: a pending draft has nothing to take back, and this must not touch its dates.
          ne(draftTransactions.status, 'pending'),
        ),
      );
    if (!row) return;
    const reopened = { status: 'pending' as const, transactionId: null, resolvedAt: null, rawPurgeAfter: null };
    await tx.update(draftTransactions).set(reopened).where(eq(draftTransactions.id, id));
    // The sightings folded into it come back with it, still folded in.
    await tx
      .update(draftTransactions)
      .set(reopened)
      .where(and(eq(draftTransactions.mergedInto, id), ne(draftTransactions.status, 'pending')));
  });
}

/**
 * Deletes captured payloads whose keeping date has passed.
 *
 * A bank email or statement line kept for ever is a liability, not an asset. The draft itself stays;
 * only what the source said verbatim goes.
 */
export async function purgeExpiredPayloads(database: Database, ws: WorkspaceContext, today: string): Promise<number> {
  const stale = await database.db
    .select({ id: draftTransactions.id })
    .from(draftTransactions)
    .where(
      and(
        eq(draftTransactions.workspaceId, ws.workspaceId),
        isNotNull(draftTransactions.rawPayload),
        isNotNull(draftTransactions.rawPurgeAfter),
        lte(draftTransactions.rawPurgeAfter, today),
      ),
    );
  if (stale.length === 0) return 0;
  await database.db
    .update(draftTransactions)
    .set({ rawPayload: null })
    .where(inArray(draftTransactions.id, stale.map((row) => row.id)));
  return stale.length;
}
