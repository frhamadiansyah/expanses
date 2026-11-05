/**
 * Reading again what an earlier reader could make nothing of.
 *
 * A message whose figure the reader did not know — a purchase abroad, in a currency it had no mark for — was still
 * queued, at 0, with its words kept: the draft waits for the owner to type what the message already says. Once the
 * reader can read it, the draft is read again where it stands, rather than left for the owner to copy out by hand.
 *
 * It fills what the first reading left empty and nothing else. The figure is taken only where it is still the
 * reader's own zero: a draft with any figure, or one whose first reading did find a figure (so the zero is the
 * owner's), is not touched. The note and the day are taken only while they are still what the queue put there for
 * want of a reading. The account, the category and everything else stay as they are.
 */
import { capturedDayOf, type RawCapture, readCapture, WORDS } from '@expanses/core';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { type DraftEdit, editDraftTx } from '../repos/drafts';
import { workspaces } from '../schema';
import { draftTransactions } from '../schema-drafts';
import { planDraft } from './ingest';
import { storedReadingOf } from './learn';
import { type CaptureSource, sourceById } from './sources';

type Row = typeof draftTransactions.$inferSelect;

/**
 * The capture a waiting message was, as far as its draft still says: its words in one piece. The reader joins a
 * title and a body before it cuts them into sentences, so the two kept as one read as they did apart.
 */
function captureOf(row: Row): RawCapture {
  return {
    id: row.externalRef?.startsWith('capture:') ? row.externalRef.slice('capture:'.length) : row.id,
    kind: 'notification',
    // A captured draft is stamped with when the phone noticed it.
    capturedAt: row.createdAt,
    app: null,
    title: null,
    body: row.rawPayload,
    lines: [],
    imageFile: null,
  };
}

/**
 * Whether the note is still the one the queue gives a message that named nobody: its heading, the source's name, or
 * the plain words. Anything else was typed, and stays.
 */
function noteIsDefault(row: Row, source: CaptureSource): boolean {
  const heading = row.rawPayload?.split('\n')[0]?.trim() ?? '';
  return [heading, source.label.trim(), 'Captured payment'].filter((text) => text !== '').includes(row.description.trim());
}

/** What reading one waiting draft again changes on it, or null when it is left as it is. */
async function rereadOne(tx: Db, row: Row, today: string): Promise<{ ws: WorkspaceContext; edit: DraftEdit; readingJson: string; confidence: number | null } | null> {
  const before = storedReadingOf(row.readingJson);
  // A figure was read the first time, so this zero was put there by hand; and with no reading kept there is no
  // telling whose zero it is.
  if (!before || before.amount !== null || !row.sourceId) return null;
  const source = await sourceById(tx, row.sourceId);
  if (!source) return null;
  const [home] = await tx.select({ id: workspaces.id, baseCurrency: workspaces.baseCurrency }).from(workspaces).where(eq(workspaces.id, row.workspaceId));
  if (!home) return null;

  const capture = captureOf(row);
  const reading = readCapture(capture, WORDS, source.template, { offers: source.readOffers ? 'transactions' : 'skip' });
  if (reading.skipped === 'promo' || reading.amount === null) return null;
  // The draft the message would be queued as today, by the queue's own rules: what is taken from it is chosen below.
  const ws: WorkspaceContext = { workspaceId: home.id, baseCurrency: home.baseCurrency };
  const { draft } = await planDraft(tx, ws, capture, source, reading, { today });
  // Read as another kind of money than the draft is (received, or a top-up), it is another draft: its sides and its
  // sign would all change, and that is the owner's to say.
  if (draft.amountMinor === 0 || (draft.kind ?? 'expense') !== row.kind) return null;
  // A figure that wore no currency was scaled by the account the queue would file it on, which may not be this one.
  if (reading.amount.value.currency === null && (draft.accountId ?? null) !== row.accountId) return null;

  const edit: DraftEdit = { amountMinor: draft.amountMinor, currency: draft.currency, exactHundredths: draft.exactHundredths ?? null };
  if (before.name === null && reading.name && noteIsDefault(row, source)) edit.description = draft.description;
  if (before.occurredAt === null && reading.occurredAt && row.occurredOn === capturedDayOf(row.createdAt)) edit.occurredOn = draft.occurredOn;
  return { ws, edit, readingJson: JSON.stringify(draft.reading ?? reading), confidence: draft.confidence ?? null };
}

/**
 * Reads again every message still waiting at 0 with its words kept, in every workspace on this device, and returns
 * how many drafts now have their figure.
 *
 * Safe to run on every drain: a draft that gets a figure is no longer one of these, and a message that still says
 * nothing is left exactly as it was.
 */
export async function rereadUnreadDrafts(database: Database, opts: { today: string }): Promise<number> {
  return database.transaction(async (tx) => {
    const waiting = await tx
      .select()
      .from(draftTransactions)
      .where(
        and(
          eq(draftTransactions.status, 'pending'),
          eq(draftTransactions.source, 'notification'),
          eq(draftTransactions.amountMinor, 0),
          isNotNull(draftTransactions.rawPayload),
          isNull(draftTransactions.mergedInto),
        ),
      );
    let filled = 0;
    for (const row of waiting) {
      const found = await rereadOne(tx, row, opts.today);
      if (!found) continue;
      await editDraftTx(tx, found.ws, row.id, found.edit);
      // The reading goes with the figure it gave: the queue asks to check an amount by how sure the reader was of it.
      await tx.update(draftTransactions).set({ readingJson: found.readingJson, confidence: found.confidence }).where(eq(draftTransactions.id, row.id));
      filled += 1;
    }
    return filled;
  });
}
