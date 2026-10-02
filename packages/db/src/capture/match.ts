/**
 * The matcher: what one arriving capture turns out to be, once the queue and the ledger are looked at.
 *
 * A capture is not a fact yet. The same payment is often seen twice — a notification and the screenshot of it — and
 * one movement is often seen from both sides, as money leaving one account and arriving in another. Matching is what
 * keeps the queue a list of things that happened rather than a list of things that were noticed, and every match is
 * reversible: a merged draft can be split again, because the owner is the one who knows.
 *
 * Nothing here reads a screen or the network, and nothing here writes a transaction: a match decides what to show and
 * how many rows to show it in, and the ledger is still only reached by confirming a draft.
 */
import { capturedDayOf } from '@expanses/core';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { draftTransactions } from '../schema-drafts';
import { captureIdsOf, DraftError, insertDraftRow, type NewDraft, readingOf } from '../repos/drafts';

/** The same payment, seen twice: close enough in time that it cannot be two payments. */
const SAME_PAYMENT_MINUTES = 15;
/** One movement seen from both sides: money leaves one account and lands in another within a day. */
const TRANSFER_MINUTES = 24 * 60;

/** One arriving capture, as the reader left it: what it says, and when the phone noticed it. */
export interface Candidate {
  /** Positive is money out of `accountId`, the convention every draft keeps. */
  amountMinor: number;
  currency: string;
  accountId: string | null;
  direction: 'out' | 'in';
  /** When the phone noticed it: ISO 8601, as `RawCapture.capturedAt` carries it. */
  at: string;
}

/**
 * A capture on its way into the queue: the draft it would become, the capture it was read from, and when the phone
 * noticed it — which is what its own row is stamped with, so a later question about time asks about the capture and
 * not about when it was filed.
 */
export type Incoming = NewDraft & { captureId: string; capturedAt?: string };

export type MatchResult =
  /** The same payment as this draft, which is waiting: keep its captures together instead of asking twice. */
  | { kind: 'same-draft'; draftId: string }
  /** The same payment as something already recorded from a capture: there is nothing left to ask. */
  | { kind: 'recorded'; transactionId: string; draftId: string | null }
  /** One movement, seen from both sides: the two captures are one transfer between two of the owner's accounts. */
  | { kind: 'transfer-pair'; draftId: string }
  /** Looks like something the owner typed in: offered as Link or Keep separate, never merged on its own. */
  | { kind: 'hand-entered'; transactionId: string }
  | { kind: 'none' };

/** How far apart two moments are, in minutes. A moment that cannot be read is never close enough. */
function minutesApart(one: string, other: string): number {
  const first = Date.parse(one);
  const second = Date.parse(other);
  if (Number.isNaN(first) || Number.isNaN(second)) return Number.POSITIVE_INFINITY;
  return Math.abs(first - second) / 60_000;
}

/** Which way a draft's money goes, read off its own columns. */
type Side = 'out' | 'in' | 'both';

/**
 * The side of the money a draft is about.
 *
 * A transfer knows both of its accounts once it is a pair; a top-up draft knows only where the money landed, which is
 * the side it arrived from. A row that knows neither side (a transfer nobody has answered for) could be either.
 */
function sideOf(row: { kind: string; accountId: string | null; toAccountId: string | null }): Side {
  if (row.kind === 'expense') return 'out';
  if (row.kind === 'income') return 'in';
  if (row.accountId !== null && row.toAccountId !== null) return 'both';
  if (row.accountId !== null) return 'out';
  if (row.toAccountId !== null) return 'in';
  return 'both';
}

/**
 * The account a draft's money moved on its own side: the one it left, or the one it landed in.
 *
 * Money received names its account in `accountId`, like spending does; only a top-up — a transfer that knows where
 * it landed and not where it came from — names it in `toAccountId`.
 */
function sideAccount(row: { kind: string; accountId: string | null; toAccountId: string | null }): string | null {
  if (row.kind === 'transfer') return sideOf(row) === 'out' ? row.accountId : row.toAccountId;
  return row.accountId;
}

/**
 * Whether a draft is about the same account as the capture.
 *
 * A side that does not name an account is not a reason to ask the owner twice about the same coffee; a row that does
 * name one has to recognise it.
 */
function touches(row: { accountId: string | null; toAccountId: string | null }, capture: Candidate): boolean {
  if (capture.accountId === null) return true;
  const known = [row.accountId, row.toAccountId].filter((id): id is string => id !== null);
  return known.length === 0 || known.includes(capture.accountId);
}

/**
 * Looks for what a capture repeats: the payment it is a second sighting of, the other half of a movement, or
 * something the owner already typed in.
 *
 * The order matters only in that a draft waiting in the queue is the strongest answer — a second sighting of a
 * payment nobody has dealt with yet belongs with the first — and that a hand-entered transaction is the weakest,
 * because it is a guess about the owner's own typing and never merges anything.
 */
export async function findMatch(tx: Db, ws: WorkspaceContext, capture: Candidate): Promise<MatchResult> {
  const amount = Math.abs(capture.amountMinor);
  if (amount === 0) return { kind: 'none' };

  /** The accounts this workspace holds, read once for the pair rule that both sides have to be the owner's. */
  let own: Set<string> | undefined;
  const owns = async (accountId: string): Promise<boolean> => {
    own ??= new Set(
      (await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId))).map(
        (row) => row.id,
      ),
    );
    return own.has(accountId);
  };

  const waiting = await tx
    .select()
    .from(draftTransactions)
    .where(
      and(
        eq(draftTransactions.workspaceId, ws.workspaceId),
        eq(draftTransactions.status, 'pending'),
        isNull(draftTransactions.mergedInto),
        eq(draftTransactions.currency, capture.currency),
      ),
    )
    .orderBy(desc(draftTransactions.createdAt));

  // Seen twice: the notification and the screenshot of it.
  for (const row of waiting) {
    if (Math.abs(row.amountMinor) !== amount) continue;
    const side = sideOf(row);
    if (side !== 'both' && side !== capture.direction) continue;
    if (!touches(row, capture)) continue;
    if (minutesApart(row.createdAt, capture.at) > SAME_PAYMENT_MINUTES) continue;
    return { kind: 'same-draft', draftId: row.id };
  }

  // One movement, seen from both sides: out of one of the owner's accounts and into another.
  if (capture.accountId !== null) {
    for (const row of waiting) {
      const side = sideOf(row);
      // The two sightings have to be of the two sides of the movement, and a pair already has both.
      if (side === 'both' || side === capture.direction) continue;
      const rowAccount = sideAccount(row);
      if (rowAccount === null || rowAccount === capture.accountId) continue;
      if (Math.abs(row.amountMinor) !== amount) continue;
      // The two sightings have to be of opposite directions, or it is the same payment read twice.
      if (row.amountMinor >= 0 === capture.amountMinor >= 0) continue;
      if (minutesApart(row.createdAt, capture.at) > TRANSFER_MINUTES) continue;
      if (!(await owns(rowAccount)) || !(await owns(capture.accountId))) continue;
      return { kind: 'transfer-pair', draftId: row.id };
    }
  }

  /* Already recorded from a capture: a second copy of a payment that has been dealt with is not a new thing to do.
     It is dropped without a trace, so the rule is strict: the account has to be known and the same, and the capture
     has to be close to when that payment was *captured* — not to when the owner got round to recording it, or the
     second coffee bought just after the first was recorded would vanish. */
  if (capture.accountId !== null) {
    const recorded = await tx
      .select()
      .from(draftTransactions)
      .where(
        and(
          eq(draftTransactions.workspaceId, ws.workspaceId),
          eq(draftTransactions.status, 'confirmed'),
          eq(draftTransactions.currency, capture.currency),
          isNull(draftTransactions.mergedInto),
          isNotNull(draftTransactions.captureIds),
        ),
      )
      .orderBy(desc(draftTransactions.resolvedAt));
    for (const row of recorded) {
      if (row.transactionId === null) continue;
      if (Math.abs(row.amountMinor) !== amount) continue;
      const side = sideOf(row);
      if (side !== 'both' && side !== capture.direction) continue;
      if (row.accountId !== capture.accountId && row.toAccountId !== capture.accountId) continue;
      // Every sighting it was made of: its own row, and the rows of the captures folded into it.
      const sightings = await tx
        .select({ createdAt: draftTransactions.createdAt })
        .from(draftTransactions)
        .where(eq(draftTransactions.mergedInto, row.id));
      const times = [row.createdAt, ...sightings.map((sighting) => sighting.createdAt)];
      if (!times.some((time) => minutesApart(time, capture.at) <= SAME_PAYMENT_MINUTES)) continue;
      return { kind: 'recorded', transactionId: row.transactionId, draftId: row.id };
    }
  }

  // Already typed in: the same figure, out of the same account, on the same day. Offered, never merged.
  if (capture.accountId !== null) {
    const [typed] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .innerJoin(entries, eq(entries.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.workspaceId, ws.workspaceId),
          eq(transactions.status, 'posted'),
          eq(transactions.source, 'manual'),
          // The day where the owner was, as the capture was stamped: not the UTC day.
          eq(transactions.occurredOn, capturedDayOf(capture.at)),
          eq(entries.accountId, capture.accountId),
          eq(entries.amountMinor, capture.direction === 'out' ? -amount : amount),
          // One a capture already posted is a record, not a guess about the owner's typing.
          sql`not exists (select 1 from ${draftTransactions} where ${draftTransactions.transactionId} = ${transactions.id})`,
        ),
      )
      .limit(1);
    if (typed) return { kind: 'hand-entered', transactionId: typed.id };
  }

  return { kind: 'none' };
}

/** The row one capture becomes: the draft it would have been, plus its own capture id. */
function rowOf(incoming: Incoming): NewDraft {
  const captures = [...(incoming.captureIds ?? [])];
  if (!captures.includes(incoming.captureId)) captures.push(incoming.captureId);
  return {
    ...incoming,
    // A capture whose reading said nothing about direction still says it with its sign: negative is money arriving.
    kind: incoming.kind ?? (incoming.amountMinor < 0 ? 'income' : 'expense'),
    captureIds: captures,
  };
}

/** The draft a merge is folded into, refused unless it is the row waiting in the queue. */
async function waitingDraft(tx: Db, ws: WorkspaceContext, id: string) {
  const [row] = await tx
    .select()
    .from(draftTransactions)
    .where(
      and(
        eq(draftTransactions.workspaceId, ws.workspaceId),
        eq(draftTransactions.id, id),
        eq(draftTransactions.status, 'pending'),
        isNull(draftTransactions.mergedInto),
      ),
    );
  if (!row) throw new DraftError('NOT_FOUND', 'That draft is not waiting in this workspace');
  return row;
}

/** What a second sighting adds to the row already waiting: the captures it came in on, and whatever it knew. */
function toppedUp(
  row: { accountId: string | null; categoryAccountId: string | null; cardId: string | null; sourceId: string | null; imageFile: string | null; readingJson: string | null; confidence: number | null; description: string },
  incoming: Incoming,
) {
  return {
    accountId: row.accountId ?? incoming.accountId ?? null,
    categoryAccountId: row.categoryAccountId ?? incoming.categoryAccountId ?? null,
    cardId: row.cardId ?? incoming.cardId ?? null,
    sourceId: row.sourceId ?? incoming.sourceId ?? null,
    // The first picture is the one kept: a merge must not replace a receipt with a poorer screenshot of it.
    imageFile: row.imageFile ?? incoming.imageFile ?? null,
    readingJson: row.readingJson ?? (incoming.reading ? JSON.stringify(incoming.reading) : null),
    confidence: row.confidence ?? incoming.confidence ?? null,
    description: row.description.trim() === '' ? incoming.description : row.description,
  };
}

/**
 * Folds a second sighting of one payment into the draft already waiting for it.
 *
 * The arriving capture keeps its own row — hidden, pointing at the draft it is part of — so that Unmerge has
 * something real to bring back: its own reading, its own picture and its own id.
 */
export async function mergeInto(tx: Db, ws: WorkspaceContext, targetDraftId: string, incoming: Incoming): Promise<void> {
  const row = await waitingDraft(tx, ws, targetDraftId);
  const now = new Date().toISOString();
  const captures = captureIdsOf(row.captureIds);
  if (!captures.includes(incoming.captureId)) captures.push(incoming.captureId);

  await tx
    .update(draftTransactions)
    .set({ ...toppedUp(row, incoming), captureIds: JSON.stringify(captures) })
    .where(eq(draftTransactions.id, targetDraftId));
  await insertDraftRow(tx, ws, { ...rowOf(incoming), mergedInto: targetDraftId }, incoming.capturedAt ?? now);
}

/**
 * Makes one transfer out of the two halves of one movement: money out of one account and into another.
 *
 * The waiting draft becomes the transfer, because it is the row the owner is already looking at; the arriving half
 * keeps its own hidden row, so undoing the pair gives both sides back rather than inventing one.
 */
export async function makeTransferPair(
  tx: Db,
  ws: WorkspaceContext,
  existingDraftId: string,
  incoming: Incoming,
): Promise<void> {
  const row = await waitingDraft(tx, ws, existingDraftId);
  const side = sideOf(row);
  const rowAccount = sideAccount(row);
  // A top-up draft names where the money landed, not where it left: its own side is the destination.
  const incomingAccount = incoming.accountId ?? incoming.toAccountId ?? null;
  if (side === 'both' || rowAccount === null || incomingAccount === null || rowAccount === incomingAccount) {
    throw new DraftError('NOT_A_PAIR', 'A transfer joins two different accounts of your own');
  }
  // The sign says which half arrived: positive is money out of the account it names.
  const arrivingIsOut = incoming.amountMinor >= 0;
  const amountMinor = Math.abs(row.amountMinor) || Math.abs(incoming.amountMinor);
  const captures = captureIdsOf(row.captureIds);
  if (!captures.includes(incoming.captureId)) captures.push(incoming.captureId);
  const now = new Date().toISOString();

  await tx
    .update(draftTransactions)
    .set({
      ...toppedUp(row, incoming),
      kind: 'transfer',
      accountId: arrivingIsOut ? incomingAccount : rowAccount,
      toAccountId: arrivingIsOut ? rowAccount : incomingAccount,
      // The row keeps the draft convention: the figure is positive because it left the account it names.
      amountMinor,
      captureIds: JSON.stringify(captures),
    })
    .where(eq(draftTransactions.id, existingDraftId));
  await insertDraftRow(tx, ws, { ...rowOf(incoming), mergedInto: existingDraftId }, incoming.capturedAt ?? now);
}

/** Which way a reading said the money went: a payment out, or anything that arrived. */
function directionOfReading(json: string | null): 'out' | 'in' | null {
  const type = readingOf(json)?.type?.value;
  if (type === undefined) return null;
  return type === 'spent' ? 'out' : 'in';
}

/**
 * Undoes a merge.
 *
 * A payment seen twice gives back the capture that arrived last, with its own capture id and its own picture.
 *
 * A transfer made of two sides gives back the two sides, each as its own capture read it — whichever arrived first.
 * The other side's row comes back exactly as it was kept (a top-up is a top-up again, money received is money
 * received), and the row the owner was looking at goes back to what its own reading said, keeping any sighting of
 * its own side folded in.
 */
export async function unmerge(database: Database, ws: WorkspaceContext, draftId: string): Promise<string> {
  return database.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(draftTransactions)
      .where(and(eq(draftTransactions.workspaceId, ws.workspaceId), eq(draftTransactions.id, draftId)));
    if (!draft) throw new DraftError('NOT_FOUND', 'That draft is not in this workspace');
    const captures = captureIdsOf(draft.captureIds);
    if (captures.length < 2) throw new DraftError('NOT_MERGED', 'That draft was read from one capture, so there is nothing to split');
    const amountMinor = Math.abs(draft.amountMinor);
    const now = new Date().toISOString();

    const hiddenRows = await tx
      .select()
      .from(draftTransactions)
      .where(
        and(
          eq(draftTransactions.workspaceId, ws.workspaceId),
          eq(draftTransactions.mergedInto, draftId),
          eq(draftTransactions.status, 'pending'),
        ),
      )
      .orderBy(draftTransactions.createdAt);

    if (draft.kind === 'transfer' && draft.accountId !== null && draft.toAccountId !== null && hiddenRows.length > 0) {
      const split = await splitPair(tx, draft, hiddenRows, amountMinor);
      if (split) return split;
    }

    const last = captures.at(-1)!;
    // The capture that arrived last is the one its own row was kept for: found by the capture, not by guessing at
    // which row was written first, because a batch drain writes rows in an order that is not the order they arrived.
    const split = hiddenRows.find((row) => captureIdsOf(row.captureIds).includes(last));

    // A merge from before this build left no row behind, so the capture's draft is written now, out of what the
    // survivor says. It is the same payment, so it is the same picture and the same reading.
    const splitId = split
      ? split.id
      : await insertDraftRow(
          tx,
          ws,
          {
            source: draft.source,
            occurredOn: draft.occurredOn,
            description: draft.description,
            amountMinor: draft.kind === 'transfer' || draft.kind === 'income' ? -amountMinor : amountMinor,
            currency: draft.currency,
            kind: draft.kind === 'transfer' ? 'income' : draft.kind,
            accountId: draft.kind === 'transfer' ? draft.toAccountId : draft.accountId,
            categoryAccountId: draft.categoryAccountId,
            cardId: draft.cardId,
            sourceId: draft.sourceId,
            imageFile: draft.imageFile,
            reading: readingOf(draft.readingJson),
            confidence: draft.confidence,
            captureIds: [last],
            externalRef: `capture:${last}`,
          },
          now,
        );

    if (split) {
      await tx
        .update(draftTransactions)
        .set({
          mergedInto: null,
          // A pair with no row of its own for the other side: the half that arrives last is taken as that side.
          ...(draft.kind === 'transfer'
            ? { kind: 'income' as const, accountId: draft.toAccountId, toAccountId: null, amountMinor: -amountMinor }
            : {}),
        })
        .where(eq(draftTransactions.id, split.id));
    }
    await tx
      .update(draftTransactions)
      .set({
        // One capture fewer: the row still holds the sighting it was made from.
        captureIds: JSON.stringify(captures.filter((id) => id !== last)),
        // The pair is a pair no longer: what is left is money out, and it has to be told what it bought again.
        ...(draft.kind === 'transfer' ? { kind: 'expense' as const, toAccountId: null, amountMinor } : {}),
      })
      .where(eq(draftTransactions.id, draftId));
    return splitId;
  });
}

type DraftRecord = typeof draftTransactions.$inferSelect;

/**
 * Splits a transfer back into its two sides, or returns null when the rows kept do not say which side is which.
 *
 * Which side the row the owner was looking at is on is read from the rows folded into it first: when every one of them
 * is on one side, the survivor was the other — that holds whatever order the two arrived in. Only when they disagree
 * (a sighting of the survivor's own side was folded in as well) does its own reading decide.
 */
async function splitPair(tx: Db, draft: DraftRecord, hiddenRows: readonly DraftRecord[], amountMinor: number): Promise<string | null> {
  const sides = new Set(hiddenRows.map((row) => sideOf(row)).filter((side): side is 'out' | 'in' => side !== 'both'));
  const read = directionOfReading(draft.readingJson);
  const own: 'out' | 'in' | null = sides.size === 1 ? (sides.has('out') ? 'in' : 'out') : read;
  if (own === null) return null;
  const other = hiddenRows.filter((row) => sideOf(row) !== own && sideOf(row) !== 'both');
  if (other.length === 0) return null;

  const [lead, ...rest] = other;
  const otherCaptures = other.flatMap((row) => captureIdsOf(row.captureIds));
  await tx
    .update(draftTransactions)
    .set({ mergedInto: null, captureIds: JSON.stringify(otherCaptures) })
    .where(eq(draftTransactions.id, lead!.id));
  if (rest.length > 0) {
    await tx
      .update(draftTransactions)
      .set({ mergedInto: lead!.id })
      .where(inArray(draftTransactions.id, rest.map((row) => row.id)));
  }

  // The survivor goes back to what its own capture said. Its reading is trusted only when it is about this side: a
  // row that never had a reading of its own may be carrying the other side's.
  const account = own === 'out' ? draft.accountId : draft.toAccountId;
  const type = read === own ? readingOf(draft.readingJson)?.type?.value : undefined;
  const restored =
    own === 'out'
      ? { kind: 'expense' as const, accountId: account, toAccountId: null, amountMinor }
      : type === 'topup'
        ? { kind: 'transfer' as const, accountId: null, toAccountId: account, amountMinor: -amountMinor }
        : { kind: 'income' as const, accountId: account, toAccountId: null, amountMinor: -amountMinor };
  await tx
    .update(draftTransactions)
    .set({
      ...restored,
      captureIds: JSON.stringify(captureIdsOf(draft.captureIds).filter((id) => !otherCaptures.includes(id))),
    })
    .where(eq(draftTransactions.id, draft.id));
  return lead!.id;
}
