/**
 * Turning what the phone handed over into drafts.
 *
 * Everything a capture is worth is decided here, in one pass per capture and in the order they arrived: which source
 * it came from, what the reader makes of it with whatever that source has learned, whether it is worth recording at
 * all, and whether it is a second sighting of something already in the queue. A capture is never recorded — it
 * becomes a draft the owner confirms, and there is no path from here to the ledger.
 *
 * Nothing leaves the phone: this is the database's own copy of what was captured, and the words it was read with are
 * files in the package.
 */
import { readCapture, type RawCapture, type Reading, uuidv7, WORDS } from '@expanses/core';
import { and, eq, inArray, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { insertDraftRow, type NewDraft } from '../repos/drafts';
import { accounts, transactions, workspaces } from '../schema';
import { captureSettings, captureSkipped } from '../schema-capture';
import { draftTransactions } from '../schema-drafts';
import { readingWithLines } from './learn';
import { findMatch, makeTransferPair, mergeInto } from './match';
import { type CaptureSource, sourceFor } from './sources';

/** What the owner wants out of capture: everything, or only the money that left. */
export type CaptureScope = 'everything' | 'expenses-only';

/** How long a capture that produced no draft is kept, so it can be brought back. */
export const SKIPPED_RETENTION_DAYS = 7;

/** How many days a picture is kept after the draft it belongs to was dealt with. */
const IMAGE_RETENTION_DAYS = 7;

const addDays = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export async function getCaptureScope(database: Database): Promise<CaptureScope> {
  const [row] = await database.db.select().from(captureSettings).where(eq(captureSettings.key, 'scope'));
  return row?.value === 'expenses-only' ? 'expenses-only' : 'everything';
}

export async function setCaptureScope(database: Database, scope: CaptureScope): Promise<void> {
  const [row] = await database.db.select().from(captureSettings).where(eq(captureSettings.key, 'scope'));
  if (row) {
    await database.db.update(captureSettings).set({ value: scope }).where(eq(captureSettings.key, 'scope'));
    return;
  }
  await database.db.insert(captureSettings).values({ key: 'scope', value: scope });
}

/** What a capture becomes before anything is written: the draft, and whose draft it is. */
export interface CapturePlan {
  /** The workspace the draft belongs to: the source's own, when the answer named one that still exists. */
  workspace: WorkspaceContext;
  draft: NewDraft;
}

/**
 * Whose draft this is.
 *
 * A source answered for one workspace's account keeps filing there, even when the phone is being read as another
 * workspace — the answer was about whose money it is. A workspace that has since been deleted is not an answer any
 * more, so the draft falls back to the one being read.
 */
async function workspaceFor(tx: Db, ws: WorkspaceContext, source: CaptureSource): Promise<WorkspaceContext> {
  if (!source.workspaceId) return ws;
  const [row] = await tx
    .select({ id: workspaces.id, baseCurrency: workspaces.baseCurrency })
    .from(workspaces)
    .where(eq(workspaces.id, source.workspaceId));
  return row ? { workspaceId: row.id, baseCurrency: row.baseCurrency } : ws;
}

/**
 * The account a source's captures are filed on, when the answer still stands.
 *
 * An account that was archived or deleted since the source learned it is not an answer any more: the draft asks
 * "Which account is this?" again rather than filing money against an account the owner has put away.
 */
async function accountFor(tx: Db, source: CaptureSource): Promise<{ id: string; currency: string | null } | null> {
  if (!source.accountId) return null;
  const [row] = await tx
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, source.accountId), isNull(accounts.archivedAt)));
  return row ?? null;
}

/** What the source said, verbatim: a notification's own words, or the lines read off an image. */
function rawPayloadOf(capture: RawCapture): string | null {
  const text = [capture.title, capture.body].filter((part): part is string => part !== null && part !== '').join('\n');
  if (text !== '') return text;
  const lines = capture.lines.map((line) => line.text).join('\n');
  return lines === '' ? null : lines;
}

/** Which way the money went in the capture's own reading. A top-up arrives in the account it was read from. */
function directionOf(type: Reading['type']['value']): 'out' | 'in' {
  return type === 'spent' ? 'out' : 'in';
}

/**
 * What one capture becomes, in the draft's own terms.
 *
 * The conventions are the import's, which the queue already keeps: a figure is positive when money left the account
 * it names, money received is negative, and a top-up is a transfer whose destination is known and whose source is the
 * question the draft asks.
 */
export async function planDraft(
  tx: Db,
  ws: WorkspaceContext,
  capture: RawCapture,
  source: CaptureSource,
  reading: Reading,
  opts: { today: string },
): Promise<CapturePlan> {
  const workspace = await workspaceFor(tx, ws, source);
  const account = await accountFor(tx, source);
  const type = reading.type.value;
  const amountMinor = reading.amount?.value.minor ?? 0;
  const currency = reading.amount?.value.currency ?? account?.currency ?? workspace.baseCurrency;
  const printed = reading.occurredAt?.value ?? null;

  return {
    workspace,
    draft: {
      source: capture.kind === 'notification' ? 'notification' : capture.kind === 'screen' ? 'screen' : 'photo',
      kind: type === 'topup' ? 'transfer' : type === 'spent' ? 'expense' : 'income',
      occurredOn: printed?.slice(0, 10) || capture.capturedAt.slice(0, 10) || opts.today,
      // A picture that read no name still says what it is on its first line.
      description:
        reading.name?.value?.trim() || capture.title?.trim() || capture.lines[0]?.text.trim() || 'Captured payment',
      // Leaving is positive, arriving is negative: the one convention every other draft already keeps.
      amountMinor: directionOf(type) === 'out' ? amountMinor : -amountMinor,
      currency,
      accountId: type === 'topup' ? null : (account?.id ?? null),
      toAccountId: type === 'topup' ? (account?.id ?? null) : null,
      categoryAccountId: null,
      sourceId: source.id,
      captureIds: [capture.id],
      imageFile: capture.imageFile,
      // The lines travel with the reading: a correction has to be able to point at one of them.
      reading: readingWithLines(reading, capture.lines),
      confidence: reading.amount?.confidence ?? null,
      rawPayload: rawPayloadOf(capture),
      externalRef: `capture:${capture.id}`,
    },
  };
}

/** Whether this capture has been read before: the same file drained twice is the same payment. */
async function alreadyRead(tx: Db, ref: string): Promise<boolean> {
  const [queued] = await tx
    .select({ id: draftTransactions.id })
    .from(draftTransactions)
    .where(eq(draftTransactions.externalRef, ref))
    .limit(1);
  if (queued) return true;
  const [posted] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.externalRef, ref))
    .limit(1);
  return posted !== undefined;
}

/** Keeps a capture that produced no draft where the owner can bring it back from. */
async function skip(
  tx: Db,
  ws: WorkspaceContext,
  reason: 'promo' | 'expenses-only',
  capture: RawCapture,
  reading: Reading,
): Promise<void> {
  await tx.insert(captureSkipped).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    reason,
    captureJson: JSON.stringify(capture),
    readingJson: JSON.stringify(readingWithLines(reading, capture.lines)),
    skippedAt: new Date().toISOString(),
  });
}

export interface IngestResult {
  /** Captures that became a draft of their own. */
  drafts: number;
  /** Captures that were the same money as something already in the queue or already recorded. */
  merged: number;
  /** Captures that were an offer, or arrived while only money going out was wanted. */
  skipped: number;
}

/**
 * Takes what the phone handed over into the queue.
 *
 * Captures are placed in the order they arrived, whatever order they were handed over in, because "the same payment
 * twice" is a question about time: two screenshots of one payment merge, two coffees do not. The earliest of a batch
 * is what the later ones are matched against, and a match is decided and written in one step, so two captures of one
 * payment arriving together cannot both look like the first of them.
 */
export async function ingestCaptures(
  database: Database,
  ws: WorkspaceContext,
  captures: readonly RawCapture[],
  opts: { today: string },
): Promise<IngestResult> {
  const scope = await getCaptureScope(database);
  const ordered = [...captures].sort((one, other) => (one.capturedAt < other.capturedAt ? -1 : one.capturedAt > other.capturedAt ? 1 : 0));
  const result: IngestResult = { drafts: 0, merged: 0, skipped: 0 };

  await database.transaction(async (tx) => {
    for (const capture of ordered) {
      if (await alreadyRead(tx, `capture:${capture.id}`)) continue;

      const source = await sourceFor(tx, capture);
      const reading = readCapture(capture, WORDS, source.template);
      if (reading.skipped === 'promo') {
        await skip(tx, ws, 'promo', capture, reading);
        result.skipped += 1;
        continue;
      }
      if (scope === 'expenses-only' && reading.type.value !== 'spent') {
        await skip(tx, ws, 'expenses-only', capture, reading);
        result.skipped += 1;
        continue;
      }

      const plan = await planDraft(tx, ws, capture, source, reading, opts);
      const knows = await accountFor(tx, source);
      const match = await findMatch(tx, ws, {
        amountMinor: plan.draft.amountMinor,
        currency: plan.draft.currency,
        accountId: knows?.id ?? null,
        direction: directionOf(reading.type.value),
        at: capture.capturedAt,
      });

      if (match.kind === 'same-draft') {
        await mergeInto(tx, ws, match.draftId, { ...plan.draft, captureId: capture.id });
        result.merged += 1;
        continue;
      }
      if (match.kind === 'transfer-pair') {
        await makeTransferPair(tx, ws, match.draftId, { ...plan.draft, captureId: capture.id });
        result.merged += 1;
        continue;
      }
      // Already recorded from a capture: there is nothing left to ask, and the second sighting is not a new row.
      if (match.kind === 'recorded') {
        result.merged += 1;
        continue;
      }
      // A hand-entered transaction is only ever offered: the draft is made, and the screen asks about the link.
      await insertDraftRow(tx, plan.workspace, plan.draft, capture.capturedAt);
      result.drafts += 1;
    }
  });

  return result;
}

/**
 * Sweeps what is no longer worth keeping.
 *
 * A capture that was skipped is kept a week, because "Expenses only" and a promo filter are the owner's settings and
 * they change their mind; after that it is a liability. The pictures of drafts that have been dealt with are handed
 * back rather than deleted, because the bytes are the web layer's own photo storage, and this only knows their names.
 */
export async function purgeCaptures(database: Database, today: string): Promise<{ skipped: number; images: string[] }> {
  const cutoff = `${addDays(today, -SKIPPED_RETENTION_DAYS)}T00:00:00.000Z`;
  const imageCutoff = `${addDays(today, -IMAGE_RETENTION_DAYS)}T00:00:00.000Z`;
  return database.transaction(async (tx) => {
    const stale = await tx
      .select({ id: captureSkipped.id })
      .from(captureSkipped)
      .where(lt(captureSkipped.skippedAt, cutoff));
    if (stale.length > 0) {
      await tx.delete(captureSkipped).where(inArray(captureSkipped.id, stale.map((row) => row.id)));
    }
    const done = await tx
      .select({ imageFile: draftTransactions.imageFile })
      .from(draftTransactions)
      .where(
        and(
          ne(draftTransactions.status, 'pending'),
          isNotNull(draftTransactions.imageFile),
          isNotNull(draftTransactions.resolvedAt),
          lte(draftTransactions.resolvedAt, imageCutoff),
        ),
      );
    return { skipped: stale.length, images: done.flatMap((row) => (row.imageFile ? [row.imageFile] : [])) };
  });
}
