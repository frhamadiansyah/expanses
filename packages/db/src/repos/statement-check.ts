/**
 * Checking a card statement against what cicis holds (statement-check spec §3.2–§3.6).
 *
 * `prepareStatementCheck` reads the screenshots' lines, loads the card's transactions and pending drafts around the
 * period, matches them, and suggests a category for every row that is missing. Nothing is written. The owner answers
 * the gaps, and `recordStatementCheck` then posts, corrects and links everything in one database transaction.
 *
 * The statement's text is never stored: only the transactions the owner records, the check and its links persist.
 * The check tables are device-local, as the card's terms are; the transactions posted here sync as any other.
 */
import {
  type Candidate,
  type CaptureLine,
  expenseLines,
  looksLikeRefund,
  matchStatement,
  merchantKeyOf,
  openingBalanceLines,
  type PostingLine,
  readStatement,
  type RowOutcome,
  type StatementPeriod,
  type StatementRow,
  transferLines,
  uuidv7,
} from '@expanses/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { accounts, entries, transactions } from '../schema';
import { cardPostings } from '../schema-cards';
import { draftTransactions } from '../schema-drafts';
import { cardStatementSettings, type StatementLinkKind, statementChecks, statementLinks } from '../schema-statements';
import { withCapture } from '../sync/capture';
import { createAccountTx, ensureSystemAccountTx, systemAccountId } from './accounts';
import { categoryIdsByKeyTx } from './categories';
import { confirmDraftTx, listDrafts } from './drafts';
import { guessCategoryFromHistory } from './entry';
import { listTransactions, nativeBalancesTx, postTransactionTx, replaceTransactionTx, type TransactionView, voidTransactionTx } from './ledger';
import { cardStatement, postingDates } from './statements';

export class StatementCheckError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NEEDS_CATEGORY' | 'ASK_UNANSWERED' | 'NO_PREVIOUS_BALANCE' | 'MIXED_CURRENCY' | 'CURRENCY',
    message: string,
  ) {
    super(message);
    this.name = 'StatementCheckError';
  }
}

/** Fees & charges, and Refunds for money back with no purchase to go back under: both made under Miscellaneous on first use (§3.3). */
const FEES = { key: 'miscellaneous.fees_charges', name: 'Fees & charges' };
const REFUNDS = { key: 'miscellaneous.refunds', name: 'Refunds' };
/** The parent both are made under when missing. */
const MISCELLANEOUS_KEY = 'miscellaneous';
/** Days either side of the period whose transactions may still be a statement row (the matcher's widest window and some). */
const CANDIDATE_MARGIN_DAYS = 7;
/** The quiet adjustment's description begins with this; the main transaction list hides it by it. */
export const PAYMENTS_NOT_TRACKED_PREFIX = 'Payments not tracked (';

export interface CheckDraftRow extends StatementRow {
  /** The row's place in the statement, which decisions refer to. */
  index: number;
  outcome: RowOutcome;
  /** The category it will be recorded under, when it needs one. */
  categoryId: string | null;
  /**
   * Where the category came from: an earlier transaction, another row of the same merchant, the fee rule, Refunds for
   * money back with no purchase to go back under, or the owner.
   */
  categorySource: 'known' | 'same-merchant' | 'fee' | 'refund' | 'owner' | null;
}

export interface FlaggedTransaction {
  transactionId: string;
  on: string;
  description: string;
  amountMinor: number;
}

export interface PreparedCheck {
  cardAccountId: string;
  period: StatementPeriod;
  currency: string;
  rows: CheckDraftRow[];
  flagged: FlaggedTransaction[];
  closingMinor: number | null;
  previousMinor: number | null;
  emptyImages: number[];
  untrackedPaymentsMinor: number;
  untrackedPaymentsCount: number;
  /** cicis's closing for the period before recording. */
  cardBalanceAtEndMinor: number;
  /** The card's opening is later than the period's start (S10). */
  startsAfterPeriod: boolean;
  alreadyChecked: boolean;
  /** The day the check was prepared for: what recording reads the card's balance on, unless told otherwise. */
  today: string;
}

export interface CheckDecisions {
  /** Row index → which amount stands for an "Amount differs" row. Unanswered keeps what was recorded. */
  differs: Record<number, 'statement' | 'mine'>;
  /** Transaction id → what to do with a transaction the statement does not show. Unanswered keeps it. */
  flagged: Record<string, 'keep' | 'delete' | { moveTo: string }>;
  /** Row index → the candidate id chosen for a row the matcher could not decide. */
  ask: Record<number, string>;
  /** Move the card's start to the day before this statement, owing its previous balance (S10). */
  moveStart: boolean;
}

export interface StatementCheckRow {
  id: string;
  cardAccountId: string;
  periodStart: string;
  periodEnd: string;
  closingMinor: number | null;
  previousMinor: number | null;
  status: 'reconciled' | 'differs' | 'open';
  differenceMinor: number;
  checkedAt: string;
}

export interface StatementLinkRow {
  checkId: string;
  transactionId: string;
  kind: StatementLinkKind;
}

const DAY_MS = 86_400_000;
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A `Database` whose reads run on the open transaction, for read helpers that take one. Never opens a transaction. */
function within(database: Database, tx: Tx): Database {
  return {
    ...database,
    db: tx,
    transaction: () => {
      throw new Error('A statement check does not nest transactions');
    },
  };
}

const DRAFT_PREFIX = 'draft:';
const draftIdOf = (candidateId: string): string | null => (candidateId.startsWith(DRAFT_PREFIX) ? candidateId.slice(DRAFT_PREFIX.length) : null);

/** A row is recorded under a category: a missing purchase, fee or refund. A card payment needs none. */
const needsCategory = (outcome: RowOutcome): boolean => outcome.status === 'missing' && outcome.as !== 'payment';

/** The card's opening: the earliest posting between it and the opening-balance equity that no check posted. */
async function openingOfCard(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<{ id: string; occurredOn: string } | null> {
  const equityId = await systemAccountId(db, ws, 'opening_balance');
  const rows = await db.values<[string, string]>(sql`
    SELECT t.id, t.occurred_on FROM transactions t
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ${cardAccountId})
      AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ${equityId})
      AND t.id NOT IN (SELECT transaction_id FROM statement_links)
    ORDER BY t.occurred_on, t.created_at LIMIT 1
  `);
  const [row] = rows;
  return row ? { id: row[0], occurredOn: row[1] } : null;
}

async function cardOf(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<{ id: string; currency: string }> {
  const [card] = await db
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, cardAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!card) throw new StatementCheckError('NOT_FOUND', 'That card is not in this workspace');
  return { id: card.id, currency: card.currency ?? ws.baseCurrency };
}

/**
 * A category by its key, made under Miscellaneous the first time a check needs it (§3.3). Looked up as the posting
 * will file it: the book's own copy, else the oldest.
 */
async function categoryByKeyTx(tx: Db, ws: WorkspaceContext, spec: { key: string; name: string }): Promise<string> {
  const byKey = await categoryIdsByKeyTx(tx, ws);
  const found = byKey[spec.key];
  if (found) return found;
  const made = await createAccountTx(tx, ws, { kind: 'expense', subtype: 'category', name: spec.name, currency: null, parentId: byKey[MISCELLANEOUS_KEY] ?? null });
  await withCapture(tx, { entity: 'category', id: made.id }, () => tx.update(accounts).set({ systemKey: spec.key }).where(eq(accounts.id, made.id)));
  return made.id;
}

/** The transactions checks posted or linked as statement rows: they stay candidates, whatever they post against. */
async function linkedRows(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ transactionId: statementLinks.transactionId })
    .from(statementLinks)
    .where(and(inArray(statementLinks.transactionId, [...ids]), inArray(statementLinks.kind, ['matched', 'recorded', 'differs-kept', 'differs-updated'])));
  return new Set(rows.map((r) => r.transactionId));
}

/** What a recorded transaction is to the card: a charge or a credit, and of which kind. Null when it is not one. */
function candidateOf(view: TransactionView, cardAccountId: string, postedOn: string | undefined, linked: ReadonlySet<string>): Candidate | null {
  // An opening and a balance correction (the "Payments not tracked" line, a start's bridge) are not statement rows; a
  // card payment a check recorded against the correction account is one, and stays one.
  const keys = view.entries.map((e) => e.accountSystemKey);
  if (keys.includes('opening_balance')) return null;
  if (keys.includes('balance_correction') && !linked.has(view.id)) return null;
  const onCard = view.entries.filter((e) => e.accountId === cardAccountId).reduce((sum, e) => sum + e.amountMinor, 0);
  if (onCard === 0) return null;
  const direction = onCard < 0 ? 'out' : 'in';
  const others = view.entries.filter((e) => e.accountId !== cardAccountId);
  const fromCategory = others.some((e) => e.accountKind === 'income' || e.accountKind === 'expense');
  const kind = direction === 'out' ? 'purchase' : fromCategory ? 'refund' : 'payment';
  return { id: view.id, on: postedOn ?? view.occurredOn, amountMinor: Math.abs(onCard), direction, kind, description: view.description, isDraft: false };
}

/**
 * Matches the screenshots' rows with the card's transactions and suggests categories. Writes nothing but Fees &
 * charges or Refunds, made the first time a row needs one.
 */
export async function prepareStatementCheck(
  database: Database,
  ws: WorkspaceContext,
  input: { cardAccountId: string; period: StatementPeriod; images: CaptureLine[][]; today: string },
): Promise<PreparedCheck> {
  const { cardAccountId, period } = input;
  const card = await cardOf(database.db, ws, cardAccountId);
  const reading = readStatement(input.images, period, card.currency);
  const trackPayments = await getTrackPayments(database, cardAccountId);

  const views = await listTransactions(database, ws, {
    accountId: cardAccountId,
    from: addDays(period.start, -CANDIDATE_MARGIN_DAYS),
    to: addDays(period.end, CANDIDATE_MARGIN_DAYS),
    limit: 2000,
  });
  const posted = await postingDates(database, ws, views.map((v) => v.id));
  const viewById = new Map(views.map((v) => [v.id, v]));
  const linked = await linkedRows(database.db, views.map((v) => v.id));
  const candidates: Candidate[] = [];
  for (const view of [...views].reverse()) {
    const candidate = candidateOf(view, cardAccountId, posted.get(view.id), linked);
    if (candidate) candidates.push(candidate);
  }
  const lo = addDays(period.start, -CANDIDATE_MARGIN_DAYS);
  const hi = addDays(period.end, CANDIDATE_MARGIN_DAYS);
  const drafts = (await listDrafts(database, ws)).filter((d) => d.occurredOn >= lo && d.occurredOn <= hi);
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  for (const d of drafts) {
    const base = { id: `${DRAFT_PREFIX}${d.id}`, on: d.occurredOn, amountMinor: Math.abs(d.amountMinor), description: d.description, isDraft: true };
    if (d.kind === 'transfer' && d.toAccountId === cardAccountId) candidates.push({ ...base, direction: 'in', kind: 'payment' });
    else if (d.kind === 'expense' && d.accountId === cardAccountId) candidates.push({ ...base, direction: 'out', kind: 'purchase' });
    else if (d.kind === 'income' && d.accountId === cardAccountId) candidates.push({ ...base, direction: 'in', kind: 'refund' });
  }

  const purchases = candidates.filter((c) => c.kind === 'purchase');
  const refundHints = new Map<number, boolean>();
  reading.rows.forEach((row, i) => {
    if (row.direction !== 'in') return;
    const earlier = [
      ...reading.rows.filter((r) => r.direction === 'out' && r.on <= row.on),
      ...purchases.filter((c) => c.on <= row.on),
    ].map((p) => ({ description: p.description, amountMinor: p.amountMinor }));
    refundHints.set(i, looksLikeRefund(row, earlier));
  });

  const { outcomes, flagged } = matchStatement(reading.rows, candidates, { period, trackPayments, refundHints });

  // Fees & charges and Refunds are made on first use, here, only when a row needs them.
  const made = new Map<string, string>();
  const ensure = async (spec: { key: string; name: string }) => {
    if (!made.has(spec.key)) made.set(spec.key, await database.transaction((tx) => categoryByKeyTx(tx, ws, spec)));
    return made.get(spec.key)!;
  };
  const categoryOfView = (id: string): string | null => {
    const lines = viewById.get(id)?.entries.filter((e) => e.accountKind === 'expense') ?? [];
    return lines.length === 1 ? lines[0]!.accountId : null;
  };
  const rows: CheckDraftRow[] = [];
  for (const [index, row] of reading.rows.entries()) {
    const outcome = outcomes[index]!;
    let categoryId: string | null = null;
    let categorySource: CheckDraftRow['categorySource'] = null;
    // A matched draft with no category is recorded with the row, so it wants one too.
    const draftWithout = (outcome.status === 'matched' ? outcome.candidateIds : outcome.status === 'differs' ? [outcome.candidateId] : [])
      .map((id) => draftById.get(draftIdOf(id) ?? ''))
      .some((d) => d !== undefined && d.kind !== 'transfer' && !d.categoryAccountId);
    if (needsCategory(outcome) || draftWithout) {
      if (outcome.status === 'missing' && outcome.as === 'fee') {
        categoryId = await ensure(FEES);
        categorySource = 'fee';
      } else {
        categoryId = await guessCategoryFromHistory(database, ws, row.description);
        // A refund with no merchant history goes back under the most recent earlier purchase of the same amount.
        if (!categoryId && outcome.status === 'missing' && outcome.as === 'refund') {
          const same = purchases
            .filter((c) => !c.isDraft && c.amountMinor === row.amountMinor && c.on <= row.on)
            .sort((a, b) => b.on.localeCompare(a.on))[0];
          categoryId = same ? categoryOfView(same.id) : null;
        }
        if (categoryId) categorySource = 'known';
        else if (outcome.status === 'missing' && outcome.as === 'refund') {
          // The purchase it reverses may be on this statement too: it goes back under that row's category, taken now
          // when it has one, or filled with it when the owner chooses one (same merchant). Only money back with no
          // purchase to go back under is filed as Refunds.
          const key = merchantKeyOf(row.description);
          const reverses = rows
            .filter((r) => r.direction === 'out' && r.on <= row.on && (r.amountMinor === row.amountMinor || (key !== '' && merchantKeyOf(r.description) === key)))
            .at(-1);
          if (reverses) {
            categoryId = reverses.categoryId;
            categorySource = categoryId ? 'known' : null;
          } else {
            categoryId = await ensure(REFUNDS);
            categorySource = 'refund';
          }
        }
      }
    }
    rows.push({ ...row, index, outcome, categoryId, categorySource });
  }

  const byCandidate = new Map(candidates.map((c) => [c.id, c]));
  const untracked = rows.filter((r) => r.outcome.status === 'payment-untracked');
  const opening = await openingOfCard(database.db, ws, cardAccountId);
  const [existing] = await database.db
    .select({ id: statementChecks.id })
    .from(statementChecks)
    .where(and(eq(statementChecks.cardAccountId, cardAccountId), eq(statementChecks.periodStart, period.start), eq(statementChecks.periodEnd, period.end)));

  return {
    cardAccountId,
    period,
    currency: card.currency,
    rows,
    flagged: flagged.map((id) => {
      const c = byCandidate.get(id)!;
      return { transactionId: id, on: c.on, description: c.description, amountMinor: c.amountMinor };
    }),
    closingMinor: reading.closingMinor,
    previousMinor: reading.previousMinor,
    emptyImages: reading.emptyImages,
    untrackedPaymentsMinor: untracked.reduce((sum, r) => sum + r.amountMinor, 0),
    untrackedPaymentsCount: untracked.length,
    cardBalanceAtEndMinor: (await cardStatement(database, ws, cardAccountId, period, input.today)).closingMinor,
    startsAfterPeriod: opening !== null && opening.occurredOn > period.start,
    alreadyChecked: existing !== undefined,
    today: input.today,
  };
}

/**
 * The owner chose a category for one row: it is theirs, and every unanswered row of the same merchant in this check
 * takes it too. Pure; the rows given are not changed.
 */
export function fillSameMerchant(rows: CheckDraftRow[], index: number, categoryId: string): CheckDraftRow[] {
  const chosen = rows.find((r) => r.index === index);
  if (!chosen) return rows;
  const key = merchantKeyOf(chosen.description);
  return rows.map((r) => {
    if (r.index === index) return { ...r, categoryId, categorySource: 'owner' };
    if (r.categoryId === null && needsCategory(r.outcome) && key !== '' && merchantKeyOf(r.description) === key) {
      return { ...r, categoryId, categorySource: 'same-merchant' };
    }
    return r;
  });
}

/** A transaction's lines as they stand, to post again with a change. */
async function linesOf(tx: Db, ws: WorkspaceContext, id: string) {
  const [row] = await tx
    .select({ occurredOn: transactions.occurredOn, description: transactions.description, status: transactions.status })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
  if (!row) throw new StatementCheckError('NOT_FOUND', `Transaction ${id} is not in this workspace`);
  const lines = await tx
    .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, memo: entries.memo, spendCategoryId: entries.spendCategoryId, fxRateToBase: entries.fxRateToBase })
    .from(entries)
    .where(eq(entries.transactionId, id))
    .orderBy(asc(entries.id));
  const ratesToBase = Object.fromEntries(lines.map((l) => [l.currency, l.fxRateToBase]));
  const posting: PostingLine[] = lines.map(({ fxRateToBase: _rate, ...l }) => l);
  return { ...row, lines: posting, ratesToBase };
}

/** The same lines with the card's side at `amountMinor`, the other side scaled to match. Never a zero line. */
function rescaled(lines: PostingLine[], cardAccountId: string, amountMinor: number): PostingLine[] {
  if (new Set(lines.map((l) => l.currency)).size > 1) throw new StatementCheckError('MIXED_CURRENCY', 'A transaction in two currencies is corrected on its own screen');
  const onCard = lines.filter((l) => l.accountId === cardAccountId).reduce((sum, l) => sum + l.amountMinor, 0);
  const factor = amountMinor / Math.abs(onCard);
  const out = lines.map((l) => ({ ...l, amountMinor: Math.round(l.amountMinor * factor) }));
  // Rounding left over lands on the largest line off the card, so the posting still balances.
  const rest = out.reduce((sum, l) => sum + l.amountMinor, 0);
  if (rest !== 0) {
    const largest = out.filter((l) => l.accountId !== cardAccountId).sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor))[0];
    if (largest) largest.amountMinor -= rest;
  }
  // A small side scaled to nothing is dropped; what is left still balances.
  return out.filter((l) => l.amountMinor !== 0);
}

/** What the card owed at the end of a day: everything posted on it up to then. */
async function owedAt(tx: Db, ws: WorkspaceContext, cardAccountId: string, day: string): Promise<number> {
  return -((await nativeBalancesTx(tx, ws, day))[cardAccountId] ?? 0);
}

/** The posting that keeps a moved card's later balance whole (S10), while its history is checked statement by statement. */
const bridgeRefOf = (cardAccountId: string) => `statement-bridge:${cardAccountId}`;

/** Missing rows are recorded with this ref: the row's date, amount and direction, and which of its alike rows it is. */
function externalRefsOf(prepared: PreparedCheck): Map<number, string> {
  const seen = new Map<string, number>();
  const refs = new Map<number, string>();
  for (const row of prepared.rows) {
    const key = `${row.on}:${row.amountMinor}:${row.direction}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    refs.set(row.index, `statement:${prepared.cardAccountId}:${prepared.period.start}:${key}:${n}`);
  }
  return refs;
}

/**
 * Records a finished check in one database transaction: moves the card's start if asked, confirms matched drafts,
 * posts missing rows, applies the owner's answers, posts the "Payments not tracked" adjustment, keeps a moved card's
 * bridge right, and saves the check with its links. Checking the same period again reuses the check and posts
 * nothing twice. `today` (the day the card's balance is read on) defaults to the day the check was prepared for.
 */
export async function recordStatementCheck(
  database: Database,
  ws: WorkspaceContext,
  prepared: PreparedCheck,
  decisions: CheckDecisions,
  today: string = prepared.today,
): Promise<{ checkId: string; status: 'reconciled' | 'differs' | 'open'; differenceMinor: number }> {
  const gap = prepared.rows.find((r) => needsCategory(r.outcome) && r.categoryId === null);
  if (gap) throw new StatementCheckError('NEEDS_CATEGORY', `Choose a category for “${gap.description}”`);
  const unanswered = prepared.rows.find((r) => r.outcome.status === 'ask' && !r.outcome.candidateIds.includes(decisions.ask[r.index] ?? ''));
  if (unanswered) throw new StatementCheckError('ASK_UNANSWERED', `Say which recorded transaction “${unanswered.description}” is`);
  if (decisions.moveStart && prepared.previousMinor === null) {
    throw new StatementCheckError('NO_PREVIOUS_BALANCE', 'Add the summary with the previous balance to move the card’s start');
  }
  const { cardAccountId, period } = prepared;
  const card = await cardOf(database.db, ws, cardAccountId);
  for (const answer of Object.values(decisions.flagged)) {
    if (typeof answer !== 'object') continue;
    const [to] = await database.db
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, answer.moveTo), eq(accounts.workspaceId, ws.workspaceId)));
    if (!to) throw new StatementCheckError('NOT_FOUND', 'That card is not in this workspace');
    if (to.currency !== card.currency) throw new StatementCheckError('CURRENCY', `Move it to a ${card.currency} card`);
  }
  const refs = externalRefsOf(prepared);

  return database.transaction(async (tx) => {
    const now = new Date().toISOString();
    const correctionId = await ensureSystemAccountTx(tx, ws, 'balance_correction');

    const [existing] = await tx
      .select()
      .from(statementChecks)
      .where(and(eq(statementChecks.cardAccountId, cardAccountId), eq(statementChecks.periodStart, period.start), eq(statementChecks.periodEnd, period.end)));
    const checkId = existing?.id ?? uuidv7();
    // A re-check without the summary keeps the balances the earlier check read.
    const closingMinor = prepared.closingMinor ?? existing?.closingMinor ?? null;
    const previousMinor = prepared.previousMinor ?? existing?.previousMinor ?? null;
    if (!existing) {
      await tx.insert(statementChecks).values({
        id: checkId,
        workspaceId: ws.workspaceId,
        cardAccountId,
        periodStart: period.start,
        periodEnd: period.end,
        closingMinor,
        previousMinor,
        status: 'open',
        differenceMinor: 0,
        checkedAt: now,
      });
    }
    const priorLinks = await tx.select().from(statementLinks).where(eq(statementLinks.checkId, checkId));
    // A link already made keeps its kind: what a check recorded stays "recorded" when a re-check finds it matched.
    const link = async (transactionId: string, kind: StatementLinkKind) => {
      await tx.insert(statementLinks).values({ checkId, transactionId, kind }).onConflictDoNothing();
    };

    // S10's bridge: what the card owed at its old start before the move, held there while the history before it is
    // checked. Read before anything below changes the card.
    const [bridge] = await tx
      .select({ id: transactions.id, occurredOn: transactions.occurredOn })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.externalRef, bridgeRefOf(cardAccountId)), eq(transactions.status, 'posted')));
    let bridgeOn: string | null = bridge?.occurredOn ?? null;
    let owedThen = bridgeOn ? await owedAt(tx, ws, cardAccountId, bridgeOn) : 0;

    // S10: the card starts the day before this statement, owing what the statement says was owed before it.
    if (decisions.moveStart) {
      const opening = await openingOfCard(tx, ws, cardAccountId);
      if (opening && opening.occurredOn > period.start) {
        if (bridgeOn === null) {
          bridgeOn = opening.occurredOn;
          owedThen = await owedAt(tx, ws, cardAccountId, bridgeOn);
        }
        if (previousMinor === 0) {
          await voidTransactionTx(tx, ws, opening.id);
        } else {
          const was = await linesOf(tx, ws, opening.id);
          const equityId = await systemAccountId(tx, ws, 'opening_balance');
          const lines = openingBalanceLines({ accountId: cardAccountId, kind: 'liability', balanceMinor: previousMinor!, currency: card.currency, equityAccountId: equityId });
          await replaceTransactionTx(tx, ws, opening.id, { occurredOn: addDays(period.start, -1), description: was.description, lines, ratesToBase: was.ratesToBase });
        }
      }
    }

    /** A candidate as a posted transaction: a draft is confirmed, with the row's category when it has none. */
    const resolve = async (candidateId: string, row: CheckDraftRow, amountMinor?: number): Promise<string> => {
      const draftId = draftIdOf(candidateId);
      if (draftId === null) return candidateId;
      const [draft] = await tx.select().from(draftTransactions).where(and(eq(draftTransactions.id, draftId), eq(draftTransactions.workspaceId, ws.workspaceId)));
      if (draft?.status === 'confirmed' && draft.transactionId) return draft.transactionId;
      const patch: Partial<typeof draftTransactions.$inferInsert> = {};
      if (draft && draft.kind !== 'transfer' && !draft.categoryAccountId && row.categoryId) patch.categoryAccountId = row.categoryId;
      if (draft && amountMinor !== undefined) patch.amountMinor = Math.sign(draft.amountMinor || 1) * amountMinor;
      if (Object.keys(patch).length > 0) await tx.update(draftTransactions).set(patch).where(eq(draftTransactions.id, draftId));
      return (await confirmDraftTx(tx, ws, draftId)).transactionId;
    };

    const chosen = new Set<string>();
    const tied = new Set<string>();
    for (const row of prepared.rows) {
      const outcome = row.outcome;
      if (outcome.status === 'matched') {
        for (const id of outcome.candidateIds) await link(await resolve(id, row), 'matched');
      } else if (outcome.status === 'ask') {
        for (const id of outcome.candidateIds) tied.add(id);
        const pick = decisions.ask[row.index]!;
        if (!chosen.has(pick)) {
          chosen.add(pick);
          await link(await resolve(pick, row), 'matched');
        }
      } else if (outcome.status === 'differs') {
        const useStatement = decisions.differs[row.index] === 'statement';
        if (draftIdOf(outcome.candidateId) !== null) {
          const id = await resolve(outcome.candidateId, row, useStatement ? outcome.statementMinor : undefined);
          await link(id, useStatement ? 'differs-updated' : 'differs-kept');
        } else if (useStatement) {
          const was = await linesOf(tx, ws, outcome.candidateId);
          if (was.status === 'posted') {
            const id = await replaceTransactionTx(tx, ws, outcome.candidateId, {
              occurredOn: was.occurredOn,
              description: was.description,
              lines: rescaled(was.lines, cardAccountId, outcome.statementMinor),
              ratesToBase: was.ratesToBase,
            });
            await link(id, 'differs-updated');
          }
        } else {
          await link(outcome.candidateId, 'differs-kept');
        }
      } else if (outcome.status === 'missing') {
        const externalRef = refs.get(row.index)!;
        const [already] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.externalRef, externalRef), eq(transactions.status, 'posted')));
        if (already) {
          await link(already.id, 'recorded');
          continue;
        }
        const amount = { amountMinor: row.amountMinor, currency: card.currency };
        const isPayment = outcome.as === 'payment';
        const lines = isPayment
          ? // The bank account it came from is asked for later; until then it is a correction, as an untracked one is.
            transferLines({ fromAccountId: correctionId, toAccountId: cardAccountId, ...amount })
          : outcome.as === 'refund'
            ? // Money back: the card is owed less, and the category it was spent under takes it back.
              expenseLines({ categoryAccountId: cardAccountId, paymentAccountId: row.categoryId!, ...amount })
            : expenseLines({ categoryAccountId: row.categoryId!, paymentAccountId: cardAccountId, ...amount });
        const id = await postTransactionTx(tx, ws, {
          occurredOn: row.on,
          description: isPayment ? 'Card payment' : row.description,
          source: 'screen',
          externalRef,
          lines,
        });
        // The bank's posting date decides the statement it is billed on, as it did for this one.
        if (row.postedOn && row.postedOn > row.on) await tx.insert(cardPostings).values({ transactionId: id, workspaceId: ws.workspaceId, postedOn: row.postedOn });
        await link(id, 'recorded');
      }
    }

    // §3.6: the statement's card payments that match nothing recorded, as one quiet balance correction.
    const count = prepared.untrackedPaymentsCount;
    const total = prepared.untrackedPaymentsMinor;
    const description = `${PAYMENTS_NOT_TRACKED_PREFIX}${count} payment${count === 1 ? '' : 's'})`;
    const adjustmentLines = transferLines({ fromAccountId: correctionId, toAccountId: cardAccountId, amountMinor: total, currency: card.currency });
    const priorAdjustment = priorLinks.find((l) => l.kind === 'payments-untracked');
    const [standing] = priorAdjustment
      ? await tx.select({ status: transactions.status, description: transactions.description }).from(transactions).where(eq(transactions.id, priorAdjustment.transactionId))
      : [];
    const standingAmount = standing?.status === 'posted'
      ? (await tx.select({ amountMinor: entries.amountMinor }).from(entries).where(and(eq(entries.transactionId, priorAdjustment!.transactionId), eq(entries.accountId, cardAccountId))))[0]?.amountMinor
      : undefined;
    if (standing?.status === 'posted' && count === 0) {
      await voidTransactionTx(tx, ws, priorAdjustment!.transactionId);
    } else if (standing?.status === 'posted' && (standingAmount !== total || standing.description !== description)) {
      const id = await replaceTransactionTx(tx, ws, priorAdjustment!.transactionId, { occurredOn: period.end, description, lines: adjustmentLines, excludedFromReport: true });
      await link(id, 'payments-untracked');
    } else if (standing?.status !== 'posted' && count > 0) {
      const id = await postTransactionTx(tx, ws, { occurredOn: period.end, description, lines: adjustmentLines, excludedFromReport: true });
      await link(id, 'payments-untracked');
    }

    // What the statement does not show: the owner's answer for each, and nothing for one unanswered. A tied
    // candidate no row took counts as one of these.
    const answerable = new Set([...prepared.flagged.map((f) => f.transactionId), ...[...tied].filter((id) => !chosen.has(id))]);
    for (const [id, answer] of Object.entries(decisions.flagged)) {
      if (!answerable.has(id) || answer === 'keep') continue;
      const draftId = draftIdOf(id);
      if (draftId !== null) {
        const [draft] = await tx.select({ toAccountId: draftTransactions.toAccountId }).from(draftTransactions).where(eq(draftTransactions.id, draftId));
        // A payment draft has the card on its "to" side; anything else pays from it.
        const patch =
          answer === 'delete'
            ? { status: 'dismissed' as const, resolvedAt: now }
            : draft?.toAccountId === cardAccountId
              ? { toAccountId: answer.moveTo }
              : { accountId: answer.moveTo };
        await tx.update(draftTransactions).set(patch).where(and(eq(draftTransactions.id, draftId), eq(draftTransactions.status, 'pending')));
        continue;
      }
      const was = await linesOf(tx, ws, id);
      if (was.status !== 'posted') continue;
      if (answer === 'delete') {
        await voidTransactionTx(tx, ws, id);
      } else {
        const lines = was.lines.map((l) => (l.accountId === cardAccountId ? { ...l, accountId: answer.moveTo } : l));
        // The physical card it was made on belongs to this card's account, not the other one.
        await replaceTransactionTx(tx, ws, id, { occurredOn: was.occurredOn, description: was.description, lines, ratesToBase: was.ratesToBase, cardId: null });
      }
    }

    // S10's bridge, made or brought up to date: at the old start the card owes what it owed there before the move,
    // so today's balance never changes; it shrinks as each older statement is checked, and goes at zero.
    if (bridgeOn !== null) {
      const bridgeOwed = bridge
        ? -((await tx.select({ amountMinor: entries.amountMinor }).from(entries).where(and(eq(entries.transactionId, bridge.id), eq(entries.accountId, cardAccountId))))[0]?.amountMinor ?? 0)
        : 0;
      const wanted = owedThen - ((await owedAt(tx, ws, cardAccountId, bridgeOn)) - bridgeOwed);
      const lines = [
        { accountId: cardAccountId, amountMinor: -wanted, currency: card.currency },
        { accountId: correctionId, amountMinor: wanted, currency: card.currency },
      ];
      const [name] = await tx.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, cardAccountId));
      const input = { occurredOn: bridgeOn, description: `Balance before the checked statements: ${name?.name ?? ''}`.trim(), lines, externalRef: bridgeRefOf(cardAccountId) };
      if (bridge && wanted === 0) await voidTransactionTx(tx, ws, bridge.id);
      else if (bridge && wanted !== bridgeOwed) await replaceTransactionTx(tx, ws, bridge.id, input);
      else if (!bridge && wanted !== 0) await postTransactionTx(tx, ws, input);
    }

    // Links to what a correction or a deletion replaced go: the check names what stands.
    await tx.run(sql`DELETE FROM statement_links WHERE check_id = ${checkId} AND transaction_id IN (SELECT id FROM transactions WHERE status = 'void')`);

    const closing = (await cardStatement(within(database, tx), ws, cardAccountId, period, today)).closingMinor;
    const differenceMinor = closingMinor === null ? 0 : closingMinor - closing;
    const status = closingMinor === null ? 'open' : differenceMinor === 0 ? 'reconciled' : 'differs';
    await tx
      .update(statementChecks)
      .set({ closingMinor, previousMinor, status, differenceMinor, checkedAt: now })
      .where(eq(statementChecks.id, checkId));
    return { checkId, status, differenceMinor };
  });
}

/** Whether the card's payments are matched with transfers (S7). Off unless the owner turned it on. */
export async function getTrackPayments(database: Database, cardAccountId: string): Promise<boolean> {
  const [row] = await database.db
    .select({ trackPayments: cardStatementSettings.trackPayments })
    .from(cardStatementSettings)
    .where(eq(cardStatementSettings.cardAccountId, cardAccountId));
  return row?.trackPayments === 1;
}

export async function setTrackPayments(database: Database, cardAccountId: string, on: boolean): Promise<void> {
  const trackPayments = on ? 1 : 0;
  await database.db
    .insert(cardStatementSettings)
    .values({ cardAccountId, trackPayments })
    .onConflictDoUpdate({ target: cardStatementSettings.cardAccountId, set: { trackPayments } });
}

/** The card's checked statements, newest period first. */
export async function listStatementChecks(database: Database, ws: WorkspaceContext, cardAccountId: string): Promise<StatementCheckRow[]> {
  const rows = await database.db
    .select()
    .from(statementChecks)
    .where(and(eq(statementChecks.workspaceId, ws.workspaceId), eq(statementChecks.cardAccountId, cardAccountId)));
  return rows
    .map(({ workspaceId: _ws, ...row }) => row)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
}

/** Which transactions a check matched, recorded or adjusted. */
export async function listStatementLinks(database: Database, checkId: string): Promise<StatementLinkRow[]> {
  return database.db.select().from(statementLinks).where(eq(statementLinks.checkId, checkId)).orderBy(asc(statementLinks.transactionId));
}

