/**
 * What was not worth a draft, and the way back from it.
 *
 * A capture can be skipped for two reasons, both of them the owner's: it was an offer rather than a movement, or it
 * arrived while only money going out was wanted. Neither is a decision to throw the capture away — a promo can turn
 * out to have been a payment, and a setting can change — so a skipped capture is kept, readable, for a week.
 */
import { capturedDayOf, readCapture, type RawCapture, type Reading, WORDS } from '@expanses/core';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { DraftError, insertDraftRow } from '../repos/drafts';
import { captureSkipped } from '../schema-capture';
import { planDraft, SKIPPED_RETENTION_DAYS } from './ingest';
import { sourceFor } from './sources';

/** One capture that produced no draft, as the Skipped list reads it. */
export interface SkippedRow {
  id: string;
  reason: 'promo' | 'expenses-only';
  skippedAt: string;
  /** The capture itself, so the row can say what it was about. */
  capture: RawCapture;
  reading: Reading;
}

const parse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

const toRow = (row: typeof captureSkipped.$inferSelect): SkippedRow => ({
  id: row.id,
  reason: row.reason,
  skippedAt: row.skippedAt,
  capture: parse<RawCapture>(row.captureJson, {
    id: row.id,
    kind: 'notification',
    capturedAt: row.skippedAt,
    app: null,
    title: null,
    body: null,
    lines: [],
    imageFile: null,
  }),
  reading: parse<Reading>(row.readingJson, {
    skipped: 'promo',
    amount: null,
    occurredAt: null,
    type: { value: 'spent', confidence: 0, line: null },
    name: null,
    accountHint: null,
  }),
});

/**
 * What was skipped in the last week, newest first.
 *
 * A week is the same window the sweep uses, so the list never offers to bring back something the sweep has already
 * taken away.
 */
export async function listSkipped(database: Database, ws: WorkspaceContext, today: string): Promise<SkippedRow[]> {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - SKIPPED_RETENTION_DAYS);
  const rows = await database.db
    .select()
    .from(captureSkipped)
    .where(and(eq(captureSkipped.workspaceId, ws.workspaceId), gte(captureSkipped.skippedAt, since.toISOString())))
    .orderBy(desc(captureSkipped.skippedAt));
  return rows.map(toRow);
}

/**
 * Makes the draft a skipped capture would have been, and stops calling it skipped.
 *
 * Bringing one back is the owner overruling both the promo filter and the scope for this one capture, so neither is
 * consulted: the capture is read again — the source may have learned its layout since — and queued as it stands.
 */
export async function bringBack(database: Database, ws: WorkspaceContext, skippedId: string): Promise<string> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(captureSkipped)
      .where(and(eq(captureSkipped.workspaceId, ws.workspaceId), eq(captureSkipped.id, skippedId)));
    if (!row) throw new DraftError('NOT_FOUND', 'That capture was not skipped in this workspace');
    const capture = parse<RawCapture | null>(row.captureJson, null);
    if (!capture) throw new DraftError('NOT_FOUND', 'That capture was not kept in full, so there is nothing to bring back');

    // Not counted again: this capture has already been counted against its source.
    const source = await sourceFor(tx, capture, false);
    // Read for its money even if it is an offer: bringing it back is the owner saying it was a payment after all.
    const reading = readCapture(capture, WORDS, source.template, { skipPromos: false });
    const plan = await planDraft(tx, ws, capture, source, reading, { today: capturedDayOf(capture.capturedAt) });
    const id = await insertDraftRow(tx, plan.workspace, plan.draft, capture.capturedAt);
    await tx.delete(captureSkipped).where(eq(captureSkipped.id, skippedId));
    return id;
  });
}
