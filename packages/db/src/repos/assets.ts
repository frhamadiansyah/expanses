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
    updatedAt: row.updatedAt,
  };
}

export async function getAssetProfile(database: Database, ws: WorkspaceContext, accountId: string): Promise<AssetProfileRow | undefined> {
  const [row] = await database.db
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

/** Writes the profile of an asset, filling in anything not given from the preset for its kind. */
export async function saveAssetProfile(database: Database, ws: WorkspaceContext, input: SaveAssetProfileInput): Promise<void> {
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
    updatedAt: new Date().toISOString(),
  };
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
    await tx.insert(assetProfiles).values(row).onConflictDoUpdate({ target: assetProfiles.accountId, set: row });
  });
}
