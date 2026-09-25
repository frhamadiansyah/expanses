import { assetItemOfCode, DEBT_ITEMS, type DebtIcon, type SheetRow } from '@expanses/core';
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
export function rowKindOf(section: string, row: { accountId: string; code?: string | null }, subtypeOf: (accountId: string) => AccountSubtype | undefined): RowKind {
  if (section !== 'liquid' && row.code) {
    const item = assetItemOfCode(row.code);
    if (item) return { key: item.id, label: item.label };
  }
  const subtype = subtypeOf(row.accountId);
  return subtype === undefined ? OTHER : { key: subtype, label: SUBTYPE_LABELS[subtype] };
}

/**
 * The drawer a debt is drawn under when nobody has said what kind it is, by the drawing its row already wears.
 *
 * A loan against a property is a home mortgage and one against a vehicle is a lease, which is what the icon says; a
 * loan against nothing in particular is a loan of no particular kind, and says that rather than borrowing a name it
 * was never given. Cards and personal debts have nothing finer than their kind, and wear their own name.
 */
const PLAIN_KINDS: Record<DebtIcon, RowKind> = {
  home: { key: 'home_mortgage', label: 'Home mortgage' },
  car: { key: 'vehicle_leasing', label: 'Vehicle leasing' },
  loan: { key: 'other_loans', label: 'Other loans' },
  card: { key: 'credit_card', label: SUBTYPE_LABELS.credit_card },
  person: { key: 'payable', label: SUBTYPE_LABELS.payable },
};

/**
 * Which drawer a debt belongs in: the catalogue item the debt was opened as — "Home mortgage", "Vehicle leasing",
 * "Online loan or paylater" — or, for a loan nobody has classified, what the loan is against.
 *
 * The item is looked up rather than read out of the catalogue by id, because an id the catalogue no longer knows must
 * leave the loan reading as its own facts rather than vanish from the list.
 *
 * One function rather than one per screen: the Debts list and the balance sheet's own drawers fold the same debts,
 * and a mortgage that read as a home mortgage on one page and as a plain loan on the other would be two taxonomies
 * for one debt.
 */
export function debtKind(itemId: string | null, icon: DebtIcon): RowKind {
  const item = itemId === null ? undefined : DEBT_ITEMS.find((entry) => entry.id === itemId);
  return item ? { key: item.id, label: item.label } : PLAIN_KINDS[icon];
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
