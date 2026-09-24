import type { SheetRow } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';

/** One kind of thing inside a group: what it is called, what it holds, and what its rows come to. */
export interface SheetDrawer {
  /** The account type the drawer folds by — `bank`, `credit_card`, `loan` — or `other`. */
  key: string;
  label: string;
  rows: SheetRow[];
  totalMinor: number;
}

/** Where a row whose account is not among the accounts read lands, rather than being dropped. */
const OTHER = { key: 'other', label: 'Other' };

/**
 * A group's rows, folded by what each account *is*: current accounts with current accounts, cards with cards.
 *
 * The order is the order the types first appear in, which is the order the sheet sorted its rows in — so the type
 * holding the most still reads first, and folding changes what is drawn, never what is said.
 *
 * A row whose account is not in the list — an account archived between the sheet being read and the accounts being
 * read — lands in `Other` rather than disappearing: this is a figure of what you own, and a row that vanishes from
 * the list while staying in the total is worse than a row under the wrong name.
 */
export function sheetDrawers(rows: readonly SheetRow[], subtypes: ReadonlyMap<string, AccountSubtype>): SheetDrawer[] {
  const drawers = new Map<string, SheetDrawer>();
  for (const row of rows) {
    const subtype = subtypes.get(row.accountId);
    const kind = subtype === undefined ? OTHER : { key: subtype, label: SUBTYPE_LABELS[subtype] };
    const drawer = drawers.get(kind.key) ?? { ...kind, rows: [], totalMinor: 0 };
    drawer.rows.push(row);
    drawer.totalMinor += row.amountMinor;
    drawers.set(kind.key, drawer);
  }
  return [...drawers.values()];
}
