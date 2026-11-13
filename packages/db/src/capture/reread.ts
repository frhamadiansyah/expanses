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
 *
 * A message an earlier reader took for money in that the reader now reads as spent (a card email whose "Kartu Kredit"
 * was hidden by a no-break space) is turned round the same way: only while the draft is still the reader's income —
 * its kind and its sign what that reading gave — and never once the owner has said otherwise.
 */
import { capturedDayOf, type RawCapture, wholeFromHundredths } from '@expanses/core';
import { and, eq, inArray, isNotNull, isNull, like, lt, or, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { type DraftEdit, editDraftTx } from '../repos/drafts';
import { capturedCategoryFromHistory } from '../repos/entry';
import { draftExactExists } from '../repos/exact-column';
import { accounts, workspaces } from '../schema';
import { captureSettings, captureSources } from '../schema-capture';
import { draftTransactions } from '../schema-drafts';
import { planDraft } from './ingest';
import { storedReadingOf } from './learn';
import { type CaptureSource, isCardEmailSender, readFromSource, sourceById } from './sources';

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
  const reading = readFromSource(capture, source, source.readOffers ? 'transactions' : 'skip');
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

/** What turning one draft read as money in round to spending changes on it, or null when it is left as it is. */
async function rereadDirectionOne(
  tx: Db,
  row: Row,
  today: string,
): Promise<{ ws: WorkspaceContext; edit: DraftEdit; readingJson: string; confidence: number | null } | null> {
  const before = storedReadingOf(row.readingJson);
  // Only the reader's own income: read as money in with a figure, and still income going in. Anything else was the
  // owner's doing, or there is no telling.
  if (!before || before.amount === null || !row.sourceId) return null;
  if ((before.type.value !== 'received' && before.type.value !== 'refund') || row.kind !== 'income' || row.amountMinor >= 0) return null;
  const source = await sourceById(tx, row.sourceId);
  if (!source) return null;
  const [home] = await tx.select({ id: workspaces.id, baseCurrency: workspaces.baseCurrency }).from(workspaces).where(eq(workspaces.id, row.workspaceId));
  if (!home) return null;

  const capture = captureOf(row);
  const reading = readFromSource(capture, source, source.readOffers ? 'transactions' : 'skip');
  if (reading.skipped !== null || reading.amount === null || reading.type.value !== 'spent') return null;
  const ws: WorkspaceContext = { workspaceId: home.id, baseCurrency: home.baseCurrency };
  // What the queue made of it then, and what it makes of it now: whatever on the draft is still the first, the owner
  // left alone, and it takes the second.
  const { draft: then } = await planDraft(tx, ws, capture, source, before, { today });
  const { draft: now } = await planDraft(tx, ws, capture, source, reading, { today });
  if (now.kind !== 'expense' || now.amountMinor <= 0) return null;

  // The figure as read, rounded the way money out is, while it is still the reader's; one typed keeps its size.
  const figureIsReaders = -row.amountMinor === Math.abs(then.amountMinor) && row.currency === then.currency;
  const edit: DraftEdit = { kind: 'expense' };
  if (figureIsReaders) {
    edit.amountMinor = now.amountMinor;
    edit.currency = now.currency;
    edit.exactHundredths = now.exactHundredths ?? null;
  } else {
    edit.amountMinor = -row.amountMinor;
    // A figure with cents still rounded down for money in is rounded up now; any other keeps what it had.
    const exact = (await draftExactExists(tx)) ? await exactOf(tx, row.id) : null;
    if (exact !== null) {
      edit.exactHundredths = exact;
      if (wholeFromHundredths(exact, 'down') === -row.amountMinor) edit.amountMinor = wholeFromHundredths(exact, 'up');
    }
  }

  const accountIsReaders = row.accountId === null || row.accountId === (then.accountId ?? null);
  const accountId = accountIsReaders ? (now.accountId ?? row.accountId) : row.accountId;
  edit.accountId = accountId;
  // The card that paid, when the account is the one the digits name.
  edit.cardId = accountId !== null && accountId === (now.accountId ?? null) ? (now.cardId ?? null) : row.cardId;

  // The category the merchant went to as income is no spending category: it gives way to the spending one, or none.
  const categoryIsReaders = row.categoryAccountId === null || row.categoryAccountId === (then.categoryAccountId ?? null);
  if (categoryIsReaders || (await isIncomeCategory(tx, row.categoryAccountId))) edit.categoryAccountId = now.categoryAccountId ?? null;

  return { ws, edit, readingJson: JSON.stringify(now.reading ?? reading), confidence: figureIsReaders ? (now.confidence ?? null) : row.confidence };
}

/** The cents a draft keeps beside its figure, where it keeps any. */
async function exactOf(tx: Db, id: string): Promise<number | null> {
  const [found] = await tx.values<[number | null]>(sql`SELECT exact_hundredths FROM draft_transactions WHERE id = ${id}`);
  const value = found?.[0];
  return value === null || value === undefined ? null : Number(value);
}

async function isIncomeCategory(tx: Db, id: string | null): Promise<boolean> {
  if (id === null) return false;
  const [found] = await tx.select({ kind: accounts.kind }).from(accounts).where(eq(accounts.id, id));
  return found?.kind === 'income';
}

/**
 * Reads again every message still waiting at 0 with its words kept, and every message still waiting as the reader's
 * money in, in every workspace on this device, and returns how many drafts changed: those that now have their figure
 * and those turned round to spending.
 *
 * Safe to run on every drain: a draft that gets a figure is no longer one of these, one turned round is no longer
 * income, and a message that still says the same is left exactly as it was.
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

    // Only drafts whose kept reading says money came in are read: the stored JSON names the type, so most rows are
    // passed over by the query itself.
    const incoming = await tx
      .select()
      .from(draftTransactions)
      .where(
        and(
          eq(draftTransactions.status, 'pending'),
          eq(draftTransactions.source, 'notification'),
          eq(draftTransactions.kind, 'income'),
          lt(draftTransactions.amountMinor, 0),
          isNotNull(draftTransactions.rawPayload),
          isNull(draftTransactions.mergedInto),
          or(like(draftTransactions.readingJson, '%"received"%'), like(draftTransactions.readingJson, '%"refund"%')),
        ),
      );
    for (const row of incoming) {
      const found = await rereadDirectionOne(tx, row, opts.today);
      if (!found) continue;
      await editDraftTx(tx, found.ws, row.id, found.edit);
      await tx.update(draftTransactions).set({ readingJson: found.readingJson, confidence: found.confidence }).where(eq(draftTransactions.id, row.id));
      filled += 1;
    }
    return filled;
  });
}

/** Marks the one-time fix below as run on this device (capture settings never leave it). */
const CARD_EMAIL_FIX = 'fix.card-email-income.v1';

/** What turning one card email the reader took for money in round to a purchase changes, or null to leave it. */
async function cardEmailFixOf(tx: Db, row: Row, source: CaptureSource, ws: WorkspaceContext, today: string): Promise<DraftEdit | null> {
  // The reader's income has its figure turned negative; a positive one was turned by hand.
  if (row.amountMinor >= 0) return null;
  const edit: DraftEdit = { kind: 'expense', amountMinor: -row.amountMinor };
  const exact = (await draftExactExists(tx)) ? await exactOf(tx, row.id) : null;
  if (exact !== null) {
    edit.exactHundredths = exact;
    // A figure with cents rounded down as money in is rounded up as money out.
    if (wholeFromHundredths(exact, 'down') === -row.amountMinor) edit.amountMinor = wholeFromHundredths(exact, 'up');
  }

  const before = storedReadingOf(row.readingJson);
  if (!before) {
    // Nothing kept says what the reader made of it: only a category that is none, or the one the reader would give,
    // tells it was left alone. Its account stays: no digits are kept to name a card by.
    const readers = await capturedCategoryFromHistory(tx, ws, row.description, 'income');
    if (row.categoryAccountId !== null && row.categoryAccountId !== readers) return null;
    edit.categoryAccountId = await capturedCategoryFromHistory(tx, ws, row.description, 'expense');
    return edit;
  }

  // Only the mistaken money in: a refund or a top-up was read as one, and stays.
  if (before.type.value !== 'received') return null;
  const capture = captureOf(row);
  const { draft: then } = await planDraft(tx, ws, capture, source, before, { today });
  const { draft: now } = await planDraft(tx, ws, capture, source, { ...before, type: { value: 'spent', confidence: 90, line: null } }, { today });
  // Still what the reader made: its figure, its account and its category. Anything else is the owner's.
  if (then.kind !== 'income' || -row.amountMinor !== Math.abs(then.amountMinor) || row.currency !== then.currency) return null;
  if (row.accountId !== (then.accountId ?? null)) return null;
  if (row.categoryAccountId !== null && row.categoryAccountId !== (then.categoryAccountId ?? null)) return null;
  if (now.kind !== 'expense' || now.amountMinor <= 0) return null;
  edit.amountMinor = now.amountMinor;
  edit.currency = now.currency;
  edit.exactHundredths = now.exactHundredths ?? null;
  // The account is still the reader's, so the card its digits name is taken with it.
  edit.accountId = now.accountId ?? row.accountId;
  edit.cardId = now.cardId ?? null;
  edit.categoryAccountId = now.categoryAccountId ?? null;
  return edit;
}

/**
 * Once per device: a credit card email from a card sender (`isCardEmailSender`, a Maybank card email) that an older
 * build's reader took for money in, still waiting just as the reader left it, becomes the purchase it was. Its words
 * may be gone, so it is found by its source, and told from the owner's own by what it kept:
 *
 * - its kept reading said money received (not a refund or a top-up), and its figure, account and category are still
 *   what that reading gave — the card its digits name is then taken;
 * - with no reading kept, its category is none or the reader's own, and its account stays as it is.
 *
 * A draft the owner changed, and a confirmed or dismissed one, is never touched. Returns how many drafts changed.
 */
export async function fixCardEmailDrafts(database: Database, opts: { today: string }): Promise<number> {
  return database.transaction(async (tx) => {
    const [done] = await tx.select({ key: captureSettings.key }).from(captureSettings).where(eq(captureSettings.key, CARD_EMAIL_FIX));
    if (done) return 0;
    const senders = (await tx.select().from(captureSources)).filter((source) => isCardEmailSender(source));
    const rows =
      senders.length === 0
        ? []
        : await tx
            .select()
            .from(draftTransactions)
            .where(
              and(
                eq(draftTransactions.status, 'pending'),
                eq(draftTransactions.kind, 'income'),
                isNull(draftTransactions.mergedInto),
                inArray(
                  draftTransactions.sourceId,
                  senders.map((source) => source.id),
                ),
              ),
            );
    let fixed = 0;
    for (const row of rows) {
      const source = await sourceById(tx, row.sourceId!);
      const [home] = await tx.select({ id: workspaces.id, baseCurrency: workspaces.baseCurrency }).from(workspaces).where(eq(workspaces.id, row.workspaceId));
      if (!source || !home) continue;
      const ws: WorkspaceContext = { workspaceId: home.id, baseCurrency: home.baseCurrency };
      const edit = await cardEmailFixOf(tx, row, source, ws, opts.today);
      if (!edit) continue;
      await editDraftTx(tx, ws, row.id, edit);
      // The kept reading says what the draft now is, so no later re-read turns it back.
      const kept = storedReadingOf(row.readingJson);
      if (kept) await tx.update(draftTransactions).set({ readingJson: JSON.stringify({ ...kept, type: { value: 'spent', confidence: 90, line: null } }) }).where(eq(draftTransactions.id, row.id));
      fixed += 1;
    }
    await tx.insert(captureSettings).values({ key: CARD_EMAIL_FIX, value: new Date().toISOString() }).onConflictDoNothing();
    return fixed;
  });
}
