import { type Balance, balanceOf, categoryAncestors, computeCycleEarn, type Cycle, type PointEntry, uuidv7 } from '@expanses/core';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { pointEntries, pointSnapshots, rewardPrograms } from '../schema-points';
import { listAccounts } from './accounts';
import { listTransactionPointActuals } from './point-actuals';
import { cardSpendLines, listCycleActuals, listCycleBonuses, listEarnRules, PointsError } from './points';

/** Entries the derivation owns and may rewrite. Everything else is the owner's own record. */
const DERIVED_SOURCES = ['transaction', 'statement', 'projected'] as const;

export interface PointEntryRow extends PointEntry {
  programId: string;
  transactionId: string | null;
  note: string | null;
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
    // Expiry arrives with the policy; nothing dies while a program has none.
    expiresOn: null,
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

  const current = await programBalance(database, ws, input.programId, input.observedOn);
  const difference = input.balance - current.total;
  const now = new Date().toISOString();

  await database.transaction(async (tx) => {
    await tx.insert(pointSnapshots).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      programId: input.programId,
      balance: input.balance,
      observedOn: input.observedOn,
      createdAt: now,
    });
    if (difference === 0) return;
    await tx.insert(pointEntries).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      programId: input.programId,
      transactionId: null,
      kind: 'adjust',
      quantity: difference,
      occurredOn: input.observedOn,
      status: 'posted',
      source: 'snapshot',
      batchId: null,
      expiresOn: null,
      note: `Balance read as ${input.balance}`,
      createdAt: now,
    });
  });

  return difference;
}
