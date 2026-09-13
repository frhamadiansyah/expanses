import {
  type Balance,
  balanceOf,
  spendableOf,
  bestRedemption,
  categoryAncestors,
  computeCycleEarn,
  consumeFifo,
  type Cycle,
  dueToExpire,
  type ExpiryPolicy,
  expiresOn as expiryDateFor,
  type FeeRoi,
  feeRoi,
  LedgerError,
  type PointEntry,
  uuidv7,
} from '@expanses/core';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { pointEntries, pointSnapshots, rewardPrograms } from '../schema-points';
import { listAccounts } from './accounts';
import { listTransactionPointActuals } from './point-actuals';
import { categoryIdsByKey } from './categories';
import { cardTerms } from '../schema-points';
import { cardSpendLines, listCycleActuals, listCycleBonuses, listEarnRules, listRedemptionOptions, PointsError, toRedemption } from './points';

/** Entries the derivation owns and may rewrite. Everything else is the owner's own record. */
const DERIVED_SOURCES = ['transaction', 'statement', 'projected'] as const;

export interface PointEntryRow extends PointEntry {
  programId: string;
  transactionId: string | null;
  note: string | null;
  /** What a redemption fetched, when the owner recorded it. */
  valueMinor: number | null;
}

export interface RecordSnapshotInput {
  programId: string;
  /** The balance the owner read in the issuer's app. */
  balance: number;
  observedOn: string;
}

export async function listPointEntries(database: Database, ws: WorkspaceContext, programId: string): Promise<PointEntryRow[]> {
  const rows = await database.db
    .select()
    .from(pointEntries)
    .where(and(eq(pointEntries.workspaceId, ws.workspaceId), eq(pointEntries.programId, programId)));
  return rows.map((row) => ({
    id: row.id,
    programId: row.programId,
    transactionId: row.transactionId,
    kind: row.kind,
    quantity: row.quantity,
    occurredOn: row.occurredOn,
    status: row.status,
    source: row.source,
    batchId: row.batchId,
    expiresOn: row.expiresOn,
    note: row.note,
    valueMinor: row.valueMinor,
  }));
}

export async function programBalance(database: Database, ws: WorkspaceContext, programId: string, today: string): Promise<Balance> {
  return balanceOf(await listPointEntries(database, ws, programId), today);
}

/**
 * Writes one cycle's earn entries from the best evidence it has: the figures the issuer showed for each
 * purchase, else the statement total, else the app's own working, marked as worked out.
 *
 * Only the entries this derivation owns are rewritten. A redemption, an expiry or a correction from a
 * balance the owner read stays exactly where it is — otherwise typing a figure in would erase them.
 */
export async function deriveCycleEntries(database: Database, ws: WorkspaceContext, programId: string, cycle: Cycle): Promise<number> {
  const [program] = await database.db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new PointsError('Reward program not found');

  const [card] = await database.db
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, program.cardAccountId), eq(accounts.workspaceId, ws.workspaceId)));

  const lines = await cardSpendLines(database, ws, program.cardAccountId, cycle.start, cycle.end);
  const rules = await listEarnRules(database, ws, programId);
  const bonuses = await listCycleBonuses(database, ws, programId);
  const all = await listAccounts(database, ws);
  const ancestors = categoryAncestors(all.filter((account) => account.kind === 'expense'));
  const earn = computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: cycle.end, billingCurrency: card?.currency ?? 'IDR' });

  const inCycle = new Set(lines.map((line) => line.transactionId));
  const perPurchase = (await listTransactionPointActuals(database, ws, programId)).filter((actual) => inCycle.has(actual.transactionId));
  const cycleTotal = (await listCycleActuals(database, ws, programId)).find((actual) => actual.cycleStart === cycle.start);

  const now = new Date().toISOString();
  const row = (input: {
    transactionId: string | null;
    quantity: number;
    occurredOn: string;
    status: 'posted' | 'projected';
    source: (typeof DERIVED_SOURCES)[number];
  }) => ({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    programId,
    transactionId: input.transactionId,
    kind: 'earn' as const,
    quantity: input.quantity,
    occurredOn: input.occurredOn,
    status: input.status,
    source: input.source,
    batchId: null,
    // Stamped from the program's policy, so changing the policy restamps on the next derivation.
    expiresOn: expiryDateFor(input.occurredOn, program.expiryPolicy, program.expiryMonths),
    note: null,
    createdAt: now,
  });

  const dateOf = (transactionId: string) => lines.find((line) => line.transactionId === transactionId)?.occurredOn ?? cycle.end;
  let fresh: ReturnType<typeof row>[] = [];

  if (perPurchase.length > 0) {
    fresh = perPurchase
      .filter((actual) => actual.actualPoints !== 0)
      .map((actual) =>
        row({ transactionId: actual.transactionId, quantity: actual.actualPoints, occurredOn: dateOf(actual.transactionId), status: 'posted', source: 'transaction' }),
      );
  } else if (cycleTotal) {
    fresh = [row({ transactionId: null, quantity: cycleTotal.actualPoints, occurredOn: cycle.end, status: 'posted', source: 'statement' })];
  } else {
    fresh = Object.entries(earn.pointsByTransaction)
      .filter(([, points]) => points !== 0)
      .map(([transactionId, points]) => row({ transactionId, quantity: points, occurredOn: dateOf(transactionId), status: 'projected', source: 'projected' }));
    const bonusPoints = Object.values(earn.bonusById).reduce((total, points) => total + points, 0);
    if (bonusPoints !== 0) fresh.push(row({ transactionId: null, quantity: bonusPoints, occurredOn: cycle.end, status: 'projected', source: 'projected' }));
  }

  await database.transaction(async (tx) => {
    await tx
      .delete(pointEntries)
      .where(
        and(
          eq(pointEntries.workspaceId, ws.workspaceId),
          eq(pointEntries.programId, programId),
          eq(pointEntries.kind, 'earn'),
          inArray(pointEntries.source, [...DERIVED_SOURCES]),
          gte(pointEntries.occurredOn, cycle.start),
          lte(pointEntries.occurredOn, cycle.end),
        ),
      );
    if (fresh.length > 0) await tx.insert(pointEntries).values(fresh);
  });

  return fresh.length;
}

/**
 * Anchors the balance to what the owner read in the issuer's app, with one correction for the
 * difference. No attempt is made to say which purchase was mis-credited: a visible discrepancy is worth
 * more than a tidy number hiding one, and a card whose corrections keep growing has a rule to fix.
 */
export async function recordPointSnapshot(database: Database, ws: WorkspaceContext, input: RecordSnapshotInput): Promise<number> {
  if (!Number.isFinite(input.balance) || input.balance < 0) throw new PointsError('A balance cannot be below nothing');

  const [program] = await database.db
    .select({ id: rewardPrograms.id })
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, input.programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new PointsError('Reward program not found');

  const entries = await listPointEntries(database, ws, input.programId);
  const difference = input.balance - balanceOf(entries, input.observedOn).total;
  const now = new Date().toISOString();
  const note = `Balance read as ${input.balance}`;

  const correction = (quantity: number, batchId: string | null) => ({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    programId: input.programId,
    transactionId: null,
    kind: 'adjust' as const,
    quantity,
    occurredOn: input.observedOn,
    status: 'posted' as const,
    source: 'snapshot' as const,
    batchId,
    expiresOn: null,
    note,
    valueMinor: null,
    createdAt: now,
  });

  // Downward, the batches have to come down with the total. An unattached correction would leave them
  // full, and more could then be spent than is actually held.
  const rows: ReturnType<typeof correction>[] = [];
  if (difference > 0) {
    rows.push(correction(difference, null));
  } else if (difference < 0) {
    const wanted = -difference;
    const spendable = spendableOf(entries, input.observedOn);
    const drawn = Math.min(wanted, spendable);
    if (drawn > 0) {
      for (const batch of consumeFifo(entries, drawn, input.observedOn)) rows.push(correction(-batch.quantity, batch.batchId));
    }
    // Points sitting in batches that have already died are in the total but cannot be drawn on.
    const remainder = wanted - drawn;
    if (remainder > 0) rows.push(correction(-remainder, null));
  }

  await database.transaction(async (tx) => {
    await tx.insert(pointSnapshots).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      programId: input.programId,
      balance: input.balance,
      observedOn: input.observedOn,
      createdAt: now,
    });
    if (rows.length > 0) await tx.insert(pointEntries).values(rows);
  });

  return difference;
}

/** How this program's points die. Setting a policy restamps the batches next time they are derived. */
export async function setProgramExpiry(
  database: Database,
  ws: WorkspaceContext,
  programId: string,
  policy: ExpiryPolicy,
  months: number | null,
): Promise<void> {
  if (policy !== 'none' && policy !== 'months_from_earn' && policy !== 'fixed_annual') throw new PointsError('Unknown expiry policy');
  if (policy === 'months_from_earn' && (months === null || !Number.isInteger(months) || months <= 0)) {
    throw new PointsError('Say how many months the points last');
  }
  await database.db
    .update(rewardPrograms)
    // A month count left behind by an earlier policy would be read again if that policy came back.
    .set({ expiryPolicy: policy, expiryMonths: policy === 'months_from_earn' ? months : null })
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
}

/**
 * Writes off every batch that has died, one entry each, and returns how many were written.
 *
 * The issuer took these points back whether or not the app noticed, so recording it is not a choice —
 * refusing to would leave the balance claiming points that no longer exist. A written-off batch holds
 * nothing, so running this again writes nothing.
 */
export async function expireDueEntries(database: Database, ws: WorkspaceContext, programId: string, today: string): Promise<number> {
  const due = dueToExpire(await listPointEntries(database, ws, programId), today);
  if (due.length === 0) return 0;

  const now = new Date().toISOString();
  await database.db.insert(pointEntries).values(
    due.map((batch) => ({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      programId,
      transactionId: null,
      kind: 'expire' as const,
      quantity: -batch.quantity,
      occurredOn: batch.expiresOn,
      status: 'posted' as const,
      source: 'system' as const,
      batchId: batch.batchId,
      expiresOn: null,
      note: `Expired on ${batch.expiresOn}`,
      createdAt: now,
    })),
  );
  return due.length;
}

export interface ExpiringSoonRow {
  programId: string;
  cardName: string;
  unit: string;
  expiringSoon: number;
  nextExpiryOn: string | null;
}

/**
 * Every program holding points that die soon, for the warning on the dashboard.
 *
 * This only reports. Writing dead points off happens when a card is opened, so that looking at a
 * summary never changes what it is summarising.
 */
export async function expiringSoonAcross(database: Database, ws: WorkspaceContext, today: string): Promise<ExpiringSoonRow[]> {
  const programs = await database.db
    .select({ id: rewardPrograms.id, cardAccountId: rewardPrograms.cardAccountId, unit: rewardPrograms.unit })
    .from(rewardPrograms)
    .where(eq(rewardPrograms.workspaceId, ws.workspaceId));
  if (programs.length === 0) return [];

  const cards = new Map(
    (await database.db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId))).map((row) => [
      row.id,
      row.name,
    ]),
  );

  const rows: ExpiringSoonRow[] = [];
  for (const program of programs) {
    const balance = balanceOf(await listPointEntries(database, ws, program.id), today);
    if (balance.expiringSoon <= 0) continue;
    rows.push({
      programId: program.id,
      cardName: cards.get(program.cardAccountId) ?? 'Card',
      unit: program.unit,
      expiringSoon: balance.expiringSoon,
      nextExpiryOn: balance.nextExpiryOn,
    });
  }
  return rows.sort((a, b) => (a.nextExpiryOn ?? '').localeCompare(b.nextExpiryOn ?? ''));
}

export interface RecordRedemptionInput {
  programId: string;
  /** Spending them on something, or moving them to an airline. */
  kind: 'redeem' | 'transfer';
  points: number;
  occurredOn: string;
  note: string | null;
  /** What it fetched, when that is known. */
  valueMinor: number | null;
}

/**
 * Spends points, drawing from the batches that die soonest so nothing is lost to expiry that could
 * have been used. One entry per batch, each naming the batch it came from, so the remaining life of
 * what is left stays correct.
 */
export async function recordRedemption(database: Database, ws: WorkspaceContext, input: RecordRedemptionInput): Promise<void> {
  const entries = await listPointEntries(database, ws, input.programId);
  let taken: { batchId: string; quantity: number }[];
  try {
    taken = consumeFifo(entries, input.points, input.occurredOn);
  } catch (error) {
    // The ledger's refusal is the repo's refusal; callers already handle PointsError.
    throw error instanceof LedgerError ? new PointsError(error.message) : error;
  }

  const now = new Date().toISOString();
  await database.db.insert(pointEntries).values(
    taken.map((batch, index) => ({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      programId: input.programId,
      transactionId: null,
      kind: input.kind,
      quantity: -batch.quantity,
      occurredOn: input.occurredOn,
      status: 'posted' as const,
      source: 'manual' as const,
      batchId: batch.batchId,
      expiresOn: null,
      note: input.note,
      // One act with one value: it sits on the first entry rather than being split into per-batch
      // precision that was never measured. Summing the column still gives the right total.
      valueMinor: index === 0 ? input.valueMinor : null,
      createdAt: now,
    })),
  );
}

export interface CardYearRoi extends FeeRoi {
  from: string;
  to: string;
  /** Whether the year runs from a fee actually charged, or is the trailing twelve months. */
  anchoredOn: 'fee' | 'assumed';
}

const shiftDate = (date: string, years: number, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year! + years, month! - 1, day! + days)).toISOString().slice(0, 10);
};

/**
 * What this card's year of points was worth against its annual fee.
 *
 * The year runs from the day the fee was charged, because that is the money being judged. With no fee
 * charge in the ledger, the trailing twelve months stand in and the figure says so.
 */
export async function cardYearRoi(database: Database, ws: WorkspaceContext, programId: string, today: string): Promise<CardYearRoi> {
  const [program] = await database.db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new PointsError('Reward program not found');

  const keys = await categoryIdsByKey(database, ws);
  const feeCategoryId = keys['fees.card_annual'];
  const charges = feeCategoryId
    ? await database.db.values<[string, number]>(sql`
        SELECT t.occurred_on, e.amount_minor
        FROM entries e
        JOIN transactions t ON t.id = e.transaction_id
        WHERE e.workspace_id = ${ws.workspaceId}
          AND t.status = 'posted'
          AND e.account_id = ${feeCategoryId}
          AND t.occurred_on <= ${today}
          AND EXISTS (SELECT 1 FROM entries c WHERE c.transaction_id = t.id AND c.account_id = ${program.cardAccountId})
        ORDER BY t.occurred_on DESC
        LIMIT 1
      `)
    : [];

  const [terms] = await database.db
    .select({ annualFeeMinor: cardTerms.annualFeeMinor })
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, program.cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));

  const charge = charges[0];
  const from = charge ? String(charge[0]) : shiftDate(today, -1, 1);
  const to = charge ? shiftDate(String(charge[0]), 1, -1) : today;
  const annualFeeMinor = charge ? Number(charge[1]) : (terms?.annualFeeMinor ?? 0);

  const best = bestRedemption((await listRedemptionOptions(database, ws, programId)).map(toRedemption));
  const valuePerPointMicro = best ? Math.round((best.valueMinor * 1_000_000) / best.perPoints) : 0;

  const roi = feeRoi({ entries: await listPointEntries(database, ws, programId), from, to, valuePerPointMicro, annualFeeMinor });
  return { ...roi, from, to, anchoredOn: charge ? 'fee' : 'assumed' };
}
