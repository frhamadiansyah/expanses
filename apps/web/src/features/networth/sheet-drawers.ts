import { assetItemOfCode, type SheetRow } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';

/** How one row's kind is named: the drawer it belongs in. */
export interface RowKind {
  /** `bank`, `credit_card`, `0303` — stable, and what the drawer's state is kept by. */
  key: string;
  label: string;
}

/** Where a row whose account is not among the accounts read lands, rather than being dropped. */
const OTHER: RowKind = { key: 'other', label: 'Other' };

/**
 * What a row is drawn under inside its section.
 *
 * A section of money is read by the kind of account each row is — a current account, a time deposit, money owed to you.
 * A section of things is read by the catalogue item the asset was opened as, which is what its code remembers: shares
 * by share, gold by gold, rather than four rows all called "Investment". A code the catalogue does not know, and an
 * account that is not in the list at all — archived between the sheet being read and the accounts being read — fall
 * back to the account's own kind and then to "Other", because a row that vanishes from the list while staying in the
 * total is worse than a row under the wrong name.
 */
export function rowKindOf(section: string, row: SheetRow, subtypeOf: (accountId: string) => AccountSubtype | undefined): RowKind {
  if (section !== 'liquid' && row.code) {
    const item = assetItemOfCode(row.code);
    if (item) return { key: item.id, label: item.label };
  }
  const subtype = subtypeOf(row.accountId);
  return subtype === undefined ? OTHER : { key: subtype, label: SUBTYPE_LABELS[subtype] };
}

/** One kind of thing inside a section: what it is called, what it holds, and what its rows come to. */
export interface SheetDrawer {
  key: string;
  label: string;
  rows: SheetRow[];
  totalMinor: number;
}

/**
 * A group's rows, folded by what each one *is*: current accounts with current accounts, cards with cards, listed shares
 * with listed shares.
 *
 * The caller says what kind a row is, because the answer differs by section: money is read by the kind of account it
 * sits in, and a holding by the catalogue item it was opened as — "Listed shares", "Gold bullion" — which only the
 * section and the row's code can tell apart.
 *
 * The order is the order the kinds first appear in, which is the order the sheet sorted its rows in, so the kind
 * holding the most still reads first and folding changes what is drawn, never what is said.
 */
export function sheetDrawers(rows: readonly SheetRow[], kindOf: (row: SheetRow) => RowKind): SheetDrawer[] {
  const drawers = new Map<string, SheetDrawer>();
  for (const row of rows) {
    const kind = kindOf(row);
    const drawer = drawers.get(kind.key) ?? { ...kind, rows: [], totalMinor: 0 };
    drawer.rows.push(row);
    drawer.totalMinor += row.amountMinor;
    drawers.set(kind.key, drawer);
  }
  return [...drawers.values()];
}
