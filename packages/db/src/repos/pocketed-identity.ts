import { CASH_ITEMS, cashItem, type MoneyAccountSubtype, type PlanGroup } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { AccountError } from './accounts';
import { getAssetProfileTx, profileDefaults, saveAssetProfileTx } from './assets';

export interface PocketedIdentity {
  /** Where the account counts in the plan (Group). */
  planGroup?: PlanGroup;
  /** What it is on the tax report (Description): a four-digit code, or null for none. */
  coretaxCode?: string | null;
  /** The bank, the tax report's Nama institusi; empty removes it. */
  inst?: string;
}

/**
 * The Bank, Group and Description of an account with pockets, set on the account (the parent) and kept by every pocket
 * it has. The pockets are what the reports read (they hold the money, each with its own profile), so the choice is
 * written to each of them — archived ones too, so a pocket brought back is not left behind — and to the parent's own
 * profile when it has one; the parent is not given one that it lacks, since its pockets carry it. All in one
 * transaction. The pockets' names follow the parent's through `renameAccount`, and their bank through this.
 */
export async function setPocketedIdentity(database: Database, ws: WorkspaceContext, parentId: string, change: PocketedIdentity): Promise<void> {
  await database.transaction(async (tx) => {
    const [parent] = await tx
      .select({ id: accounts.id, subtype: accounts.subtype, parentId: accounts.parentId })
      .from(accounts)
      .where(and(eq(accounts.id, parentId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!parent) throw new AccountError('Account not found');
    if (parent.parentId !== null) throw new AccountError('A pocket takes these from its account');
    const pockets = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, parentId), eq(accounts.kind, 'asset')));
    const kind = CASH_ITEMS.some((item) => item.id === parent.subtype) ? cashItem(parent.subtype as MoneyAccountSubtype) : null;
    for (const [i, target] of [parentId, ...pockets.map((pocket) => pocket.id)].entries()) {
      const existing = await getAssetProfileTx(tx, ws, target);
      if (!existing && i === 0) continue;
      const base = existing ?? {
        ...profileDefaults('cash'),
        coretaxSection: 'kas' as const,
        coretaxCode: kind?.code ?? null,
        accountId: target,
        workspaceId: ws.workspaceId,
        updatedAt: '',
      };
      const fields = { ...base.coretaxFields };
      if (change.inst !== undefined) {
        const inst = change.inst.trim();
        if (inst === '') delete fields.inst;
        else fields.inst = inst;
      }
      await saveAssetProfileTx(tx, ws, {
        accountId: target,
        assetKind: base.assetKind,
        planGroup: change.planGroup ?? base.planGroup,
        unitKind: base.unitKind,
        lotSize: base.lotSize,
        risk: base.risk,
        coretaxSection: base.coretaxSection,
        coretaxCode: change.coretaxCode === undefined ? base.coretaxCode : change.coretaxCode,
        acquiredYear: base.acquiredYear,
        reportable: base.reportable,
        taxTreatment: base.taxTreatment,
        coretaxFields: fields,
      });
    }
  });
}
