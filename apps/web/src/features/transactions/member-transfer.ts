import {
  activeNetWorthGroup,
  type Database,
  memberTransfersOf,
  type PaidWithItem,
  voidMemberTransfer,
  voidTransaction,
  type WorkspaceContext,
} from '@expanses/db';

/*
 * Transfers between partners on the Transfer tab (joint-net-worth §7.2, D15; task 8). In the net-worth group's workspace,
 * **To** lists the partner's shared items under "Andi’s, shared with Household" — and **From** likewise, for recording
 * money received from them — only those in the transfer's currency. The transfer is recorded once, in the group log;
 * each party's phone posts its own side.
 */

/** The heading a partner's items sit under on the Transfer tab: whose they are, and which workspace they are shared with. */
export const partnerTitle = (ownerName: string | null, workspaceName: string): string =>
  ownerName ? `${ownerName}’s, shared with ${workspaceName}` : `Shared with ${workspaceName}`;

export interface PartnerSection {
  key: string;
  title: string;
  items: PaidWithItem[];
}

/**
 * The partner's shared items a transfer can go to or come from (§7.2): only when the form's workspace is the net-worth
 * group's, and only those in `currency` — the other side's (both items must be in the transfer's currency). None until
 * that side is chosen. One section per owner, in the order the items come.
 */
export function partnerTransferSections(
  items: readonly PaidWithItem[],
  where: { formBookId: string; groupWorkspaceBookId: string | null | undefined },
  currency: string | null | undefined,
  workspaceName: string,
): PartnerSection[] {
  if (!currency || !where.groupWorkspaceBookId || where.formBookId !== where.groupWorkspaceBookId) return [];
  const sections: PartnerSection[] = [];
  for (const item of items) {
    if (item.currency !== currency) continue;
    let section = sections.find((s) => s.key === item.owner);
    if (!section) sections.push((section = { key: item.owner, title: partnerTitle(item.ownerName, workspaceName), items: [] }));
    section.items.push(item);
  }
  return sections;
}

/** The To list's value for a partner's item: kept apart from this person's own account ids. */
export const partnerChoice = (itemId: string): string => `partner:${itemId}`;
export const partnerItemOfChoice = (value: string): string | null => (value.startsWith('partner:') ? value.slice('partner:'.length) : null);

/**
 * Deletes a transaction the way it was made (§7.2): a side of a transfer between partners is deleted as the transfer —
 * both phones void theirs — while the group it belongs to is active here; anything else is voided on its own.
 */
export async function deleteTransaction(database: Database, ws: WorkspaceContext, transactionId: string): Promise<void> {
  const transfer = (await memberTransfersOf(database, [transactionId]))[transactionId];
  if (transfer) {
    // Already gone here: deleting it again does nothing.
    if (transfer.sideVoid) return;
    const group = await activeNetWorthGroup(database);
    if (!transfer.transferVoid && group && group.groupBookId === transfer.groupBookId) return voidMemberTransfer(database, group.workspaceBookId, transfer.transferId);
    // The group has ended here, or the transfer is void but this side is still posted: this phone's side goes on its own.
  }
  return voidTransaction(database, ws, transactionId);
}
