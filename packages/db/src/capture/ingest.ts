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
import { capturedDayOf, exponentOf, namesCard, readCapture, type RawCapture, type Reading, uuidv7, WORDS } from '@expanses/core';
import { and, eq, inArray, isNotNull, isNull, like, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { insertDraftRow, type NewDraft } from '../repos/drafts';
import { accounts, transactions, workspaces } from '../schema';
import { cards } from '../schema-cards';
import { captureSettings, captureSkipped } from '../schema-capture';
import { draftTransactions } from '../schema-drafts';
import { readingWithLines, storedReadingOf } from './learn';
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

/**
 * The account of the card the capture says paid, when exactly one card in the workspace ends in those digits.
 *
 * A wallet screen paid by card ("Payment Method  Credit Card (6175)") is money out of the card, whatever the wallet's
 * source learned. Four digits repeat across banks, so two cards ending alike — or none — is no answer, and the
 * source's own account stands.
 */
async function cardAccountFor(tx: Db, workspaceId: string, last4: string | null | undefined): Promise<{ id: string; currency: string | null } | null> {
  if (!last4) return null;
  const rows = await tx
    .select({ id: accounts.id, currency: accounts.currency })
    .from(cards)
    .innerJoin(accounts, eq(accounts.id, cards.accountId))
    .where(and(eq(cards.workspaceId, workspaceId), eq(cards.last4, last4), isNull(cards.archivedAt), isNull(accounts.archivedAt)));
  return rows.length === 1 ? rows[0]! : null;
}

/**
 * The note a draft starts with.
 *
 * A payment a card made through an app — a wallet's checkout paid by credit card — is noted as the app, then the
 * merchant: "KANTONG Lazada Indonesia", because the card statement will say the app, not the shop. The app is the
 * source's label, which the owner can rename. Anything else — the wallet's own balance, a transfer, a capture that
 * names no payment method — is the merchant alone, as it always was. A merchant that already starts with the app's
 * name is not given it twice; with no merchant, the note is what the capture says first.
 */
function descriptionOf(capture: RawCapture, source: CaptureSource, reading: Reading, paidByCard: boolean): string {
  const merchant = reading.name?.value?.trim();
  const app = source.label.trim();
  if (merchant && app && paidByCard) return merchant.toLowerCase().startsWith(app.toLowerCase()) ? merchant : `${app} ${merchant}`;
  // A picture that read no name still says what it is on its first line.
  return merchant || capture.title?.trim() || capture.lines[0]?.text.trim() || 'Captured payment';
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
  const learned = await accountFor(tx, source);
  const card = await cardAccountFor(tx, workspace.workspaceId, reading.paymentMethod?.last4);
  // The card that paid outranks what the source learned; a top-up paid by card is the card's money going in.
  const account = card ?? learned;
  const method = reading.paymentMethod ?? null;
  const paidByCard = card !== null || (method !== null && namesCard(method.text, WORDS));
  const type = reading.type.value;
  const currency = reading.amount?.value.currency ?? account?.currency ?? workspace.baseCurrency;
  // A figure that wore no currency was read in whole units; the account (or the workspace) says how to scale it.
  const read = reading.amount?.value ?? null;
  const amountMinor = read === null ? 0 : read.currency === null ? read.minor * 10 ** exponentOf(currency) : read.minor;
  const printed = reading.occurredAt?.value ?? null;

  return {
    workspace,
    draft: {
      source: capture.kind === 'notification' ? 'notification' : capture.kind === 'screen' ? 'screen' : 'photo',
      kind: type === 'topup' ? 'transfer' : type === 'spent' ? 'expense' : 'income',
      // The day where the owner was, from the offset the capture was stamped with — never the UTC day.
      occurredOn: printed?.slice(0, 10) || capturedDayOf(capture.capturedAt) || opts.today,
      description: descriptionOf(capture, source, reading, paidByCard),
      // Leaving is positive, arriving is negative: the one convention every other draft already keeps.
      amountMinor: directionOf(type) === 'out' ? amountMinor : -amountMinor,
      currency,
      accountId: type === 'topup' ? (card?.id ?? null) : (account?.id ?? null),
      toAccountId: type === 'topup' ? (learned?.id ?? null) : null,
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
  if (posted) return true;
  // A skipped capture is read too: the phone hands it over again if the app stopped before acknowledging it.
  const [skipped] = await tx
    .select({ id: captureSkipped.id })
    .from(captureSkipped)
    .where(sql`json_extract(${captureSkipped.captureJson}, '$.id') = ${ref.slice('capture:'.length)}`)
    .limit(1);
  return skipped !== undefined;
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
  /**
   * The picture files of captures in this batch that nothing keeps — dropped as already recorded, or already read
   * under another file — so the caller can delete the bytes. A file a draft or a skipped capture still points at is
   * never listed: a skipped capture keeps its picture for the week it can be brought back.
   */
  discardedImages: string[];
}

/** Of these picture files, the ones no draft and no skipped capture points at any more. */
async function unreferenced(tx: Db, files: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(files)];
  if (wanted.length === 0) return [];
  const drafts = await tx
    .select({ imageFile: draftTransactions.imageFile })
    .from(draftTransactions)
    .where(inArray(draftTransactions.imageFile, wanted));
  const held = new Set(drafts.flatMap((row) => (row.imageFile ? [row.imageFile] : [])));
  const skipped = await tx.select({ captureJson: captureSkipped.captureJson }).from(captureSkipped);
  for (const row of skipped) {
    const file = imageOfCaptureJson(row.captureJson);
    if (file) held.add(file);
  }
  return wanted.filter((file) => !held.has(file));
}

/** The picture a kept capture points at, if it kept one. */
function imageOfCaptureJson(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { imageFile?: unknown };
    return typeof parsed.imageFile === 'string' && parsed.imageFile !== '' ? parsed.imageFile : null;
  } catch {
    return null;
  }
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
  const result: IngestResult = { drafts: 0, merged: 0, skipped: 0, discardedImages: [] };

  await database.transaction(async (tx) => {
    /** Pictures of captures that made no row of their own; checked against what still points at them at the end. */
    const dropped: string[] = [];
    for (const capture of ordered) {
      if (await alreadyRead(tx, `capture:${capture.id}`)) {
        if (capture.imageFile) dropped.push(capture.imageFile);
        continue;
      }

      const source = await sourceFor(tx, capture);
      // Everything about this capture happens in the workspace its source files into: where its draft goes is where
      // its duplicates are looked for, and where a skipped copy is kept.
      const home = await workspaceFor(tx, ws, source);
      const reading = readCapture(capture, WORDS, source.template);
      if (reading.skipped === 'promo') {
        await skip(tx, home, 'promo', capture, reading);
        result.skipped += 1;
        continue;
      }
      if (scope === 'expenses-only' && reading.type.value !== 'spent') {
        await skip(tx, home, 'expenses-only', capture, reading);
        result.skipped += 1;
        continue;
      }

      const plan = await planDraft(tx, ws, capture, source, reading, opts);
      const match = await findMatch(tx, plan.workspace, {
        amountMinor: plan.draft.amountMinor,
        currency: plan.draft.currency,
        // The account this capture is about: where a top-up landed, or the account (or card) the money left.
        accountId: (reading.type.value === 'topup' ? plan.draft.toAccountId : plan.draft.accountId) ?? null,
        direction: directionOf(reading.type.value),
        at: capture.capturedAt,
      });

      const incoming = { ...plan.draft, captureId: capture.id, capturedAt: capture.capturedAt };
      if (match.kind === 'same-draft') {
        await mergeInto(tx, plan.workspace, match.draftId, incoming);
        result.merged += 1;
        continue;
      }
      if (match.kind === 'transfer-pair') {
        await makeTransferPair(tx, plan.workspace, match.draftId, incoming);
        result.merged += 1;
        continue;
      }
      // Already recorded from a capture: there is nothing left to ask, and the second sighting is not a new row.
      if (match.kind === 'recorded') {
        if (capture.imageFile) dropped.push(capture.imageFile);
        result.merged += 1;
        continue;
      }
      // A hand-entered transaction is only ever offered: the draft is made, and the screen asks about the link.
      await insertDraftRow(tx, plan.workspace, plan.draft, capture.capturedAt);
      result.drafts += 1;
    }
    result.discardedImages = await unreferenced(tx, dropped);
  });

  return result;
}

/**
 * Sweeps what is no longer worth keeping, and hands back the picture files nothing points at any more.
 *
 * A capture that was skipped is kept a week, because "Expenses only" and a promo filter are the owner's settings and
 * they change their mind; after that it goes, picture and all. A draft that has been dealt with keeps what it was
 * read from for the same week — long enough for Undo to bring it back whole — and then lets go of its picture, the
 * lines read off it and the capture's own words, in every row of it, the sightings folded into it included. What the
 * draft says (the amount, the name, what it became) stays.
 *
 * The bytes are the web layer's own storage, so this only knows their names: each name is handed back once, and only
 * when no other row still points at it.
 */
export async function purgeCaptures(database: Database, today: string): Promise<{ skipped: number; images: string[] }> {
  const cutoff = `${addDays(today, -SKIPPED_RETENTION_DAYS)}T00:00:00.000Z`;
  const imageCutoff = `${addDays(today, -IMAGE_RETENTION_DAYS)}T00:00:00.000Z`;
  return database.transaction(async (tx) => {
    const released: string[] = [];
    const stale = await tx
      .select({ id: captureSkipped.id, captureJson: captureSkipped.captureJson })
      .from(captureSkipped)
      .where(lt(captureSkipped.skippedAt, cutoff));
    if (stale.length > 0) {
      await tx.delete(captureSkipped).where(inArray(captureSkipped.id, stale.map((row) => row.id)));
      for (const row of stale) {
        const file = imageOfCaptureJson(row.captureJson);
        if (file) released.push(file);
      }
    }

    const done = await tx
      .select()
      .from(draftTransactions)
      .where(
        and(
          ne(draftTransactions.status, 'pending'),
          isNotNull(draftTransactions.resolvedAt),
          lte(draftTransactions.resolvedAt, imageCutoff),
          or(
            isNotNull(draftTransactions.imageFile),
            like(draftTransactions.readingJson, '%"lines"%'),
            and(isNotNull(draftTransactions.rawPayload), inArray(draftTransactions.source, CAPTURED_SOURCES)),
          ),
        ),
      );
    for (const row of done) {
      if (row.imageFile) released.push(row.imageFile);
      const reading = storedReadingOf(row.readingJson);
      let readingJson = row.readingJson;
      if (reading && reading.lines) {
        const { lines: _lines, ...rest } = reading;
        readingJson = JSON.stringify(rest);
      }
      await tx
        .update(draftTransactions)
        .set({
          imageFile: null,
          readingJson,
          // What a phone captured is deleted with the resolution; an imported statement keeps its own longer date.
          ...((CAPTURED_SOURCES as readonly string[]).includes(row.source) ? { rawPayload: null } : {}),
        })
        .where(eq(draftTransactions.id, row.id));
    }
    return { skipped: stale.length, images: await unreferenced(tx, released) };
  });
}

/** The draft sources a phone captures on: what they were read from is the owner's alone, and is kept only a week. */
const CAPTURED_SOURCES = ['notification', 'screen', 'photo'] as const;

/**
 * Everything capture leaves behind, swept in one call: skipped captures and resolved drafts' pictures, lines and words
 * after their week, and every draft's verbatim payload past its keeping date, in every workspace on this device.
 *
 * Returns the picture files no row points at any more, for the caller to delete.
 */
export async function purgeCaptureLeftovers(
  database: Database,
  today: string,
): Promise<{ images: string[]; skipped: number; payloads: number }> {
  const swept = await purgeCaptures(database, today);
  const expired = await database.db
    .select({ id: draftTransactions.id })
    .from(draftTransactions)
    .where(and(isNotNull(draftTransactions.rawPayload), isNotNull(draftTransactions.rawPurgeAfter), lte(draftTransactions.rawPurgeAfter, today)));
  if (expired.length > 0) {
    await database.db
      .update(draftTransactions)
      .set({ rawPayload: null })
      .where(inArray(draftTransactions.id, expired.map((row) => row.id)));
  }
  return { images: swept.images, skipped: swept.skipped, payloads: expired.length };
}
