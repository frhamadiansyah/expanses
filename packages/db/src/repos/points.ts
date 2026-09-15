import {
  type BonusTier,
  currencyInfo,
  type CycleBonus,
  type EarnRule,
  type Redemption,
  cardFeeCategoryIds,
  isCardFee,
  resolveMcc,
  type RuleMatch,
  type SpendLine,
  type TransferPartner,
  uuidv7,
} from '@expanses/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { mccSourcesFor } from './mcc';
import { nonEarningInstallmentTransactionIds } from './installments';
import { cardTerms, cycleActuals, cycleBonuses, earnRules, redemptionOptions, rewardPrograms, transferPartners } from '../schema-points';

export class PointsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PointsError';
  }
}

export type CardTermsRow = typeof cardTerms.$inferSelect;
export type RewardProgramRow = typeof rewardPrograms.$inferSelect;
export type RedemptionOptionRow = typeof redemptionOptions.$inferSelect;

/** Catalogue-internal writes pass fromCatalog so a linked program stays linked. */
export interface PointsWriteOptions {
  fromCatalog?: boolean;
}

async function accountOf(db: Db, ws: WorkspaceContext, accountId: string) {
  const [card] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  return card;
}

/** A statement day, a due day and a credit limit are a credit card's, and only a credit card's. */
async function requireCard(db: Db, ws: WorkspaceContext, accountId: string) {
  const card = await accountOf(db, ws, accountId);
  if (!card || card.subtype !== 'credit_card') throw new PointsError('Account is not a credit card in this workspace');
  return card;
}

/**
 * An account that can earn: a credit card, or the bank account a debit card spends from.
 *
 * The rules run on the spend, not on the plastic, so a debit card earns the same way — it simply has no
 * terms to go with it.
 */
async function requireEarningCard(db: Db, ws: WorkspaceContext, accountId: string) {
  const card = await accountOf(db, ws, accountId);
  if (!card || !['credit_card', 'bank', 'savings'].includes(card.subtype)) {
    throw new PointsError('Account is not a card or a bank account in this workspace');
  }
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

/** A user change to a linked program's rules, bonuses, partners, or redemption options makes it customised. */
async function markCustomised(tx: Db, ws: WorkspaceContext, programId: string, options: PointsWriteOptions) {
  if (options.fromCatalog) return;
  await tx
    .update(rewardPrograms)
    .set({ catalogStatus: 'customised' })
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId), eq(rewardPrograms.catalogStatus, 'linked')));
}

const now = () => new Date().toISOString();

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
  const row: RewardProgramRow = { id: uuidv7(), workspaceId: ws.workspaceId, cardAccountId: input.cardAccountId, name, unit: input.unit, cycleAnchor: input.cycleAnchor, catalogEntryId: null, catalogEntryVersion: null, catalogStatus: null, catalogMemberLevel: null, catalogDismissedVersion: null, catalogSnapshotJson: null, crediting: 'per_statement', expiryPolicy: 'none', expiryMonths: null, archivedAt: null, createdAt: new Date().toISOString() };
  await database.transaction(async (tx) => {
    await requireEarningCard(tx, ws, input.cardAccountId);
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
    minCycleSpendMinor: r.minCycleSpendMinor,
    validFrom: r.validFrom,
    validTo: r.validTo,
  }));
}

export type EarnRuleInput = Omit<EarnRule, 'id'> & { id?: string; catalogKey?: string | null };

/** Issuers publish rates such as 7,5 points per spend multiple, so one decimal place is allowed. */
const hasAtMostOneDecimal = (n: number) => Number.isFinite(n) && Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;

/** Rules are configuration, not ledger history: saving an existing id updates it in place. */
export async function saveEarnRuleTx(tx: Db, ws: WorkspaceContext, programId: string, rule: EarnRuleInput, options: PointsWriteOptions = {}): Promise<string> {
  if (!rule.name.trim()) throw new PointsError('Rule name is required');
  if (rule.rateNum < 0 || !hasAtMostOneDecimal(rule.rateNum)) throw new PointsError('Points must be ≥ 0 with at most one decimal');
  if (!Number.isInteger(rule.rateDen) || rule.rateDen <= 0) throw new PointsError('Spend per points must be a whole number > 0');
  const values = {
    name: rule.name.trim(),
    priority: rule.priority,
    stackable: rule.stackable ? 1 : 0,
    matchJson: JSON.stringify(rule.match ?? {}),
    rateNum: Math.round(rule.rateNum * 10) / 10,
    rateDen: rule.rateDen,
    rounding: rule.rounding,
    capSpendMinor: rule.capSpendMinor,
    capPoints: rule.capPoints,
    minTransactionMinor: rule.minTransactionMinor,
    minCycleSpendMinor: rule.minCycleSpendMinor ?? null,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
    ...(rule.catalogKey === undefined ? {} : { catalogKey: rule.catalogKey }),
  };
  await requireProgram(tx, ws, programId);
  await markCustomised(tx, ws, programId, options);
  if (rule.id) {
    await tx.update(earnRules).set(values).where(and(eq(earnRules.id, rule.id), eq(earnRules.workspaceId, ws.workspaceId)));
    return rule.id;
  }
  const id = uuidv7();
  await tx.insert(earnRules).values({ catalogKey: null, ...values, id, workspaceId: ws.workspaceId, programId, archivedAt: null, createdAt: now() });
  return id;
}

export function saveEarnRule(database: Database, ws: WorkspaceContext, programId: string, rule: EarnRuleInput, options: PointsWriteOptions = {}): Promise<string> {
  return database.transaction((tx) => saveEarnRuleTx(tx, ws, programId, rule, options));
}

export async function archiveEarnRuleTx(tx: Db, ws: WorkspaceContext, ruleId: string, options: PointsWriteOptions = {}): Promise<void> {
  const [rule] = await tx
    .select({ programId: earnRules.programId })
    .from(earnRules)
    .where(and(eq(earnRules.id, ruleId), eq(earnRules.workspaceId, ws.workspaceId)));
  if (!rule) return;
  await tx.update(earnRules).set({ archivedAt: now() }).where(eq(earnRules.id, ruleId));
  await markCustomised(tx, ws, rule.programId, options);
}

export function archiveEarnRule(database: Database, ws: WorkspaceContext, ruleId: string, options: PointsWriteOptions = {}): Promise<void> {
  return database.transaction((tx) => archiveEarnRuleTx(tx, ws, ruleId, options));
}

export type CycleBonusInput = Omit<CycleBonus, 'id'> & { id?: string; catalogKey?: string | null };

export async function listCycleBonuses(database: Database, ws: WorkspaceContext, programId: string): Promise<CycleBonus[]> {
  const rows = await database.db
    .select()
    .from(cycleBonuses)
    .where(and(eq(cycleBonuses.programId, programId), eq(cycleBonuses.workspaceId, ws.workspaceId), isNull(cycleBonuses.archivedAt)))
    .orderBy(asc(cycleBonuses.validFrom), asc(cycleBonuses.createdAt));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    tiers: JSON.parse(r.tiersJson) as BonusTier[],
    match: JSON.parse(r.matchJson) as RuleMatch,
    validFrom: r.validFrom,
    validTo: r.validTo,
  }));
}

export async function saveCycleBonusTx(tx: Db, ws: WorkspaceContext, programId: string, bonus: CycleBonusInput, options: PointsWriteOptions = {}): Promise<string> {
  if (!bonus.name.trim()) throw new PointsError('Bonus name is required');
  if (!bonus.key.trim()) throw new PointsError('Bonus key is required');
  if (bonus.tiers.length === 0) throw new PointsError('A bonus needs at least one tier');
  bonus.tiers.forEach((tier, i) => {
    if (!Number.isSafeInteger(tier.minSpendMinor) || tier.minSpendMinor <= 0) throw new PointsError('Tier spend must be a positive amount');
    if (!Number.isInteger(tier.bonus) || tier.bonus <= 0) throw new PointsError('Tier bonus must be a whole number > 0');
    const previous = bonus.tiers[i - 1];
    if (previous && tier.minSpendMinor <= previous.minSpendMinor) throw new PointsError('Tiers must be in ascending order of spend');
  });
  const values = {
    key: bonus.key.trim(),
    name: bonus.name.trim(),
    tiersJson: JSON.stringify(bonus.tiers.map((tier) => ({ minSpendMinor: tier.minSpendMinor, bonus: tier.bonus }))),
    matchJson: JSON.stringify(bonus.match ?? {}),
    validFrom: bonus.validFrom,
    validTo: bonus.validTo,
    ...(bonus.catalogKey === undefined ? {} : { catalogKey: bonus.catalogKey }),
  };
  await requireProgram(tx, ws, programId);
  await markCustomised(tx, ws, programId, options);
  if (bonus.id) {
    await tx.update(cycleBonuses).set(values).where(and(eq(cycleBonuses.id, bonus.id), eq(cycleBonuses.workspaceId, ws.workspaceId)));
    return bonus.id;
  }
  const id = uuidv7();
  await tx.insert(cycleBonuses).values({ catalogKey: null, ...values, id, workspaceId: ws.workspaceId, programId, archivedAt: null, createdAt: now() });
  return id;
}

export function saveCycleBonus(database: Database, ws: WorkspaceContext, programId: string, bonus: CycleBonusInput, options: PointsWriteOptions = {}): Promise<string> {
  return database.transaction((tx) => saveCycleBonusTx(tx, ws, programId, bonus, options));
}

export async function archiveCycleBonusTx(tx: Db, ws: WorkspaceContext, bonusId: string, options: PointsWriteOptions = {}): Promise<void> {
  const [bonus] = await tx
    .select({ programId: cycleBonuses.programId })
    .from(cycleBonuses)
    .where(and(eq(cycleBonuses.id, bonusId), eq(cycleBonuses.workspaceId, ws.workspaceId)));
  if (!bonus) return;
  await tx.update(cycleBonuses).set({ archivedAt: now() }).where(eq(cycleBonuses.id, bonusId));
  await markCustomised(tx, ws, bonus.programId, options);
}

export function archiveCycleBonus(database: Database, ws: WorkspaceContext, bonusId: string, options: PointsWriteOptions = {}): Promise<void> {
  return database.transaction((tx) => archiveCycleBonusTx(tx, ws, bonusId, options));
}

export type TransferPartnerInput = Omit<TransferPartner, 'id'> & { id?: string; catalogKey?: string | null };

export async function listTransferPartners(database: Database, ws: WorkspaceContext, programId: string): Promise<TransferPartner[]> {
  const rows = await database.db
    .select()
    .from(transferPartners)
    .where(and(eq(transferPartners.programId, programId), eq(transferPartners.workspaceId, ws.workspaceId), isNull(transferPartners.archivedAt)))
    .orderBy(asc(transferPartners.createdAt));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    program: r.programName,
    points: r.points,
    partnerUnits: r.partnerUnits,
    incrementPoints: r.incrementPoints,
    minimumPoints: r.minimumPoints,
    validFrom: r.validFrom,
    validTo: r.validTo,
    cap:
      r.capWindow === 'month' || r.capWindow === 'year'
        ? {
            window: r.capWindow,
            capPoints: r.capPoints,
            capPartnerUnits: r.capPartnerUnits,
            shared: r.capShared === 1,
            beyond: r.beyondPoints && r.beyondPartnerUnits ? { points: r.beyondPoints, partnerUnits: r.beyondPartnerUnits } : null,
          }
        : null,
  }));
}

export async function saveTransferPartnerTx(
  tx: Db,
  ws: WorkspaceContext,
  programId: string,
  partner: TransferPartnerInput,
  options: PointsWriteOptions = {},
): Promise<string> {
  if (!partner.program.trim()) throw new PointsError('Partner program is required');
  if (!partner.key.trim()) throw new PointsError('Partner key is required');
  for (const value of [partner.points, partner.partnerUnits, partner.incrementPoints]) {
    if (!Number.isInteger(value) || value <= 0) throw new PointsError('Transfer ratio and step must be whole numbers > 0');
  }
  if (partner.minimumPoints != null && (!Number.isInteger(partner.minimumPoints) || partner.minimumPoints < partner.incrementPoints)) {
    throw new PointsError('A transfer minimum must be a whole number no smaller than the step');
  }
  const cap = partner.cap ?? null;
  if (cap) {
    if (cap.capPoints === null && cap.capPartnerUnits === null) throw new PointsError('A redemption cap needs a ceiling in points or partner units');
    for (const value of [cap.capPoints, cap.capPartnerUnits, cap.beyond?.points, cap.beyond?.partnerUnits]) {
      if (value != null && (!Number.isInteger(value) || value <= 0)) throw new PointsError('Redemption cap figures must be whole numbers > 0');
    }
  }
  const values = {
    key: partner.key.trim(),
    programName: partner.program.trim(),
    points: partner.points,
    partnerUnits: partner.partnerUnits,
    incrementPoints: partner.incrementPoints,
    minimumPoints: partner.minimumPoints ?? null,
    capWindow: cap?.window ?? null,
    capPoints: cap?.capPoints ?? null,
    capPartnerUnits: cap?.capPartnerUnits ?? null,
    capShared: cap?.shared ? 1 : 0,
    beyondPoints: cap?.beyond?.points ?? null,
    beyondPartnerUnits: cap?.beyond?.partnerUnits ?? null,
    validFrom: partner.validFrom,
    validTo: partner.validTo,
    ...(partner.catalogKey === undefined ? {} : { catalogKey: partner.catalogKey }),
  };
  await requireProgram(tx, ws, programId);
  await markCustomised(tx, ws, programId, options);
  if (partner.id) {
    await tx.update(transferPartners).set(values).where(and(eq(transferPartners.id, partner.id), eq(transferPartners.workspaceId, ws.workspaceId)));
    return partner.id;
  }
  const id = uuidv7();
  await tx.insert(transferPartners).values({ catalogKey: null, ...values, id, workspaceId: ws.workspaceId, programId, archivedAt: null, createdAt: now() });
  return id;
}

export function saveTransferPartner(
  database: Database,
  ws: WorkspaceContext,
  programId: string,
  partner: TransferPartnerInput,
  options: PointsWriteOptions = {},
): Promise<string> {
  return database.transaction((tx) => saveTransferPartnerTx(tx, ws, programId, partner, options));
}

export async function archiveTransferPartnerTx(tx: Db, ws: WorkspaceContext, partnerId: string, options: PointsWriteOptions = {}): Promise<void> {
  const [partner] = await tx
    .select({ programId: transferPartners.programId })
    .from(transferPartners)
    .where(and(eq(transferPartners.id, partnerId), eq(transferPartners.workspaceId, ws.workspaceId)));
  if (!partner) return;
  await tx.update(transferPartners).set({ archivedAt: now() }).where(eq(transferPartners.id, partnerId));
  await markCustomised(tx, ws, partner.programId, options);
}

export function archiveTransferPartner(database: Database, ws: WorkspaceContext, partnerId: string, options: PointsWriteOptions = {}): Promise<void> {
  return database.transaction((tx) => archiveTransferPartnerTx(tx, ws, partnerId, options));
}

export async function listRedemptionOptions(database: Database, ws: WorkspaceContext, programId: string): Promise<RedemptionOptionRow[]> {
  return database.db
    .select()
    .from(redemptionOptions)
    .where(and(eq(redemptionOptions.programId, programId), eq(redemptionOptions.workspaceId, ws.workspaceId)));
}

export interface RedemptionOptionInput {
  id?: string;
  programId: string;
  name: string;
  type: RedemptionOptionRow['type'];
  valueMinor: number;
  perPoints: number;
  currency: string;
  catalogKey?: string | null;
}

export async function saveRedemptionOptionTx(tx: Db, ws: WorkspaceContext, input: RedemptionOptionInput, options: PointsWriteOptions = {}): Promise<string> {
  currencyInfo(input.currency);
  if (!Number.isSafeInteger(input.valueMinor) || input.valueMinor <= 0) throw new PointsError('Value must be a positive amount');
  if (!Number.isInteger(input.perPoints) || input.perPoints <= 0) throw new PointsError('Points must be a whole number > 0');
  const values = {
    name: input.name.trim() || 'Redemption',
    type: input.type,
    valueMinor: input.valueMinor,
    perPoints: input.perPoints,
    currency: input.currency,
    ...(input.catalogKey === undefined ? {} : { catalogKey: input.catalogKey }),
  };
  await requireProgram(tx, ws, input.programId);
  await markCustomised(tx, ws, input.programId, options);
  if (input.id) {
    await tx.update(redemptionOptions).set(values).where(and(eq(redemptionOptions.id, input.id), eq(redemptionOptions.workspaceId, ws.workspaceId)));
    return input.id;
  }
  const id = uuidv7();
  await tx.insert(redemptionOptions).values({ catalogKey: null, ...values, id, workspaceId: ws.workspaceId, programId: input.programId });
  return id;
}

export function saveRedemptionOption(database: Database, ws: WorkspaceContext, input: RedemptionOptionInput, options: PointsWriteOptions = {}): Promise<string> {
  return database.transaction((tx) => saveRedemptionOptionTx(tx, ws, input, options));
}

export async function deleteRedemptionOptionTx(tx: Db, ws: WorkspaceContext, id: string, options: PointsWriteOptions = {}): Promise<void> {
  const [option] = await tx
    .select({ programId: redemptionOptions.programId })
    .from(redemptionOptions)
    .where(and(eq(redemptionOptions.id, id), eq(redemptionOptions.workspaceId, ws.workspaceId)));
  if (!option) return;
  await tx.delete(redemptionOptions).where(eq(redemptionOptions.id, id));
  await markCustomised(tx, ws, option.programId, options);
}

export function deleteRedemptionOption(database: Database, ws: WorkspaceContext, id: string, options: PointsWriteOptions = {}): Promise<void> {
  return database.transaction((tx) => deleteRedemptionOptionTx(tx, ws, id, options));
}

export const toRedemption = (row: RedemptionOptionRow): Redemption => ({ valueMinor: row.valueMinor, perPoints: row.perPoints, currency: row.currency });

export async function recordCycleActual(
  database: Database,
  ws: WorkspaceContext,
  input: { programId: string; cycleStart: string; actualPoints: number },
): Promise<void> {
  const tenths = input.actualPoints * 10;
  if (!Number.isFinite(tenths) || tenths < 0 || Math.abs(tenths - Math.round(tenths)) > 1e-9) throw new PointsError('Actual points must be ≥ 0 with at most one decimal');
  const actualPoints = Math.round(tenths) / 10;
  await database.transaction(async (tx) => {
    await requireProgram(tx, ws, input.programId);
    await tx
      .insert(cycleActuals)
      .values({ workspaceId: ws.workspaceId, programId: input.programId, cycleStart: input.cycleStart, actualPoints, recordedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [cycleActuals.programId, cycleActuals.cycleStart],
        set: { actualPoints, recordedAt: new Date().toISOString() },
      });
  });
}

export async function listCycleActuals(database: Database, ws: WorkspaceContext, programId: string) {
  return database.db
    .select({ cycleStart: cycleActuals.cycleStart, actualPoints: cycleActuals.actualPoints, recordedAt: cycleActuals.recordedAt })
    .from(cycleActuals)
    .where(and(eq(cycleActuals.programId, programId), eq(cycleActuals.workspaceId, ws.workspaceId)));
}

/**
 * Expense entries of posted transactions charged to or refunded onto the card within [from, to] — by the bank's
 * posting date when one was given, so a purchase billed late counts in the cycle it was billed in — each with its
 * effective MCC. A refund is a negative line. Statement payments have no expense entries and never appear.
 */
export async function cardSpendLines(database: Database, ws: WorkspaceContext, cardAccountId: string, from: string, to: string): Promise<SpendLine[]> {
  const rows = await database.db.values<[string, string, string, string, string, number, string, string | null, string | null]>(sql`
    SELECT t.id, e.id, t.occurred_on, e.account_id, t.description, e.amount_minor, e.currency, t.original_currency, t.mcc
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id
    JOIN accounts a ON a.id = e.account_id
    LEFT JOIN card_postings p ON p.transaction_id = t.id
    WHERE e.workspace_id = ${ws.workspaceId}
      AND t.status = 'posted'
      AND a.kind = 'expense'
      AND COALESCE(p.posted_on, t.occurred_on) BETWEEN ${from} AND ${to}
      AND EXISTS (SELECT 1 FROM entries c WHERE c.transaction_id = t.id AND c.account_id = ${cardAccountId})
    ORDER BY t.occurred_on, t.id, e.id
  `);
  // A purchase of a holding paid by card: the card line itself names the category it would have had.
  const assetRows = await database.db.values<[string, string, string, string, string, number, string, string | null, string | null]>(sql`
    SELECT t.id, e.id, t.occurred_on, e.spend_category_id, t.description, -e.amount_minor, e.currency, t.original_currency, t.mcc
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id
    LEFT JOIN card_postings p ON p.transaction_id = t.id
    WHERE e.workspace_id = ${ws.workspaceId}
      AND t.status = 'posted'
      AND e.account_id = ${cardAccountId}
      AND e.spend_category_id IS NOT NULL
      AND e.amount_minor < 0
      AND COALESCE(p.posted_on, t.occurred_on) BETWEEN ${from} AND ${to}
    ORDER BY t.occurred_on, t.id, e.id
  `);
  const sources = await mccSourcesFor(database.db, ws);
  const categories = await database.db
    .select({ id: accounts.id, parentId: accounts.parentId, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category')));
  const feeCategories = cardFeeCategoryIds(categories);
  const noPoints = await nonEarningInstallmentTransactionIds(database, ws);
  return [...rows, ...assetRows].map(([transactionId, entryId, occurredOn, categoryId, description, amountMinor, currency, originalCurrency, typed]) => {
    const { mcc, source } = resolveMcc(description, categoryId, { ...sources, typed });
    return { transactionId, entryId, occurredOn, categoryId, description, amountMinor: Number(amountMinor), currency, originalCurrency, mcc, mccSource: source, cardFee: isCardFee(description, categoryId, feeCategories) || noPoints.has(transactionId) };
  });
}
