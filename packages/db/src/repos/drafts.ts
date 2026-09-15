import { uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { draftTransactions } from '../schema-drafts';
import { existingExternalRefs } from './imports';
import { postTransactionTx, type TransactionSource } from './ledger';

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
  status: 'pending' | 'confirmed' | 'dismissed';
  rawPayload: string | null;
  occurredOn: string;
  description: string;
  /** Positive is money out, matching the import convention. */
  amountMinor: number;
  currency: string;
  accountId: string | null;
  categoryAccountId: string | null;
  cardId: string | null;
  confidence: number | null;
  externalRef: string | null;
  transactionId: string | null;
}

export interface NewDraft {
  source: TransactionSource;
  occurredOn: string;
  description: string;
  amountMinor: number;
  currency: string;
  accountId?: string | null;
  categoryAccountId?: string | null;
  cardId?: string | null;
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
  status: row.status,
  rawPayload: row.rawPayload,
  occurredOn: row.occurredOn,
  description: row.description,
  amountMinor: row.amountMinor,
  currency: row.currency,
  accountId: row.accountId,
  categoryAccountId: row.categoryAccountId,
  cardId: row.cardId,
  confidence: row.confidence,
  externalRef: row.externalRef,
  transactionId: row.transactionId,
});

/**
 * One draft typed into the transactions table, returning its id so the row can keep being filled in.
 *
 * Unlike a capture there is nothing to deduplicate: a person typing a row means it, even if it looks
 * like one already there.
 */
export async function createDraft(database: Database, ws: WorkspaceContext, draft: NewDraft): Promise<string> {
  const id = uuidv7();
  await database.db.insert(draftTransactions).values({
    id,
    workspaceId: ws.workspaceId,
    source: draft.source,
    status: 'pending',
    rawPayload: draft.rawPayload ?? null,
    rawPurgeAfter: null,
    occurredOn: draft.occurredOn,
    description: draft.description,
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    accountId: draft.accountId ?? null,
    categoryAccountId: draft.categoryAccountId ?? null,
    cardId: draft.cardId ?? null,
    confidence: draft.confidence ?? null,
    externalRef: draft.externalRef ?? null,
    transactionId: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  });
  return id;
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
    await database.db.insert(draftTransactions).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      source: draft.source,
      status: 'pending',
      rawPayload: draft.rawPayload ?? null,
      rawPurgeAfter: null,
      occurredOn: draft.occurredOn,
      description: draft.description,
      amountMinor: draft.amountMinor,
      currency: draft.currency,
      accountId: draft.accountId ?? null,
      categoryAccountId: draft.categoryAccountId ?? null,
      cardId: draft.cardId ?? null,
      confidence: draft.confidence ?? null,
      externalRef: draft.externalRef ?? null,
      transactionId: null,
      createdAt: now,
      resolvedAt: null,
    });
    if (draft.externalRef) seen.add(draft.externalRef);
    captured++;
  }
  return { captured, skipped };
}

export async function listDrafts(database: Database, ws: WorkspaceContext, status: DraftRow['status'] = 'pending'): Promise<DraftRow[]> {
  const rows = await database.db
    .select()
    .from(draftTransactions)
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.status, status)))
    .orderBy(asc(draftTransactions.occurredOn), asc(draftTransactions.createdAt));
  return rows.map(toRow);
}

export async function countPendingDrafts(database: Database, ws: WorkspaceContext): Promise<number> {
  const [row] = await database.db
    .select({ count: sql<number>`count(*)` })
    .from(draftTransactions)
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.status, 'pending')));
  return Number(row?.count ?? 0);
}

/** Corrects what was read out of a capture, before it is confirmed. */
export async function editDraft(
  database: Database,
  ws: WorkspaceContext,
  id: string,
  patch: Partial<Pick<NewDraft, 'occurredOn' | 'description' | 'amountMinor' | 'currency' | 'accountId' | 'categoryAccountId' | 'cardId'>>,
): Promise<void> {
  await database.db
    .update(draftTransactions)
    .set(patch)
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.id, id), eq(draftTransactions.status, 'pending')));
}

/**
 * Turns a reviewed draft into a transaction, through the same posting engine everything else uses.
 *
 * The draft is kept, marked confirmed and pointing at what it became, so a queue that was worked
 * through can still be read back afterwards.
 */
export async function confirmDraft(database: Database, ws: WorkspaceContext, id: string): Promise<string> {
  const [draft] = await database.db
    .select()
    .from(draftTransactions)
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.id, id)));
  if (!draft) throw new DraftError('NOT_FOUND', 'That draft is not in this workspace');
  if (draft.status !== 'pending') throw new DraftError('ALREADY_RESOLVED', 'That draft has already been dealt with');
  if (!draft.accountId) throw new DraftError('NO_ACCOUNT', 'Say which account paid before confirming');
  if (!draft.categoryAccountId) throw new DraftError('NO_CATEGORY', 'Choose a category before confirming');

  const now = new Date().toISOString();
  return database.transaction(async (tx) => {
    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: draft.occurredOn,
      description: draft.description,
      source: draft.source,
      externalRef: draft.externalRef,
      cardId: draft.cardId,
      lines: [
        { accountId: draft.categoryAccountId!, amountMinor: draft.amountMinor, currency: draft.currency },
        { accountId: draft.accountId!, amountMinor: -draft.amountMinor, currency: draft.currency },
      ],
    });
    await tx
      .update(draftTransactions)
      .set({ status: 'confirmed', transactionId, resolvedAt: now, rawPurgeAfter: addDays(now.slice(0, 10), RAW_RETENTION_DAYS) })
      .where(eq(draftTransactions.id, id));
    return transactionId;
  });
}

/** Says a draft is not something to record. It stays, so the same capture is not offered again. */
export async function dismissDraft(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  const now = new Date().toISOString();
  await database.db
    .update(draftTransactions)
    .set({ status: 'dismissed', resolvedAt: now, rawPurgeAfter: addDays(now.slice(0, 10), RAW_RETENTION_DAYS) })
    .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.id, id), eq(draftTransactions.status, 'pending')));
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
