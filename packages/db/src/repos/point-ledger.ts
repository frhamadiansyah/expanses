import {
  type Balance,
  balanceOf,
  spendableOf,
  bestRedemption,
  categoryAncestors,
  computeCycleEarn,
  consumeFifo,
  type Cycle,
  cycleFor,
  dueToExpire,
  type ExpiryPolicy,
  expiresOn as expiryDateFor,
  type FeeRoi,
  feeRoi,
  LedgerError,
  type PointEntry,
  previousCycle,
  uuidv7,
} from '@expanses/core';
import { and, eq, getTableColumns, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { earnsInto, pointEntries, pointProgrammes, pointSnapshots, rewardPrograms } from '../schema-points';
import { findProgramme, programmeIdOf, programmesExist, readProgrammeValues } from './programme-link';
import { listAccounts } from './accounts';
import { listTransactionPointActuals } from './point-actuals';
import { categoryIdsByKeyAll } from './categories';
import { cardTerms } from '../schema-points';
import { cardSpendLines, listCycleActuals, listCycleBonuses, listEarnRules, listRedemptionOptions, PointsError, toRedemption } from './points';

/** Entries the derivation owns and may rewrite. Everything else is the owner's own record. */
const DERIVED_SOURCES = ['transaction', 'statement', 'projected'] as const;

export interface PointEntryRow extends PointEntry {
  /** The balance programme the entry sits in (0085). */
  programId: string;
  transactionId: string | null;
  note: string | null;
  /** What a redemption fetched, when the owner recorded it. */
  valueMinor: number | null;
  /** The card's reward program whose rules earned this; null on anything but an earn. */
  earnedById: string | null;
  /** Shared by the two sides of one conversion between programmes. */
  conversionId: string | null;
}

export interface RecordSnapshotInput {
  /** The balance programme. */
  programId: string;
  /** The balance the owner read in the issuer's app. */
  balance: number;
  observedOn: string;
  /**
   * Roughly when those points were earned, which decides when they die under the program's policy.
   * Defaults to the day they were typed in — the only date the app can know without being told, and
   * a generous one, but far better than a lump that never expires while everything around it does.
   */
  earnedOn?: string;
}

export async function listPointEntries(database: Database, ws: WorkspaceContext, programId: string): Promise<PointEntryRow[]> {
  // A database stopped before 0085 (a migration test reading its figures before the update) has no columns for the
  // card that earned an entry or the conversion it belongs to; it reads every entry as neither.
  const { earnedById, conversionId, ...before0085 } = getTableColumns(pointEntries);
  const columns = (await programmesExist(database.db)) ? { ...before0085, earnedById, conversionId } : { ...before0085, earnedById: sql<null>`NULL`, conversionId: sql<null>`NULL` };
  const rows = await database.db
    .select(columns)
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
    earnedById: row.earnedById,
    conversionId: row.conversionId,
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
 *
 * `programId` is the card's reward program. Its points land in the programme it earns into (0085), each entry naming
 * the card that earned it, so a second card earning into the same programme never has its points rewritten by this
 * one. What the card earned is replaced wherever it sits, so a cycle worked out again after the card moved to another
 * programme lands in that one.
 */
export async function deriveCycleEntries(database: Database, ws: WorkspaceContext, programId: string, cycle: Cycle): Promise<number> {
  const [program] = await database.db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new PointsError('Reward program not found');
  const programmeId = await programmeIdOf(database.db, ws, programId);
  // The programme decides how the points die; a database without programmes yet has the policy on the program.
  const policy = (await findProgramme(database.db, ws, programmeId)) ?? program;

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
    programId: programmeId,
    transactionId: input.transactionId,
    kind: 'earn' as const,
    quantity: input.quantity,
    occurredOn: input.occurredOn,
    status: input.status,
    source: input.source,
    batchId: null,
    // Stamped from the programme's policy, so changing the policy restamps on the next derivation.
    expiresOn: expiryDateFor(input.occurredOn, policy.expiryPolicy, policy.expiryMonths),
    note: null,
    earnedById: programId,
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
          eq(pointEntries.earnedById, programId),
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

  const program = await findProgramme(database.db, ws, input.programId);
  if (!program) throw new PointsError('Points programme not found');
  // Points typed in are a batch like any other, so they age under the same policy.
  const anchoredExpiry = expiryDateFor(input.earnedOn ?? input.observedOn, program.expiryPolicy, program.expiryMonths);

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
    // Only a correction upward opens a batch, so only that one carries a date.
    expiresOn: quantity > 0 ? anchoredExpiry : null,
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

/** How this programme's points die. Setting a policy restamps the batches next time they are derived. */
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
    .update(pointProgrammes)
    // A month count left behind by an earlier policy would be read again if that policy came back.
    .set({ expiryPolicy: policy, expiryMonths: policy === 'months_from_earn' ? months : null })
    .where(and(eq(pointProgrammes.id, programId), eq(pointProgrammes.workspaceId, ws.workspaceId)));
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
  /** The balance programme. */
  programId: string;
  /** What the warning names: the one card earning into the programme, else the programme itself. */
  cardName: string;
  unit: string;
  expiringSoon: number;
  nextExpiryOn: string | null;
}

/**
 * Every programme holding points that die soon, for the warning on the dashboard.
 *
 * This only reports. Writing dead points off happens when a card or a programme is opened, so that
 * looking at a summary never changes what it is summarising.
 */
export async function expiringSoonAcross(database: Database, ws: WorkspaceContext, today: string): Promise<ExpiringSoonRow[]> {
  const programmes = await database.db
    .select({ id: pointProgrammes.id, name: pointProgrammes.name, unit: pointProgrammes.unit })
    .from(pointProgrammes)
    .where(and(eq(pointProgrammes.workspaceId, ws.workspaceId), isNull(pointProgrammes.archivedAt)));
  if (programmes.length === 0) return [];

  // The cards earning into each programme, by name: a programme one card earns into is still called by that card.
  const earners = await database.db
    .select({ programmeId: earnsInto.programmeId, name: accounts.name })
    .from(earnsInto)
    .innerJoin(rewardPrograms, eq(rewardPrograms.id, earnsInto.programId))
    .innerJoin(accounts, eq(accounts.id, rewardPrograms.cardAccountId))
    .where(and(eq(earnsInto.workspaceId, ws.workspaceId), isNull(rewardPrograms.archivedAt)));

  const rows: ExpiringSoonRow[] = [];
  for (const programme of programmes) {
    const balance = balanceOf(await listPointEntries(database, ws, programme.id), today);
    if (balance.expiringSoon <= 0) continue;
    const cards = earners.filter((earner) => earner.programmeId === programme.id);
    rows.push({
      programId: programme.id,
      cardName: cards.length === 1 ? cards[0]!.name : programme.name,
      unit: programme.unit,
      expiringSoon: balance.expiringSoon,
      nextExpiryOn: balance.nextExpiryOn,
    });
  }
  return rows.sort((a, b) => (a.nextExpiryOn ?? '').localeCompare(b.nextExpiryOn ?? ''));
}

export interface RecordRedemptionInput {
  /** The balance programme the points are spent from. */
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
  /** The same year valued at what redemptions have actually fetched. Null until one records a value. */
  realised: FeeRoi | null;
}

/**
 * Works out the cycles a card page never looked at.
 *
 * Derivation is lazy — a card fills only the cycles it shows — so points earned before the app was
 * opened on that card are not in the ledger, and expiry cannot see them. This walks back and derives
 * each cycle in turn.
 *
 * It invents nothing: the same rules over purchases already recorded. A card whose history was never
 * entered has nothing to find, and a balance read from the issuer's app is the answer there instead.
 */
export async function backfillCycles(database: Database, ws: WorkspaceContext, programId: string, cycles: number, today: string): Promise<number> {
  return (await walkCycles(database, ws, programId, cycles, today)).walked;
}

/**
 * Catch-up as the owner sees it: the same walk back, reporting how many statements it added — cycles that held no earning
 * for this card before and hold some now. A cycle already worked out, or one with no purchases on the card, adds none,
 * so a second run, or a card with nothing older than its first statement, reports nothing.
 */
export async function catchUpCard(database: Database, ws: WorkspaceContext, programId: string, cycles: number, today: string): Promise<{ added: number }> {
  const { added } = await walkCycles(database, ws, programId, cycles, today);
  return { added };
}

async function walkCycles(database: Database, ws: WorkspaceContext, programId: string, cycles: number, today: string): Promise<{ walked: number; added: number }> {
  const [program] = await database.db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new PointsError('Reward program not found');
  const [terms] = await database.db
    .select({ statementDay: cardTerms.statementDay })
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, program.cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));

  const statementDay = terms?.statementDay ?? 1;
  let cycle = cycleFor(today, program.cycleAnchor, statementDay);
  let walked = 0;
  let added = 0;
  for (let index = 0; index < Math.max(0, Math.floor(cycles)); index += 1) {
    const [before] = await database.db
      .select({ n: sql<number>`count(*)` })
      .from(pointEntries)
      .where(
        and(
          eq(pointEntries.workspaceId, ws.workspaceId),
          eq(pointEntries.earnedById, programId),
          eq(pointEntries.kind, 'earn'),
          gte(pointEntries.occurredOn, cycle.start),
          lte(pointEntries.occurredOn, cycle.end),
        ),
      );
    const wrote = await deriveCycleEntries(database, ws, programId, cycle);
    walked += 1;
    if (Number(before?.n ?? 0) === 0 && wrote > 0) added += 1;
    cycle = previousCycle(cycle, program.cycleAnchor, statementDay);
  }
  return { walked, added };
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

  // The fee is the card's, whichever workspace it was filed in, so every copy of the fee category counts.
  const keys = await categoryIdsByKeyAll(database, ws);
  const feeCategoryIds = keys['miscellaneous.membership_fee'] ?? [];
  const charges = feeCategoryIds.length
    ? await database.db.values<[string, number]>(sql`
        SELECT t.occurred_on, e.amount_minor
        FROM entries e
        JOIN transactions t ON t.id = e.transaction_id
        WHERE e.workspace_id = ${ws.workspaceId}
          AND t.status = 'posted'
          AND e.account_id IN (${sql.join(feeCategoryIds.map((id) => sql`${id}`), sql`, `)})
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

  // The programme's value per point (0105) when set, else the best option the card lists.
  const valueScaled = (await readProgrammeValues(database, ws))[await programmeIdOf(database.db, ws, programId)] ?? null;
  const best = bestRedemption((await listRedemptionOptions(database, ws, programId)).map(toRedemption));
  const valuePerPointMicro = valueScaled !== null ? valueScaled * 100 : best ? Math.round((best.valueMinor * 1_000_000) / best.perPoints) : 0;

  // The card's year is the card's own earning: in a programme other cards also earn into, only this card's points
  // count. Spending, expiry and conversions are the programme's, and feeRoi leaves them out anyway.
  const ledger = await listPointEntries(database, ws, await programmeIdOf(database.db, ws, programId));
  const entries = ledger.filter((entry) => entry.kind !== 'earn' || entry.earnedById === programId);
  const roi = feeRoi({ entries, from, to, valuePerPointMicro, annualFeeMinor });

  // What points have really fetched, over every redemption that recorded a value — not only this
  // year, because how the owner redeems is a habit rather than a property of one card year.
  const withValue = entries.filter((entry) => entry.valueMinor !== null && entry.quantity < 0);
  const spent = withValue.reduce((total, entry) => total - entry.quantity, 0);
  const fetched = withValue.reduce((total, entry) => total + (entry.valueMinor ?? 0), 0);
  const realised =
    spent > 0
      ? feeRoi({ entries, from, to, valuePerPointMicro: Math.round((fetched * 1_000_000) / spent), annualFeeMinor })
      : null;

  return { ...roi, from, to, anchoredOn: charge ? 'fee' : 'assumed', realised };
}
