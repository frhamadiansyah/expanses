import { type AppliedCategoryChoice, type CatalogEntry, planCatalogApply } from '@expanses/catalog';
import { uuidv7 } from '@expanses/core';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardTerms, catalogCategoryChoices, cycleBonuses, earnRules, redemptionOptions, rewardPrograms, transferPartners } from '../schema-points';
import { categoryIdsByKeyTx } from './categories';
import { type RewardProgramRow, saveCycleBonusTx, saveEarnRuleTx, saveRedemptionOptionTx, saveTransferPartnerTx } from './points';

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

export interface CatalogState {
  entryId: string | null;
  entryVersion: number | null;
  status: 'linked' | 'customised' | null;
  dismissedVersion: number | null;
  /** The entry as last applied, for diffing against the bundled entry. */
  snapshot: CatalogEntry | null;
  /** The published member level this program was applied at, when the entry publishes any. */
  memberLevel: string | null;
}

const CASH_VALUE_KEY = 'cash-value';
const FROM_CATALOG = { fromCatalog: true };
const now = () => new Date().toISOString();
/** The day before an ISO date, so one stretch ends exactly where the next begins. */
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

async function programById(tx: Db, ws: WorkspaceContext, programId: string): Promise<RewardProgramRow> {
  const [program] = await tx
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
  if (!program) throw new CatalogError('Reward program not found');
  return program;
}

/**
 * Archives the program's catalogue rules, bonuses, and partners, and deletes its catalogue cash value. With `manual`,
 * also archives rules, bonuses, and partners the user added. Manual redemption options are the user's own valuations
 * and always stay.
 */
async function clearRows(tx: Db, ws: WorkspaceContext, programId: string, manual: boolean) {
  const archivedAt = now();
  await tx
    .update(earnRules)
    .set({ archivedAt })
    .where(and(eq(earnRules.programId, programId), eq(earnRules.workspaceId, ws.workspaceId), isNull(earnRules.archivedAt), manual ? undefined : isNotNull(earnRules.catalogKey)));
  await tx
    .update(cycleBonuses)
    .set({ archivedAt })
    .where(and(eq(cycleBonuses.programId, programId), eq(cycleBonuses.workspaceId, ws.workspaceId), isNull(cycleBonuses.archivedAt), manual ? undefined : isNotNull(cycleBonuses.catalogKey)));
  await tx
    .update(transferPartners)
    .set({ archivedAt })
    .where(
      and(eq(transferPartners.programId, programId), eq(transferPartners.workspaceId, ws.workspaceId), isNull(transferPartners.archivedAt), manual ? undefined : isNotNull(transferPartners.catalogKey)),
    );
  await tx
    .delete(redemptionOptions)
    .where(and(eq(redemptionOptions.programId, programId), eq(redemptionOptions.workspaceId, ws.workspaceId), isNotNull(redemptionOptions.catalogKey)));
}

/** Writes the entry's planned rows and catalogue fields onto the program. Returns category keys that could not be mapped. */
/** `setCrediting` is true only when applying or resetting: crediting is the user's checking preference once linked. */
async function writePlan(
  tx: Db,
  ws: WorkspaceContext,
  program: RewardProgramRow,
  entry: CatalogEntry,
  today: string,
  status: 'linked' | 'customised',
  setCrediting = false,
  memberLevel: string | null = null,
) {
  const plan = planCatalogApply(entry, await categoryIdsByKeyTx(tx, ws), today, memberLevel, await choicesFor(tx, ws, program.id));
  for (const { catalogKey, ...rule } of plan.rules) await saveEarnRuleTx(tx, ws, program.id, { ...rule, catalogKey }, FROM_CATALOG);
  for (const { catalogKey, ...bonus } of plan.bonuses) await saveCycleBonusTx(tx, ws, program.id, { ...bonus, catalogKey }, FROM_CATALOG);
  for (const { catalogKey, ...partner } of plan.transferPartners) await saveTransferPartnerTx(tx, ws, program.id, { ...partner, catalogKey }, FROM_CATALOG);
  if (plan.cashValue) {
    await saveRedemptionOptionTx(
      tx,
      ws,
      {
        programId: program.id,
        name: `${entry.program.name} cash value`,
        type: 'cashback',
        valueMinor: plan.cashValue.valueMinor,
        perPoints: plan.cashValue.perPoints,
        currency: plan.cashValue.currency,
        catalogKey: CASH_VALUE_KEY,
      },
      FROM_CATALOG,
    );
  }
  // The statement day is personal; only the published fee comes from the catalogue, and only onto terms the user set up.
  if (plan.annualFeeMinor !== null) {
    await tx
      .update(cardTerms)
      .set({ annualFeeMinor: plan.annualFeeMinor })
      .where(and(eq(cardTerms.accountId, program.cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
  }
  await tx
    .update(rewardPrograms)
    .set({
      name: entry.program.name,
      unit: entry.program.unit,
      cycleAnchor: entry.program.cycleAnchor,
      catalogEntryId: entry.id,
      catalogEntryVersion: entry.entryVersion,
      catalogStatus: status,
      catalogDismissedVersion: null,
      catalogMemberLevel: plan.requiresMemberLevel ? memberLevel : null,
      catalogSnapshotJson: JSON.stringify(entry),
      ...(setCrediting ? { crediting: plan.crediting } : {}),
    })
    .where(eq(rewardPrograms.id, program.id));
  return plan.unmappedKeys;
}

export async function getCatalogState(database: Database, ws: WorkspaceContext, programId: string): Promise<CatalogState> {
  const program = await programById(database.db, ws, programId);
  return {
    entryId: program.catalogEntryId,
    entryVersion: program.catalogEntryVersion,
    status: program.catalogStatus,
    dismissedVersion: program.catalogDismissedVersion,
    snapshot: program.catalogSnapshotJson ? (JSON.parse(program.catalogSnapshotJson) as CatalogEntry) : null,
    memberLevel: program.catalogMemberLevel,
  };
}

/**
 * Links a card to a catalogue entry in one transaction: creates the card's program if it has none, replaces catalogue
 * rows, and writes every terms period as dated rows. Throws when the card has rules the user set up and
 * `replaceManual` is false.
 */
export function applyCatalogEntry(
  database: Database,
  ws: WorkspaceContext,
  input: { cardAccountId: string; entry: CatalogEntry; today: string; replaceManual: boolean; memberLevel?: string | null },
): Promise<{ programId: string; unmappedKeys: string[] }> {
  const levels = input.entry.program.memberLevels ?? [];
  const memberLevel = input.memberLevel ?? null;
  return database.transaction(async (tx) => {
    // Rejects like every other refusal here, rather than throwing before the promise exists.
    if (levels.length > 0 && !levels.some((level) => level.key === memberLevel)) {
      throw new CatalogError(`This card earns by ${input.entry.program.name} level. Choose the level you are on before applying it.`);
    }
    const [card] = await tx
      .select({ subtype: accounts.subtype })
      .from(accounts)
      .where(and(eq(accounts.id, input.cardAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (card?.subtype !== 'credit_card') throw new CatalogError('Account is not a credit card in this workspace');

    let [program]: (RewardProgramRow | undefined)[] = await tx
      .select()
      .from(rewardPrograms)
      .where(and(eq(rewardPrograms.cardAccountId, input.cardAccountId), eq(rewardPrograms.workspaceId, ws.workspaceId), isNull(rewardPrograms.archivedAt)))
      .orderBy(asc(rewardPrograms.createdAt))
      .limit(1);
    if (!program) {
      program = {
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        cardAccountId: input.cardAccountId,
        name: input.entry.program.name,
        unit: input.entry.program.unit,
        cycleAnchor: input.entry.program.cycleAnchor,
        catalogEntryId: null,
        catalogEntryVersion: null,
        catalogStatus: null,
        catalogDismissedVersion: null,
        catalogMemberLevel: null,
        catalogSnapshotJson: null,
        crediting: input.entry.program.crediting ?? 'per_statement',
        archivedAt: null,
        createdAt: now(),
      };
      await tx.insert(rewardPrograms).values(program);
    } else if (!input.replaceManual) {
      const [manual] = await tx
        .select({ id: earnRules.id })
        .from(earnRules)
        .where(and(eq(earnRules.programId, program.id), isNull(earnRules.archivedAt), isNull(earnRules.catalogKey)))
        .limit(1);
      if (manual) throw new CatalogError('This card has earn rules you set up yourself. Confirm replacing them to use the catalogue terms.');
    }

    await clearRows(tx, ws, program.id, input.replaceManual);
    const unmappedKeys = await writePlan(tx, ws, program, input.entry, input.today, 'linked', true, memberLevel);
    return { programId: program.id, unmappedKeys };
  });
}

/** On app open: re-applies every linked program whose bundled entry has a higher version. Returns the synced program ids. */
export async function syncLinkedPrograms(database: Database, ws: WorkspaceContext, catalog: readonly CatalogEntry[], today: string): Promise<string[]> {
  const linked = await database.db
    .select()
    .from(rewardPrograms)
    .where(and(eq(rewardPrograms.workspaceId, ws.workspaceId), eq(rewardPrograms.catalogStatus, 'linked'), isNull(rewardPrograms.archivedAt)));
  const synced: string[] = [];
  for (const { id } of linked) {
    const didSync = await database.transaction(async (tx) => {
      const program = await programById(tx, ws, id);
      const entry = catalog.find((candidate) => candidate.id === program.catalogEntryId);
      if (program.catalogStatus !== 'linked' || !entry || entry.entryVersion <= (program.catalogEntryVersion ?? 0)) return false;
      await clearRows(tx, ws, program.id, false);
      await writePlan(tx, ws, program, entry, today, 'linked', false, program.catalogMemberLevel);
      return true;
    });
    if (didSync) synced.push(id);
  }
  return synced;
}

/** Applies a newer entry to a customised program: replaces catalogue rows, keeps rows the user added, stays customised. */
export function applyCatalogUpdate(database: Database, ws: WorkspaceContext, programId: string, entry: CatalogEntry, today: string): Promise<void> {
  return database.transaction(async (tx) => {
    const program = await programById(tx, ws, programId);
    if (program.catalogEntryId !== entry.id) throw new CatalogError('This program is not linked to that catalogue entry');
    await clearRows(tx, ws, program.id, false);
    await writePlan(tx, ws, program, entry, today, program.catalogStatus ?? 'linked', false, program.catalogMemberLevel);
  });
}

export async function dismissCatalogVersion(database: Database, ws: WorkspaceContext, programId: string, version: number): Promise<void> {
  await database.db
    .update(rewardPrograms)
    .set({ catalogDismissedVersion: version })
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
}

/** Drops every rule, bonus, and partner, including the user's, and relinks the program to the entry. */
export function resetToCatalog(database: Database, ws: WorkspaceContext, programId: string, entry: CatalogEntry, today: string): Promise<void> {
  return database.transaction(async (tx) => {
    const program = await programById(tx, ws, programId);
    if (program.catalogEntryId !== entry.id) throw new CatalogError('This program is not linked to that catalogue entry');
    await clearRows(tx, ws, program.id, true);
    await writePlan(tx, ws, program, entry, today, 'linked', true, program.catalogMemberLevel);
  });
}

/**
 * Moves a linked program to another published member level — the holder's standing with the bank changed.
 * Re-applies the entry at that level, so the rules and transfer ratios follow.
 */
export function setCatalogMemberLevel(database: Database, ws: WorkspaceContext, programId: string, memberLevel: string, today: string): Promise<void> {
  return database.transaction(async (tx) => {
    const program = await programById(tx, ws, programId);
    const entry = program.catalogSnapshotJson ? (JSON.parse(program.catalogSnapshotJson) as CatalogEntry) : null;
    if (!entry) throw new CatalogError('This program is not linked to a catalogue entry');
    const levels = entry.program.memberLevels ?? [];
    if (!levels.some((level) => level.key === memberLevel)) throw new CatalogError(`"${memberLevel}" is not a level this card publishes`);
    await clearRows(tx, ws, program.id, false);
    await writePlan(tx, ws, program, entry, today, program.catalogStatus ?? 'linked', false, memberLevel);
  });
}

/** Every stretch the holder has run an option on this program, oldest first. */
async function choicesFor(tx: Db, ws: WorkspaceContext, programId: string): Promise<AppliedCategoryChoice[]> {
  const rows = await tx
    .select()
    .from(catalogCategoryChoices)
    .where(and(eq(catalogCategoryChoices.programId, programId), eq(catalogCategoryChoices.workspaceId, ws.workspaceId)))
    .orderBy(asc(catalogCategoryChoices.createdAt));
  return rows.map((row) => ({ optionKey: row.optionKey, from: row.validFrom, to: row.validTo }));
}

/** The options the holder has run, for a screen to show the current one and what came before. */
export async function listCategoryChoices(database: Database, ws: WorkspaceContext, programId: string): Promise<AppliedCategoryChoice[]> {
  return choicesFor(database.db as unknown as Db, ws, programId);
}

/**
 * Starts running an option of the program's published category choice from `from`. The stretch running before it
 * is closed the day before, so a cycle that has already closed keeps the category that was running while it ran.
 */
export function setCatalogCategoryChoice(
  database: Database,
  ws: WorkspaceContext,
  programId: string,
  optionKey: string,
  from: string,
  today: string,
): Promise<void> {
  return database.transaction(async (tx) => {
    const program = await programById(tx, ws, programId);
    const entry = program.catalogSnapshotJson ? (JSON.parse(program.catalogSnapshotJson) as CatalogEntry) : null;
    const choice = entry?.program.categoryChoice;
    if (!choice) throw new CatalogError('This card has no category to choose');
    if (!choice.options.some((option) => option.key === optionKey)) throw new CatalogError(`"${optionKey}" is not an option this card offers`);

    const open = await tx
      .select()
      .from(catalogCategoryChoices)
      .where(and(eq(catalogCategoryChoices.programId, programId), eq(catalogCategoryChoices.workspaceId, ws.workspaceId), isNull(catalogCategoryChoices.validTo)));
    for (const row of open) {
      if (row.validFrom !== null && row.validFrom >= from) throw new CatalogError('That date is not after the category already running');
      await tx.update(catalogCategoryChoices).set({ validTo: dayBefore(from) }).where(eq(catalogCategoryChoices.id, row.id));
    }
    await tx.insert(catalogCategoryChoices).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      programId,
      optionKey,
      validFrom: open.length === 0 ? null : from,
      validTo: null,
      createdAt: now(),
    });

    await clearRows(tx, ws, program.id, false);
    if (entry) await writePlan(tx, ws, program, entry, today, program.catalogStatus ?? 'linked', false, program.catalogMemberLevel);
  });
}
