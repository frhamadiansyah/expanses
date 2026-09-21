import { type AssetKind, type CoretaxSection, type PlanGroup, presetFor, type Risk, type UnitKind } from '@expanses/core';
import { and, asc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { assetProfiles } from '../schema-assets';

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetError';
  }
}

export interface AssetProfileRow {
  accountId: string;
  workspaceId: string;
  assetKind: AssetKind;
  planGroup: PlanGroup;
  unitKind: UnitKind | null;
  lotSize: number | null;
  risk: Risk | null;
  coretaxSection: CoretaxSection | null;
  coretaxCode: string | null;
  acquiredYear: number | null;
  coretaxFields: Record<string, string>;
  /** False when the asset is yours but does not belong on the tax report. */
  reportable: boolean;
  /** How its income is taxed, as the owner set it. Null means not set, and nothing guesses it. */
  taxTreatment: 'final' | 'not_object' | 'ordinary' | null;
  updatedAt: string;
}

export interface SaveAssetProfileInput {
  accountId: string;
  assetKind: AssetKind;
  planGroup?: PlanGroup;
  unitKind?: UnitKind | null;
  lotSize?: number | null;
  risk?: Risk | null;
  coretaxSection?: CoretaxSection | null;
  coretaxCode?: string | null;
  acquiredYear?: number | null;
  coretaxFields?: Record<string, string>;
  reportable?: boolean;
  taxTreatment?: 'final' | 'not_object' | 'ordinary' | null;
}

/** What a profile looks like before the owner changes anything. */
export function profileDefaults(kind: AssetKind): Omit<AssetProfileRow, 'accountId' | 'workspaceId' | 'updatedAt'> {
  const preset = presetFor(kind);
  return {
    assetKind: kind,
    planGroup: preset.planGroup,
    unitKind: preset.unitKind,
    lotSize: preset.lotSize,
    risk: preset.risk,
    coretaxSection: preset.coretaxSection,
    coretaxCode: preset.coretaxCode,
    acquiredYear: null,
    coretaxFields: {},
    reportable: true,
    taxTreatment: null,
  };
}

type ProfileDbRow = typeof assetProfiles.$inferSelect;

function toProfile(row: ProfileDbRow): AssetProfileRow {
  let coretaxFields: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.coretaxFieldsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) coretaxFields = parsed as Record<string, string>;
  } catch {
    // A hand-edited database should not stop the page loading; the fields simply show as missing.
  }
  return {
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    assetKind: row.assetKind,
    planGroup: row.planGroup,
    unitKind: row.unitKind,
    lotSize: row.lotSize,
    risk: row.risk,
    coretaxSection: row.coretaxSection,
    coretaxCode: row.coretaxCode,
    acquiredYear: row.acquiredYear,
    coretaxFields,
    reportable: row.reportable === 1,
    taxTreatment: row.taxTreatment,
    updatedAt: row.updatedAt,
  };
}

export function getAssetProfile(database: Database, ws: WorkspaceContext, accountId: string): Promise<AssetProfileRow | undefined> {
  return getAssetProfileTx(database.db, ws, accountId);
}

/** `getAssetProfile` inside a transaction already running: the one reader of a profile's fields, on the caller's `tx`. */
export async function getAssetProfileTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<AssetProfileRow | undefined> {
  const [row] = await tx
    .select()
    .from(assetProfiles)
    .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  return row ? toProfile(row) : undefined;
}

export async function listAssetProfiles(database: Database, ws: WorkspaceContext): Promise<AssetProfileRow[]> {
  const rows = await database.db
    .select()
    .from(assetProfiles)
    .where(eq(assetProfiles.workspaceId, ws.workspaceId))
    .orderBy(asc(assetProfiles.accountId));
  return rows.map(toProfile);
}

export async function assertAccountInWorkspace(tx: Db, ws: WorkspaceContext, accountId: string, label = 'Account'): Promise<void> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row) throw new AssetError(`${label} not found in this workspace`);
}

const PLAN_GROUPS: PlanGroup[] = ['liquid', 'invest', 'owed', 'use'];

/**
 * Moves an asset between balance-sheet groups, so broker cash can sit under investments
 * instead of counting as the emergency buffer. Creates a plain profile when the asset has none.
 */
export async function setAssetGroup(database: Database, ws: WorkspaceContext, accountId: string, planGroup: PlanGroup): Promise<void> {
  if (!PLAN_GROUPS.includes(planGroup)) throw new AssetError(`Unknown group "${planGroup}"`);
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Asset');
    const [existing] = await tx
      .select()
      .from(assetProfiles)
      .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
    if (existing) {
      await tx.update(assetProfiles).set({ planGroup, updatedAt: new Date().toISOString() }).where(eq(assetProfiles.accountId, accountId));
      return;
    }
    const defaults = profileDefaults('cash');
    await tx.insert(assetProfiles).values({
      accountId,
      workspaceId: ws.workspaceId,
      assetKind: defaults.assetKind,
      planGroup,
      unitKind: defaults.unitKind,
      lotSize: defaults.lotSize,
      risk: defaults.risk,
      coretaxSection: defaults.coretaxSection,
      coretaxCode: defaults.coretaxCode,
      coretaxFieldsJson: '{}',
      acquiredYear: null,
      updatedAt: new Date().toISOString(),
    });
  });
}

/** IDX stocks trade in lots of 100; US stocks trade in single shares. Null means the holding has no lots. */
export async function setLotSize(database: Database, ws: WorkspaceContext, accountId: string, lotSize: number | null): Promise<void> {
  if (lotSize !== null && (!Number.isInteger(lotSize) || lotSize < 1)) throw new AssetError('A lot is one share or more');
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, accountId, 'Asset');
    const [existing] = await tx
      .select({ accountId: assetProfiles.accountId })
      .from(assetProfiles)
      .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
    if (!existing) throw new AssetError('Add this asset first, then set its lot size');
    await tx.update(assetProfiles).set({ lotSize, updatedAt: new Date().toISOString() }).where(eq(assetProfiles.accountId, accountId));
  });
}

/** Writes the profile of an asset, filling in anything not given from the preset for its kind. */
export async function saveAssetProfile(database: Database, ws: WorkspaceContext, input: SaveAssetProfileInput): Promise<void> {
  await database.transaction((tx) => saveAssetProfileTx(tx, ws, input));
}

/**
 * The same write inside a transaction already running, so a caller can open the account and give it its
 * profile as one atomic step. `saveAssetProfile` is this with a transaction of its own.
 */
export async function saveAssetProfileTx(tx: Db, ws: WorkspaceContext, input: SaveAssetProfileInput): Promise<void> {
  const defaults = profileDefaults(input.assetKind);
  const coretaxCode = input.coretaxCode === undefined ? defaults.coretaxCode : input.coretaxCode;
  if (coretaxCode !== null && !/^\d{4}$/.test(coretaxCode)) throw new AssetError('A Coretax code is four digits');
  const acquiredYear = input.acquiredYear ?? null;
  if (acquiredYear !== null && (!Number.isInteger(acquiredYear) || acquiredYear < 1900 || acquiredYear > 2999)) {
    throw new AssetError('Year acquired must be a four-digit year');
  }
  const row = {
    accountId: input.accountId,
    workspaceId: ws.workspaceId,
    assetKind: input.assetKind,
    planGroup: input.planGroup ?? defaults.planGroup,
    unitKind: input.unitKind === undefined ? defaults.unitKind : input.unitKind,
    lotSize: input.lotSize === undefined ? defaults.lotSize : input.lotSize,
    risk: input.risk === undefined ? defaults.risk : input.risk,
    coretaxSection: input.coretaxSection === undefined ? defaults.coretaxSection : input.coretaxSection,
    coretaxCode,
    coretaxFieldsJson: JSON.stringify(input.coretaxFields ?? {}),
    acquiredYear,
    reportable: (input.reportable ?? defaults.reportable) ? 1 : 0,
    taxTreatment: input.taxTreatment === undefined ? defaults.taxTreatment : input.taxTreatment,
    updatedAt: new Date().toISOString(),
  };
  await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
  await tx.insert(assetProfiles).values(row).onConflictDoUpdate({ target: assetProfiles.accountId, set: row });
}

export interface AssetReportingInput {
  /** False keeps the asset off the tax report while it still counts toward net worth. */
  reportable?: boolean;
  coretaxCode?: string | null;
  coretaxSection?: CoretaxSection | null;
  /** How its income is taxed. Null puts it back to not set. */
  taxTreatment?: 'final' | 'not_object' | 'ordinary' | null;
}

/**
 * How an asset is treated by the tax report: whether it appears at all, and under which code.
 *
 * DJP does not prescribe a code for every holding — for DPLK it says to pick kas, setara kas or an
 * investasi code to match your actual situation — so the code has to be the owner's to choose.
 */
export async function setAssetReporting(
  database: Database,
  ws: WorkspaceContext,
  accountId: string,
  input: AssetReportingInput,
): Promise<void> {
  if (input.coretaxCode !== undefined && input.coretaxCode !== null && !/^\d{4}$/.test(input.coretaxCode)) {
    throw new AssetError('A Coretax code is four digits');
  }
  const changes: Partial<typeof assetProfiles.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.reportable !== undefined) changes.reportable = input.reportable ? 1 : 0;
  if (input.coretaxCode !== undefined) changes.coretaxCode = input.coretaxCode;
  if (input.coretaxSection !== undefined) changes.coretaxSection = input.coretaxSection;
  if (input.taxTreatment !== undefined) changes.taxTreatment = input.taxTreatment;

  await database.db
    .update(assetProfiles)
    .set(changes)
    .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
}
