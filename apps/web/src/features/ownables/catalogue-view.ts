import {
  ASSET_FAMILIES,
  assetFamily,
  assetItem,
  cashItem,
  debtItem,
  elseItem,
  type MoneyAccountSubtype,
  type OwnableFamily,
  type OwnableFlow,
  type OwnableItem,
  searchOwnables,
  searchTokens,
  somethingElse,
} from '@expanses/core';

/**
 * What a picker screen draws, read off the one catalogue.
 *
 * Pure on purpose: the screens below are a list of buttons and a form, and everything that decides which rows
 * appear and which fields follow is decided here, where a test can read it without a browser.
 *
 * A row carries no code. The choice fixes one — that is the whole point of the catalogue — but a code is a thing
 * for the tax report and the item's own page, not for someone deciding whether they own an apartment. Leaving it
 * off the type rather than off the markup means no screen built on these rows can put it back by accident.
 */

/** A line in a picker: a tile, a name, a quiet line under it. Never a code. */
export interface PickerRow {
  id: string;
  label: string;
  sub: string;
  /** One emoji, drawn in the tile. Decoration: the label is the accessible name. */
  icon: string;
  /** The tile's background, as a Tailwind class, so a family's things read as that family's. */
  tint: string;
}

/** A row that hands the whole question over to another screen — money is an account, a house is not. */
export interface HandOverRow extends PickerRow {
  /** Where it goes, as a path. */
  to: string;
}

export interface PickerQuery {
  flow: OwnableFlow;
  query: string;
  /** Asset flow only: which family is open. Without one, the families themselves are the rows. */
  family?: OwnableFamily;
  /** Asset flow only: the rest of the open family's table, past the things it names. */
  more?: boolean;
}

/** The tile each money account is drawn with, in the order the screen lists them. */
const CASH_TILES: Record<MoneyAccountSubtype, { icon: string; tint: string }> = {
  cash: { icon: '💵', tint: 'bg-green-100' },
  bank: { icon: '🏦', tint: 'bg-blue-100' },
  savings: { icon: '🐖', tint: 'bg-amber-100' },
  time_deposit: { icon: '🔒', tint: 'bg-indigo-100' },
  ewallet: { icon: '📱', tint: 'bg-violet-100' },
  fund: { icon: '📈', tint: 'bg-cyan-100' },
  other_cash: { icon: '🧾', tint: 'bg-slate-100' },
};

/** The tile each family is drawn with. Its things share it, so a row says which family it came out of. */
const FAMILY_TILES: Record<OwnableFamily, { icon: string; tint: string }> = {
  receivable: { icon: '🤝', tint: 'bg-red-100' },
  invest: { icon: '📊', tint: 'bg-blue-100' },
  movable: { icon: '🚗', tint: 'bg-amber-100' },
  immovable: { icon: '🏠', tint: 'bg-rose-100' },
  other: { icon: '💎', tint: 'bg-violet-100' },
};

/** The tile each debt is drawn with, by the item's own id. */
const DEBT_TILES: Record<string, { icon: string; tint: string }> = {
  home_mortgage: { icon: '🏠', tint: 'bg-rose-100' },
  apartment_mortgage: { icon: '🏢', tint: 'bg-rose-100' },
  vehicle_leasing: { icon: '🚗', tint: 'bg-amber-100' },
  credit_card: { icon: '💳', tint: 'bg-blue-100' },
  multi_purpose_loan: { icon: '🧾', tint: 'bg-indigo-100' },
  personal_loan: { icon: '👤', tint: 'bg-green-100' },
  online_loan: { icon: '📲', tint: 'bg-violet-100' },
  affiliate_debt: { icon: '👨‍👩‍👧', tint: 'bg-red-100' },
  other_debt: { icon: '📌', tint: 'bg-slate-100' },
};

const PLAIN = { icon: '📦', tint: 'bg-slate-100' };

/** Which family an asset item came out of, so a search result is drawn in that family's colours. */
const FAMILY_OF_ITEM = new Map<string, OwnableFamily>(
  ASSET_FAMILIES.flatMap((family) => family.items.map((item) => [item.id, family.id] as const)),
);

function tileFor(flow: OwnableFlow, item: OwnableItem, family?: OwnableFamily): { icon: string; tint: string } {
  if (flow === 'account') return CASH_TILES[item.id as MoneyAccountSubtype] ?? PLAIN;
  if (flow === 'debt') return DEBT_TILES[item.id] ?? PLAIN;
  const from = family ?? FAMILY_OF_ITEM.get(item.id);
  return from ? FAMILY_TILES[from] : PLAIN;
}

const rowOf = (flow: OwnableFlow, item: OwnableItem, family?: OwnableFamily): PickerRow => ({
  id: item.id,
  label: item.label,
  sub: item.sub,
  ...tileFor(flow, item, family),
});

/** The id the "Something else" row carries, which is not an item: it opens the rest of the family's table. */
export const MORE_ROW_ID = 'more';

/**
 * The rows a picker draws for where it currently is.
 *
 * A typed query outranks everything: it searches the whole flow, families and all, because someone who knows
 * they own an apartment should not have to know which of five tables it lives in.
 */
export function pickerRows({ flow, query, family, more }: PickerQuery): PickerRow[] {
  const searching = searchTokens(query).length > 0;
  if (searching) return searchOwnables(query, flow).map((item) => rowOf(flow, item));
  if (flow !== 'asset') return searchOwnables('', flow).map((item) => rowOf(flow, item));
  if (!family) return ASSET_FAMILIES.map((entry) => ({ id: entry.id, label: entry.label, sub: entry.sub, ...FAMILY_TILES[entry.id] }));
  const spare = somethingElse(family);
  if (more) return spare.map((entry) => rowOf(flow, elseItem(family, entry.code), family));
  const rows = assetFamily(family).items.map((item) => rowOf(flow, item, family));
  if (spare.length === 0) return rows;
  return [...rows, { id: MORE_ROW_ID, label: 'Something else', sub: `${spare.length} more kinds the form knows`, icon: '＋', tint: 'bg-slate-100' }];
}

/** The two rows at the foot of a picker, saying where the thing it does not handle belongs instead. */
export function handOverRows(flow: OwnableFlow): HandOverRow[] {
  const toAsset: HandOverRow = {
    id: 'asset',
    label: 'Add an asset instead',
    sub: 'property, gold, shares, receivables',
    icon: '💎',
    tint: 'bg-violet-100',
    to: '/net-worth/assets/new',
  };
  const toDebt: HandOverRow = { id: 'debt', label: 'Add a debt instead', sub: 'card, mortgage, loan', icon: '💳', tint: 'bg-red-100', to: '/debts/new' };
  const toAccount: HandOverRow = {
    id: 'account',
    label: 'Add an account instead',
    sub: 'cash, bank, e-wallet, deposit',
    icon: '🏦',
    tint: 'bg-blue-100',
    to: '/accounts/new',
  };
  if (flow === 'account') return [toAsset, toDebt];
  if (flow === 'asset') return [toAccount, toDebt];
  return [toAccount, toAsset];
}

/** Every field a picker's form can ask for, past the name everything has. */
export type FieldKey = 'balance' | 'bank' | 'currency' | 'matures' | 'rate' | 'units' | 'price' | 'grams' | 'face' | 'value' | 'person' | 'owed' | 'lender' | 'term' | 'card';

/**
 * Money held at a bank or a broker: the accounts worth asking which institution, and the only ones that are
 * plausibly in a currency other than the one the workspace counts in. Cash in a wallet and an e-money balance
 * are neither.
 */
const AT_AN_INSTITUTION: readonly MoneyAccountSubtype[] = ['bank', 'savings', 'fund'];

/**
 * What the form after this choice asks for, past Name.
 *
 * Read off the item's behaviour rather than a second table beside the catalogue: units and a price for anything
 * counted in units, a face value for a bond, grams for gold, a typed value for everything else, and the two
 * names for money owed between people, whose amount the ledger keeps.
 */
export function fieldsFor(flow: OwnableFlow, id: string): FieldKey[] {
  const item = flow === 'account' ? cashItem(id as MoneyAccountSubtype) : flow === 'debt' ? debtItem(id) : assetItem(id);
  const { behaviour } = item;
  switch (behaviour.opens) {
    case 'money':
      if (behaviour.valuedBy === 'deposit') return ['balance', 'bank', 'matures', 'rate'];
      return AT_AN_INSTITUTION.includes(behaviour.subtype) ? ['balance', 'bank', 'currency'] : ['balance'];
    case 'holding':
      switch (behaviour.valuedBy) {
        case 'units':
          return ['units', 'price'];
        case 'face':
          return ['face', 'price'];
        case 'grams':
          return ['grams'];
        case 'balance':
          return ['balance'];
        default:
          return ['value'];
      }
    // Money lent is opened at the person; money borrowed is opened at what is owed. Each form leads with its own.
    case 'person':
      return behaviour.direction === 'lent' ? ['person', 'owed'] : ['owed', 'person'];
    case 'loan':
      return behaviour.asksRate ? ['owed', 'lender', 'rate', 'term'] : ['owed', 'lender', 'term'];
    case 'card':
      return ['card'];
  }
}
