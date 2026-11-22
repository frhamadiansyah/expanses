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
import type { Database, Tx } from '../database';
import { accounts } from '../schema';
import { earnsInto, pointEntries, pointProgrammes, pointSnapshots, rewardPrograms } from '../schema-points';
import { findProgramme, programmeIdOf, programmesExist, readProgrammeValues } from './programme-link';
import { listAccounts } from './accounts';
import { listTransactionPointActuals } from './point-actuals';
import { categoryIdsByKeyAll } from './categories';
import { cardTerms } from '../schema-points';
import { cardSpendLines, listCycleActuals, listCycleBonuses, listEarnRules, listRedemptionOptions, PointsError, toRedemption } from './points';
import { stableId } from '../self/stable-id';

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
    // Each entry keeps its id from one working-out to the next: a write-off or a redemption names the batch it drew on
    // by that id, so a batch written again under a new one would look full again and die a second time.
    const existing = await tx
      .select({ id: pointEntries.id, transactionId: pointEntries.transactionId, occurredOn: pointEntries.occurredOn, quantity: pointEntries.quantity, status: pointEntries.status, source: pointEntries.source, expiresOn: pointEntries.expiresOn, programId: pointEntries.programId })
      .from(pointEntries)
      .where(
        and(
          eq(pointEntries.workspaceId, ws.workspaceId),
          eq(pointEntries.earnedById, programId),
          eq(pointEntries.kind, 'earn'),
          inArray(pointEntries.source, [...DERIVED_SOURCES]),
          gte(pointEntries.occurredOn, cycle.start),
          lte(pointEntries.occurredOn, cycle.end),
        ),
      )
      .orderBy(pointEntries.id);
    // The same purchase on the same day is the same batch, whatever the evidence for its figure: the issuer's figure
    // replacing the app's own keeps the batch, and what was drawn on it.
    const keyOf = (entry: { transactionId: string | null; occurredOn: string }) => `${entry.transactionId ?? ''}|${entry.occurredOn}`;
    const unmatched = new Map<string, (typeof existing)[number][]>();
    for (const entry of existing) unmatched.set(keyOf(entry), [...(unmatched.get(keyOf(entry)) ?? []), entry]);

    const added: ReturnType<typeof row>[] = [];
    const changed: string[] = [];
    for (const entry of fresh) {
      const kept = unmatched.get(keyOf(entry))?.shift();
      if (!kept) {
        added.push(entry);
        continue;
      }
      entry.id = kept.id;
      const same = kept.quantity === entry.quantity && kept.status === entry.status && kept.source === entry.source && kept.expiresOn === entry.expiresOn && kept.programId === entry.programId;
      if (same) continue;
      await tx
        .update(pointEntries)
        .set({ programId: entry.programId, quantity: entry.quantity, status: entry.status, source: entry.source, expiresOn: entry.expiresOn })
        .where(eq(pointEntries.id, kept.id));
      if (kept.quantity !== entry.quantity || kept.expiresOn !== entry.expiresOn) changed.push(kept.id);
    }
    const gone = [...unmatched.values()].flat().map((entry) => entry.id);
    if (gone.length > 0) await tx.delete(pointEntries).where(inArray(pointEntries.id, gone));
    if (added.length > 0) {
      // A new batch is named by the purchase, the day and what it is (link my devices, Drop 0): two linked devices
      // working out the same cycle make the same batch, not one each.
      const seen = new Map<string, number>();
      for (const entry of added) {
        const name = `earn:${entry.source}:${keyOf(entry)}`;
        const n = seen.get(name) ?? 0;
        seen.set(name, n + 1);
        entry.id = await stableId(programId, `${name}:${n}`);
      }
      await tx.insert(pointEntries).values(added);
    }
    await mendBatchesTx(tx, ws, gone, changed);
  });

  return fresh.length;
}

/** A write-off is the app's own act, worked out again from the batches whenever it is missing. */
const isWriteOff = and(eq(pointEntries.kind, 'expire'), eq(pointEntries.source, 'system'));

/**
 * After batches went away (`gone`) or changed figure or date (`changed`): their write-offs are dropped, for
 * `expireDueEntries` to write again from what the batch now holds, and whatever else drew on a batch that went away
 * is drawn again from the batches still there (`redrawTx`).
 */
async function mendBatchesTx(tx: Tx, ws: WorkspaceContext, gone: string[], changed: string[]): Promise<void> {
  const touched = [...gone, ...changed];
  if (touched.length === 0) return;
  await tx.delete(pointEntries).where(and(eq(pointEntries.workspaceId, ws.workspaceId), isWriteOff, inArray(pointEntries.batchId, touched)));
  if (gone.length === 0) return;
  const orphans = await tx
    .select()
    .from(pointEntries)
    .where(and(eq(pointEntries.workspaceId, ws.workspaceId), inArray(pointEntries.batchId, gone)));
  await redrawTx(tx, ws, orphans);
}

/**
 * Draws each spending, conversion out or correction downward whose batch no longer exists from the batches that were
 * live on its day, soonest to die first, as `recordRedemption` would have. One that spans batches becomes one entry per
 * batch, as a redemption is written; what no live batch can cover stays in the total, drawn on no batch. The
 * write-offs of the batches drawn on are dropped, to be written again from what each now holds.
 */
async function redrawTx(tx: Tx, ws: WorkspaceContext, orphans: (typeof pointEntries.$inferSelect)[]): Promise<void> {
  const ordered = [...orphans].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const drawnOn = new Set<string>();
  for (const orphan of ordered) {
    const wanted = -orphan.quantity;
    if (!(wanted > 0)) {
      await tx.update(pointEntries).set({ batchId: null }).where(eq(pointEntries.id, orphan.id));
      continue;
    }
    // What was live on the day, before anything was written off: a write-off is dated when its batch died.
    const ledger = (await tx.select().from(pointEntries).where(and(eq(pointEntries.workspaceId, ws.workspaceId), eq(pointEntries.programId, orphan.programId))))
      .filter((entry) => entry.id !== orphan.id && !(entry.kind === 'expire' && entry.source === 'system'));
    const take = Math.min(wanted, spendableOf(ledger, orphan.occurredOn));
    let pieces: { batchId: string | null; quantity: number }[] = [];
    try {
      if (take > 0) pieces = consumeFifo(ledger, take, orphan.occurredOn);
    } catch {
      // A rounding hair short of the batches' sum: left on no batch, the total is still right.
      pieces = [];
    }
    const drawn = pieces.reduce((total, piece) => total + piece.quantity, 0);
    if (wanted - drawn > 1e-9 || pieces.length === 0) pieces.push({ batchId: null, quantity: wanted - drawn });
    const [first, ...rest] = pieces;
    await tx.update(pointEntries).set({ batchId: first!.batchId, quantity: -first!.quantity }).where(eq(pointEntries.id, orphan.id));
    if (rest.length > 0) {
      // The act's value stays on its first entry, as a redemption is written.
      // Named by the entry it was cut from (link my devices, Drop 0), so two linked devices cut it alike.
      const pieces = await Promise.all(
        rest.map(async (piece, i) => ({ ...orphan, id: await stableId(orphan.id, `redraw:${i}:${piece.batchId ?? ''}`), batchId: piece.batchId, quantity: -piece.quantity, valueMinor: null })),
      );
      await tx.insert(pointEntries).values(pieces);
    }
    for (const piece of pieces) if (piece.batchId !== null) drawnOn.add(piece.batchId);
  }
  if (drawnOn.size > 0) {
    await tx.delete(pointEntries).where(and(eq(pointEntries.workspaceId, ws.workspaceId), isWriteOff, inArray(pointEntries.batchId, [...drawnOn])));
  }
}

/**
 * Mends a programme's ledger an earlier build left wrong. That build wrote a cycle's batches again under new ids each
 * time the cycle was worked out, leaving write-offs and spending that name a batch no longer there: the batch under its
 * new id looked full and died again, and the balance fell with every refresh. Write-offs of a missing batch are dropped
 * (`expireDueEntries` writes the one still due), and spending left on one is drawn again from the batches still there.
 * Nothing the owner typed is removed. Costs one query when there is nothing to mend.
 */
async function mendOrphansTx(tx: Tx, ws: WorkspaceContext, programId: string): Promise<void> {
  const missingBatch = sql`NOT EXISTS (SELECT 1 FROM point_entries b WHERE b.id = point_entries.batch_id)`;
  const orphans = await tx.values<[string]>(sql`
    SELECT id FROM point_entries
    WHERE workspace_id = ${ws.workspaceId} AND program_id = ${programId} AND batch_id IS NOT NULL AND ${missingBatch}
    LIMIT 1
  `);
  if (orphans.length === 0) return;
  await tx.run(sql`
    DELETE FROM point_entries
    WHERE workspace_id = ${ws.workspaceId} AND program_id = ${programId} AND kind = 'expire' AND source = 'system'
      AND batch_id IS NOT NULL AND ${missingBatch}
  `);
  const spending = await tx.select().from(pointEntries).where(and(eq(pointEntries.workspaceId, ws.workspaceId), eq(pointEntries.programId, programId), sql`${pointEntries.batchId} IS NOT NULL`, missingBatch));
  if (spending.length > 0) await redrawTx(tx, ws, spending);
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
  await database.transaction((tx) => mendOrphansTx(tx, ws, programId));
  const due = dueToExpire(await listPointEntries(database, ws, programId), today);
  if (due.length === 0) return 0;

  const now = new Date().toISOString();
  // A write-off is named by its batch and day (link my devices, Drop 0): two linked devices writing off the same batch
  // write one write-off, and the points die once.
  const ids = await Promise.all(due.map((batch) => stableId(programId, `expire:${batch.batchId ?? ''}:${batch.expiresOn}`)));
  await database.db.insert(pointEntries).values(
    due.map((batch, i) => ({
      id: ids[i]!,
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

/** A card's history reaches back only so far: fifty years of statements is a runaway, not a card. */
const MAX_CYCLES = 600;

/** The day of the earliest posted purchase on a card account: a transaction with an expense line charged to it. Null when none. */
export async function firstCardPurchaseOn(database: Database, ws: WorkspaceContext, cardAccountId: string): Promise<string | null> {
  const rows = await database.db.values<[string | null]>(sql`
    SELECT MIN(t.occurred_on)
    FROM transactions t
    WHERE t.workspace_id = ${ws.workspaceId}
      AND t.status = 'posted'
      -- The annual fee row the app adds for a fee charged before the app (card-fee.ts) is no purchase of the card's.
      AND (t.external_ref IS NULL OR t.external_ref NOT LIKE 'fee-before-app:%')
      AND EXISTS (SELECT 1 FROM entries c WHERE c.transaction_id = t.id AND c.account_id = ${cardAccountId})
      AND EXISTS (
        SELECT 1 FROM entries x JOIN accounts a ON a.id = x.account_id
        WHERE x.transaction_id = t.id AND (a.kind = 'expense' OR x.spend_category_id IS NOT NULL)
      )
  `);
  return rows[0]?.[0] ?? null;
}

/** The program row, or the refusal every caller already handles. */
async function programOf(database: Database, ws: WorkspaceContext, programId: string) {
  const [program] = await database.db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new PointsError('Reward program not found');
  return program;
}

/**
 * Works out every cycle of a card back to its first purchase, with no fixed limit, and reports how many statements it
 * added. Run again it changes nothing (a cycle's derived rows are replaced, never added to); a card with no purchase
 * has nothing to find.
 */
export async function catchUpAllCycles(database: Database, ws: WorkspaceContext, programId: string, today: string): Promise<{ added: number; walked: number; firstPurchaseOn: string | null }> {
  const program = await programOf(database, ws, programId);
  const firstPurchaseOn = await firstCardPurchaseOn(database, ws, program.cardAccountId);
  if (firstPurchaseOn === null) return { added: 0, walked: 0, firstPurchaseOn };
  return { ...(await walkCycles(database, ws, programId, 0, today, firstPurchaseOn)), firstPurchaseOn };
}

export interface CardStatementMonth {
  start: string;
  end: string;
  /** What the cycle's derived earning comes to. */
  points: number;
  /** True when the figure is the bank's (typed, or credited per purchase); false when it is the app's own working. */
  posted: boolean;
  /** The points typed from the bank statement, when there are any. */
  typed: number | null;
}

/**
 * A card's statements from the current cycle back to the one holding its first purchase, newest first, each with its
 * derived points and whether they are posted, and the days of any manual adjust or balance read inside that range —
 * which may already count some of the same points.
 */
export async function cardStatementMonths(
  database: Database,
  ws: WorkspaceContext,
  programId: string,
  today: string,
): Promise<{ firstPurchaseOn: string | null; months: CardStatementMonth[]; adjusts: string[] }> {
  const program = await programOf(database, ws, programId);
  const firstPurchaseOn = await firstCardPurchaseOn(database, ws, program.cardAccountId);
  if (firstPurchaseOn === null) return { firstPurchaseOn, months: [], adjusts: [] };
  const [terms] = await database.db
    .select({ statementDay: cardTerms.statementDay })
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, program.cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
  const statementDay = terms?.statementDay ?? 1;
  const programmeId = await programmeIdOf(database.db, ws, programId);
  const ledger = await listPointEntries(database, ws, programmeId);
  const mine = ledger.filter((entry) => entry.kind === 'earn' && entry.earnedById === programId);
  const typed = new Map((await listCycleActuals(database, ws, programId)).map((row) => [row.cycleStart, row.actualPoints]));

  const months: CardStatementMonth[] = [];
  let cycle = cycleFor(today, program.cycleAnchor, statementDay);
  for (let index = 0; index < MAX_CYCLES && cycle.end >= firstPurchaseOn; index += 1) {
    const inside = mine.filter((entry) => entry.occurredOn >= cycle.start && entry.occurredOn <= cycle.end);
    months.push({
      start: cycle.start,
      end: cycle.end,
      points: inside.reduce((total, entry) => total + entry.quantity, 0),
      posted: inside.length > 0 && inside.every((entry) => entry.status === 'posted'),
      typed: typed.get(cycle.start) ?? null,
    });
    cycle = previousCycle(cycle, program.cycleAnchor, statementDay);
  }
  const from = months[months.length - 1]!.start;
  const adjusts = [...new Set(ledger.filter((entry) => entry.kind === 'adjust' && (entry.source === 'manual' || entry.source === 'snapshot') && entry.occurredOn >= from && entry.occurredOn <= today).map((entry) => entry.occurredOn))].sort();
  return { firstPurchaseOn, months, adjusts };
}

/**
 * After a purchase on a card is saved, edited or voided: works out again the cycle each of its days falls in — the old
 * day and the new — when that cycle is older than the two a card page works out itself and was already worked out, so a
 * catch-up already done never goes stale. Nothing here may fail a save, so what goes wrong is left for the next catch-up.
 */
export async function rederiveCardCycles(database: Database, ws: WorkspaceContext, accountIds: readonly string[], dates: readonly string[], today: string = new Date().toISOString().slice(0, 10)): Promise<void> {
  try {
    if (accountIds.length === 0 || dates.length === 0) return;
    const programs = await database.db
      .select()
      .from(rewardPrograms)
      .where(and(eq(rewardPrograms.workspaceId, ws.workspaceId), inArray(rewardPrograms.cardAccountId, [...accountIds]), isNull(rewardPrograms.archivedAt)));
    for (const program of programs) {
      const [terms] = await database.db
        .select({ statementDay: cardTerms.statementDay })
        .from(cardTerms)
        .where(and(eq(cardTerms.accountId, program.cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
      const statementDay = terms?.statementDay ?? 1;
      const current = cycleFor(today, program.cycleAnchor, statementDay);
      const recent = previousCycle(current, program.cycleAnchor, statementDay);
      const [first] = await database.db
        .select({ on: sql<string | null>`min(${pointEntries.occurredOn})` })
        .from(pointEntries)
        .where(and(eq(pointEntries.workspaceId, ws.workspaceId), eq(pointEntries.earnedById, program.id), eq(pointEntries.kind, 'earn')));
      const earliest = first?.on ?? null;
      const seen = new Set<string>();
      for (const date of dates) {
        const cycle = cycleFor(date, program.cycleAnchor, statementDay);
        if (cycle.start >= recent.start || seen.has(cycle.start)) continue;
        seen.add(cycle.start);
        // Only the range already worked out is kept up to date: a cycle before the card's earliest derived earning, or
        // on a card nobody has caught up, waits for its catch-up.
        if (earliest === null || cycle.end < earliest) continue;
        await deriveCycleEntries(database, ws, program.id, cycle);
      }
    }
  } catch {
    // The save is already done; the next catch-up works the cycle out.
  }
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

async function walkCycles(
  database: Database,
  ws: WorkspaceContext,
  programId: string,
  cycles: number,
  today: string,
  /** Walk back until a cycle ends before this day, instead of for a fixed number of cycles. */
  until?: string,
): Promise<{ walked: number; added: number }> {
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
  const limit = until ? MAX_CYCLES : Math.max(0, Math.floor(cycles));
  for (let index = 0; index < limit; index += 1) {
    if (until && cycle.end < until) break;
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
