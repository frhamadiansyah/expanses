import { currencyInfo, type EarnRule, type Redemption, type RuleMatch, type SpendLine, uuidv7 } from '@expanses/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardTerms, cycleActuals, earnRules, redemptionOptions, rewardPrograms } from '../schema-points';

export class PointsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PointsError';
  }
}

export type CardTermsRow = typeof cardTerms.$inferSelect;
export type RewardProgramRow = typeof rewardPrograms.$inferSelect;
export type RedemptionOptionRow = typeof redemptionOptions.$inferSelect;

async function requireCard(db: Db, ws: WorkspaceContext, accountId: string) {
  const [card] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!card || card.subtype !== 'credit_card') throw new PointsError('Account is not a credit card in this workspace');
  return card;
}

async function requireProgram(db: Db, ws: WorkspaceContext, programId: string): Promise<RewardProgramRow> {
  const [program] = await db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new PointsError('Reward program not found');
  return program;
}

const day = (n: number, label: string) => {
  if (!Number.isInteger(n) || n < 1 || n > 31) throw new PointsError(`${label} must be a day 1-31`);
  return n;
};

export async function getCardTerms(database: Database, ws: WorkspaceContext, accountId: string): Promise<CardTermsRow | undefined> {
  const [row] = await database.db
    .select()
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, accountId), eq(cardTerms.workspaceId, ws.workspaceId)));
  return row;
}

export async function listCardTerms(database: Database, ws: WorkspaceContext): Promise<CardTermsRow[]> {
  return database.db.select().from(cardTerms).where(eq(cardTerms.workspaceId, ws.workspaceId));
}

export async function saveCardTerms(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; statementDay: number; dueDay: number; creditLimitMinor: number | null; annualFeeMinor: number | null },
): Promise<void> {
  const row: CardTermsRow = {
    accountId: input.accountId,
    workspaceId: ws.workspaceId,
    statementDay: day(input.statementDay, 'Statement day'),
    dueDay: day(input.dueDay, 'Due day'),
    creditLimitMinor: input.creditLimitMinor,
    annualFeeMinor: input.annualFeeMinor,
  };
  await database.transaction(async (tx) => {
    await requireCard(tx, ws, input.accountId);
    await tx
      .insert(cardTerms)
      .values(row)
      .onConflictDoUpdate({
        target: cardTerms.accountId,
        set: { statementDay: row.statementDay, dueDay: row.dueDay, creditLimitMinor: row.creditLimitMinor, annualFeeMinor: row.annualFeeMinor },
      });
  });
}

export async function listPrograms(database: Database, ws: WorkspaceContext): Promise<RewardProgramRow[]> {
  return database.db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.workspaceId, ws.workspaceId), isNull(rewardPrograms.archivedAt)))
    .orderBy(asc(rewardPrograms.createdAt));
}

export async function createProgram(
  database: Database,
  ws: WorkspaceContext,
  input: { cardAccountId: string; name: string; unit: RewardProgramRow['unit']; cycleAnchor: RewardProgramRow['cycleAnchor'] },
): Promise<RewardProgramRow> {
  const name = input.name.trim();
  if (!name) throw new PointsError('Program name is required');
  const row: RewardProgramRow = { id: uuidv7(), workspaceId: ws.workspaceId, cardAccountId: input.cardAccountId, name, unit: input.unit, cycleAnchor: input.cycleAnchor, catalogEntryId: null, catalogEntryVersion: null, catalogStatus: null, catalogDismissedVersion: null, catalogSnapshotJson: null, archivedAt: null, createdAt: new Date().toISOString() };
  await database.transaction(async (tx) => {
    await requireCard(tx, ws, input.cardAccountId);
    await tx.insert(rewardPrograms).values(row);
  });
  return row;
}

export async function listEarnRules(database: Database, ws: WorkspaceContext, programId: string): Promise<EarnRule[]> {
  const rows = await database.db
    .select()
    .from(earnRules)
    .where(and(eq(earnRules.programId, programId), eq(earnRules.workspaceId, ws.workspaceId), isNull(earnRules.archivedAt)))
    .orderBy(asc(earnRules.priority), asc(earnRules.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    stackable: r.stackable === 1,
    match: JSON.parse(r.matchJson) as RuleMatch,
    rateNum: r.rateNum,
    rateDen: r.rateDen,
    rounding: r.rounding,
    capSpendMinor: r.capSpendMinor,
    capPoints: r.capPoints,
    minTransactionMinor: r.minTransactionMinor,
    validFrom: r.validFrom,
    validTo: r.validTo,
  }));
}

export type EarnRuleInput = Omit<EarnRule, 'id'> & { id?: string };

/** Rules are configuration, not ledger history: saving an existing id updates it in place. */
export async function saveEarnRule(database: Database, ws: WorkspaceContext, programId: string, rule: EarnRuleInput): Promise<string> {
  if (!rule.name.trim()) throw new PointsError('Rule name is required');
  if (!Number.isInteger(rule.rateNum) || rule.rateNum < 0) throw new PointsError('Points must be a whole number ≥ 0');
  if (!Number.isInteger(rule.rateDen) || rule.rateDen <= 0) throw new PointsError('Spend per points must be a whole number > 0');
  const values = {
    name: rule.name.trim(),
    priority: rule.priority,
    stackable: rule.stackable ? 1 : 0,
    matchJson: JSON.stringify(rule.match ?? {}),
    rateNum: rule.rateNum,
    rateDen: rule.rateDen,
    rounding: rule.rounding,
    capSpendMinor: rule.capSpendMinor,
    capPoints: rule.capPoints,
    minTransactionMinor: rule.minTransactionMinor,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
  };
  return database.transaction(async (tx) => {
    await requireProgram(tx, ws, programId);
    if (rule.id) {
      await tx.update(earnRules).set(values).where(and(eq(earnRules.id, rule.id), eq(earnRules.workspaceId, ws.workspaceId)));
      return rule.id;
    }
    const id = uuidv7();
    await tx.insert(earnRules).values({ ...values, id, workspaceId: ws.workspaceId, programId, archivedAt: null, createdAt: new Date().toISOString() });
    return id;
  });
}

export async function archiveEarnRule(database: Database, ws: WorkspaceContext, ruleId: string): Promise<void> {
  await database.db
    .update(earnRules)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(earnRules.id, ruleId), eq(earnRules.workspaceId, ws.workspaceId)));
}

export async function listRedemptionOptions(database: Database, ws: WorkspaceContext, programId: string): Promise<RedemptionOptionRow[]> {
  return database.db
    .select()
    .from(redemptionOptions)
    .where(and(eq(redemptionOptions.programId, programId), eq(redemptionOptions.workspaceId, ws.workspaceId)));
}

export async function saveRedemptionOption(
  database: Database,
  ws: WorkspaceContext,
  input: { id?: string; programId: string; name: string; type: RedemptionOptionRow['type']; valueMinor: number; perPoints: number; currency: string },
): Promise<string> {
  currencyInfo(input.currency);
  if (!Number.isSafeInteger(input.valueMinor) || input.valueMinor <= 0) throw new PointsError('Value must be a positive amount');
  if (!Number.isInteger(input.perPoints) || input.perPoints <= 0) throw new PointsError('Points must be a whole number > 0');
  const values = { name: input.name.trim() || 'Redemption', type: input.type, valueMinor: input.valueMinor, perPoints: input.perPoints, currency: input.currency };
  return database.transaction(async (tx) => {
    await requireProgram(tx, ws, input.programId);
    if (input.id) {
      await tx.update(redemptionOptions).set(values).where(and(eq(redemptionOptions.id, input.id), eq(redemptionOptions.workspaceId, ws.workspaceId)));
      return input.id;
    }
    const id = uuidv7();
    await tx.insert(redemptionOptions).values({ ...values, id, workspaceId: ws.workspaceId, programId: input.programId });
    return id;
  });
}

export async function deleteRedemptionOption(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db.delete(redemptionOptions).where(and(eq(redemptionOptions.id, id), eq(redemptionOptions.workspaceId, ws.workspaceId)));
}

export const toRedemption = (row: RedemptionOptionRow): Redemption => ({ valueMinor: row.valueMinor, perPoints: row.perPoints, currency: row.currency });

export async function recordCycleActual(
  database: Database,
  ws: WorkspaceContext,
  input: { programId: string; cycleStart: string; actualPoints: number },
): Promise<void> {
  if (!Number.isInteger(input.actualPoints) || input.actualPoints < 0) throw new PointsError('Actual points must be a whole number ≥ 0');
  await database.transaction(async (tx) => {
    await requireProgram(tx, ws, input.programId);
    await tx
      .insert(cycleActuals)
      .values({ workspaceId: ws.workspaceId, programId: input.programId, cycleStart: input.cycleStart, actualPoints: input.actualPoints, recordedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [cycleActuals.programId, cycleActuals.cycleStart],
        set: { actualPoints: input.actualPoints, recordedAt: new Date().toISOString() },
      });
  });
}

export async function listCycleActuals(database: Database, ws: WorkspaceContext, programId: string) {
  return database.db
    .select({ cycleStart: cycleActuals.cycleStart, actualPoints: cycleActuals.actualPoints, recordedAt: cycleActuals.recordedAt })
    .from(cycleActuals)
    .where(and(eq(cycleActuals.programId, programId), eq(cycleActuals.workspaceId, ws.workspaceId)));
}

/** Expense entries of posted transactions charged to the card within [from, to]. Statement payments have no expense entries and never appear. */
export async function cardSpendLines(database: Database, ws: WorkspaceContext, cardAccountId: string, from: string, to: string): Promise<SpendLine[]> {
  const rows = await database.db.values<[string, string, string, string, string, number, string]>(sql`
    SELECT t.id, e.id, t.occurred_on, e.account_id, t.description, e.amount_minor, e.currency
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id
    JOIN accounts a ON a.id = e.account_id
    WHERE e.workspace_id = ${ws.workspaceId}
      AND t.status = 'posted'
      AND a.kind = 'expense'
      AND t.occurred_on BETWEEN ${from} AND ${to}
      AND EXISTS (SELECT 1 FROM entries c WHERE c.transaction_id = t.id AND c.account_id = ${cardAccountId} AND c.amount_minor < 0)
    ORDER BY t.occurred_on, t.id, e.id
  `);
  return rows.map(([transactionId, entryId, occurredOn, categoryId, description, amountMinor, currency]) => ({
    transactionId,
    entryId,
    occurredOn,
    categoryId,
    description,
    amountMinor: Number(amountMinor),
    currency,
    originalCurrency: null,
  }));
}
