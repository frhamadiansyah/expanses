import { CASH_ITEMS, cashItem, type MoneyAccountSubtype } from '@expanses/core';
import { type AccountRow, type Database, getAssetProfile, profileDefaults, saveAssetProfile, type WorkspaceContext } from '@expanses/db';

/**
 * Writes one of a money account's tax-report fields (its account number, its bank) over what is saved now, from a
 * row elsewhere on its Settings that asks for it in its own words. An account opened before it had a profile gets the
 * one Add account would have given it. An empty value removes the field.
 */
export async function setKasField(database: Database, ws: WorkspaceContext, account: Pick<AccountRow, 'id' | 'subtype'>, key: string, value: string): Promise<void> {
  const kind = CASH_ITEMS.some((item) => item.id === account.subtype) ? cashItem(account.subtype as MoneyAccountSubtype) : null;
  const current =
    (await getAssetProfile(database, ws, account.id)) ??
    { ...profileDefaults('cash'), coretaxSection: 'kas' as const, coretaxCode: kind?.code ?? null, accountId: account.id, workspaceId: ws.workspaceId, updatedAt: '' };
  const next = value.trim();
  if ((current.coretaxFields[key] ?? '') === next) return;
  const fields = { ...current.coretaxFields };
  if (next === '') delete fields[key];
  else fields[key] = next;
  await saveAssetProfile(database, ws, {
    accountId: current.accountId,
    assetKind: current.assetKind,
    planGroup: current.planGroup,
    unitKind: current.unitKind,
    lotSize: current.lotSize,
    risk: current.risk,
    coretaxSection: current.coretaxSection,
    coretaxCode: current.coretaxCode,
    acquiredYear: current.acquiredYear,
    reportable: current.reportable,
    taxTreatment: current.taxTreatment,
    coretaxFields: fields,
  });
}
