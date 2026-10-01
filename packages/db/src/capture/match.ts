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
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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

/** A capture on its way into the queue: the draft it would become, and the capture it was read from. */
export type Incoming = NewDraft & { captureId: string };

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

/** Which way a draft's money went. A transfer touches two accounts, so it reads either way. */
function goesThatWay(kind: string, direction: 'out' | 'in'): boolean {
  return kind === 'transfer' || (kind === 'expense') === (direction === 'out');
}

/**
 * Whether a draft is about the same account as the capture.
 *
 * Either side not knowing is a match: a notification that names no account is not a reason to ask the owner twice
 * about the same coffee. A transfer is about both of its accounts.
 */
function touches(row: { accountId: string | null; toAccountId: string | null }, capture: Candidate): boolean {
  if (capture.accountId === null || row.accountId === null) return true;
  return row.accountId === capture.accountId || row.toAccountId === capture.accountId;
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
    if (!goesThatWay(row.kind, capture.direction)) continue;
    if (!touches(row, capture)) continue;
    if (minutesApart(row.createdAt, capture.at) > SAME_PAYMENT_MINUTES) continue;
    return { kind: 'same-draft', draftId: row.id };
  }

  // One movement, seen from both sides: out of one of the owner's accounts and into another.
  if (capture.accountId !== null) {
    for (const row of waiting) {
      if (row.kind === 'transfer') continue;
      if (row.accountId === null || row.accountId === capture.accountId) continue;
      if (Math.abs(row.amountMinor) !== amount) continue;
      // The two sightings have to be of opposite directions, or it is the same payment read twice.
      if (row.amountMinor >= 0 === capture.amountMinor >= 0) continue;
      if (minutesApart(row.createdAt, capture.at) > TRANSFER_MINUTES) continue;
      if (!(await owns(row.accountId)) || !(await owns(capture.accountId))) continue;
      return { kind: 'transfer-pair', draftId: row.id };
    }
  }

  // Already recorded from a capture: a second copy of a payment that has been dealt with is not a new thing to do.
  const recorded = await tx
    .select()
    .from(draftTransactions)
    .where(
      and(
        eq(draftTransactions.workspaceId, ws.workspaceId),
        eq(draftTransactions.status, 'confirmed'),
        eq(draftTransactions.currency, capture.currency),
      ),
    )
    .orderBy(desc(draftTransactions.resolvedAt));
  for (const row of recorded) {
    if (row.transactionId === null) continue;
    if (Math.abs(row.amountMinor) !== amount) continue;
    if (!goesThatWay(row.kind, capture.direction)) continue;
    if (!touches(row, capture)) continue;
    if (minutesApart(row.resolvedAt ?? row.createdAt, capture.at) > SAME_PAYMENT_MINUTES) continue;
    return { kind: 'recorded', transactionId: row.transactionId, draftId: row.id };
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
          eq(transactions.occurredOn, capture.at.slice(0, 10)),
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
  return {
    ...incoming,
    // A capture whose reading said nothing about direction still says it with its sign: negative is money arriving.
    kind: incoming.kind ?? (incoming.amountMinor < 0 ? 'income' : 'expense'),
    captureIds: [...(incoming.captureIds ?? []), incoming.captureId],
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
  await insertDraftRow(tx, ws, { ...rowOf(incoming), mergedInto: targetDraftId }, now);
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
  if (row.accountId === null || incoming.accountId === null || row.accountId === incoming.accountId) {
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
      accountId: arrivingIsOut ? incoming.accountId : row.accountId,
      toAccountId: arrivingIsOut ? row.accountId : incoming.accountId,
      // The row keeps the draft convention: the figure is positive because it left the account it names.
      amountMinor,
      captureIds: JSON.stringify(captures),
    })
    .where(eq(draftTransactions.id, existingDraftId));
  await insertDraftRow(tx, ws, { ...rowOf(incoming), mergedInto: existingDraftId }, now);
}

/**
 * Splits the capture that arrived last back into a draft of its own, undoing a merge.
 *
 * The queue shows the movement rather than the sightings, so what comes back is the half that arrived last, with
 * its own capture id and its own picture. A pair goes back to being an expense and money received, which is what
 * the two captures were before they were recognised as one movement.
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
    const last = captures.at(-1)!;
    const amountMinor = Math.abs(draft.amountMinor);
    const now = new Date().toISOString();

    const [split] = await tx
      .select()
      .from(draftTransactions)
      .where(
        and(
          eq(draftTransactions.workspaceId, ws.workspaceId),
          eq(draftTransactions.mergedInto, draftId),
          eq(draftTransactions.status, 'pending'),
        ),
      )
      .orderBy(desc(draftTransactions.createdAt));

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
          // The half that arrives last is the other side of the pair, whatever it was holding on to.
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
        captureIds: JSON.stringify(captures.slice(0, -1)),
        // The pair is a pair no longer: what is left is money out, and it has to be told what it bought again.
        ...(draft.kind === 'transfer' ? { kind: 'expense' as const, toAccountId: null, amountMinor } : {}),
      })
      .where(eq(draftTransactions.id, draftId));
    return splitId;
  });
}
