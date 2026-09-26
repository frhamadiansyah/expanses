import {
  ASSET_FAMILIES,
  assetFamily,
  assetItem,
  CASH_ITEMS,
  cashItem,
  debtItem,
  elseItem,
  HARTA_ENGLISH,
  hartaLabel,
  type HartaFamily,
  KODE_HARTA,
  KODE_UTANG,
  type MoneyAccountSubtype,
  type OwnableFamily,
  type OwnableFlow,
  type OwnableItem,
  searchOwnables,
  searchTokens,
  somethingElse,
} from '@expanses/core';
import {
  Activity,
  BadgeCheck,
  Banknote,
  Bike,
  Boxes,
  Briefcase,
  Building2,
  Car,
  ChartCandlestick,
  ChartLine,
  Coins,
  CreditCard,
  Diamond,
  Frame,
  Gem,
  HandCoins,
  Handshake,
  House,
  KeyRound,
  Landmark,
  LandPlot,
  Laptop,
  Lightbulb,
  Lock,
  type LucideIcon,
  Package,
  PieChart,
  PiggyBank,
  Pin,
  Plus,
  Printer,
  ReceiptText,
  ScrollText,
  Smartphone,
  Sofa,
  Sparkles,
  Store,
  TrendingUp,
  Umbrella,
  User,
  Users,
  Wallet,
  Watch,
  Waypoints,
} from 'lucide-react';

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
  /** The glyph in the row's tile. Decoration: the label is the accessible name. */
  icon: LucideIcon;
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

/**
 * The tiles, out of the one set of drawings the app has.
 *
 * These were emoji once — a pig for a savings account, a house for a mortgage — and an emoji is a full-colour
 * picture from somebody else's system. Inside the kit's own 28 px circle it read as a sticker on a grey button,
 * and it made these rows the only place in the app where a glyph was not a stroke. Every other glyph a row or a
 * corner draws is one of these, at the size a row draws them, so these are too — and in the ink, so a tile says
 * which kind of thing it is rather than which country's vendor drew it.
 */
const CASH_TILES: Record<MoneyAccountSubtype, LucideIcon> = {
  cash: Banknote,
  bank: Landmark,
  savings: PiggyBank,
  time_deposit: Lock,
  ewallet: Smartphone,
  fund: TrendingUp,
  other_cash: Wallet,
};

/** The tile each family is drawn with — for the family's own row, and for a kind no table below names. */
const FAMILY_TILES: Record<OwnableFamily, LucideIcon> = {
  receivable: Handshake,
  invest: ChartLine,
  movable: Car,
  immovable: House,
  other: Gem,
};

/**
 * The tile each asset is drawn with, by the item's own id, in the catalogue's own order.
 *
 * A family has one drawing, and a screen that gave every row of one family that same drawing said nothing on
 * any of them: eight rows of `ChartLine` is eight rows of decoration. Each kind carries its own mark instead —
 * bars for listed shares, a plot for empty land, a key for what is rented out, an umbrella for insurance — so a
 * row's tile is the kind of thing it is, at the level where a person is choosing between them.
 *
 * Exported because a test holds it against the catalogue: a kind added there and not named here would fall back
 * to its family's drawing, which is the repetition this table exists to remove.
 */
export const ASSET_TILES: Record<string, LucideIcon> = {
  // Receivables: money owed to you, by whom.
  trade_receivable: Store,
  affiliate_receivable: Users,
  other_receivable: Boxes,
  // Investments.
  stock: ChartCandlestick,
  unlisted_stock: Briefcase,
  fund: PieChart,
  corporate_bond: ScrollText,
  bond: Landmark,
  derivative: Waypoints,
  endowment_insurance: Umbrella,
  unit_link: Activity,
  // Movable property.
  motorcycle: Bike,
  vehicle: Car,
  other_movable: Package,
  // Immovable property.
  property: House,
  apartment: Building2,
  empty_land: LandPlot,
  business_property: Store,
  rented_property: KeyRound,
  other_immovable: Package,
  // Intangible and other.
  gold: Coins,
  gold_jewellery: Sparkles,
  non_gold_bullion: Boxes,
  non_gold_jewellery: Watch,
  gemstone: Diamond,
  art: Frame,
  electronics: Laptop,
  furniture: Sofa,
  office_equipment: Printer,
  patent: Lightbulb,
  royalty: HandCoins,
  trademark: BadgeCheck,
  other: Package,
};

/** The tile each debt is drawn with, by the item's own id — the same drawings the Debts page gives the same kinds. */
const DEBT_TILES: Record<string, LucideIcon> = {
  home_mortgage: House,
  apartment_mortgage: Building2,
  vehicle_leasing: Car,
  credit_card: CreditCard,
  multi_purpose_loan: ReceiptText,
  personal_loan: User,
  online_loan: Smartphone,
  affiliate_debt: Users,
  other_debt: Pin,
};

/** A thing these tables do not name: a rare kind out of the catalogue, or a row that hands the flow over. */
const PLAIN = Package;

/** Which family an asset item came out of, so a search result is drawn in that family's colours. */
const FAMILY_OF_ITEM = new Map<string, OwnableFamily>(
  ASSET_FAMILIES.flatMap((family) => family.items.map((item) => [item.id, family.id] as const)),
);

function tileFor(flow: OwnableFlow, item: OwnableItem, family?: OwnableFamily): LucideIcon {
  if (flow === 'account') return CASH_TILES[item.id as MoneyAccountSubtype] ?? PLAIN;
  if (flow === 'debt') return DEBT_TILES[item.id] ?? PLAIN;
  // A kind the asset table does not name — one of the rare codes under "Something else" — falls back to its
  // family's own drawing, which is the most that can honestly be said about it.
  const from = family ?? FAMILY_OF_ITEM.get(item.id);
  return ASSET_TILES[item.id] ?? (from ? FAMILY_TILES[from] : PLAIN);
}

/**
 * The drawing a kind wears on the Assets page, the same one its picker row wears: a list of what you own and the
 * screen that added it say which kind of thing each one is with the same mark.
 *
 * Keyed by the drawer's own key and the section it sits in, because the two overlap: `fund` is a fund account under
 * cash and a mutual fund under investments. A kind no table names — an account read by its bare subtype — wears its
 * section's family drawing, as a rare code in the picker does.
 */
export function assetKindTile(section: string, key: string): LucideIcon {
  if (section === 'liquid') return CASH_TILES[key as MoneyAccountSubtype] ?? Wallet;
  return ASSET_TILES[key] ?? FAMILY_TILES[section as OwnableFamily] ?? PLAIN;
}

/**
 * The drawing a whole section of the balance sheet wears: its family's, as the add-asset picker's first list draws
 * it. Cash is no family there — money is an account — so it wears the drawing of the row that hands over to accounts.
 */
export const assetSectionTile = (section: string): LucideIcon => (section === 'liquid' ? Landmark : (FAMILY_TILES[section as OwnableFamily] ?? PLAIN));

/** The two debt drawers no catalogue item names, drawn as the picker draws their nearest kind. */
const PLAIN_DEBT_TILES: Record<string, LucideIcon> = { other_loans: ReceiptText, payable: User };

/** The drawing a kind of debt wears on the Liabilities page: the one the debt picker gives the same kind. */
export const debtKindTile = (key: string): LucideIcon => DEBT_TILES[key] ?? PLAIN_DEBT_TILES[key] ?? PLAIN;

const rowOf = (flow: OwnableFlow, item: OwnableItem, family?: OwnableFamily): PickerRow => ({
  id: item.id,
  label: item.label,
  sub: item.sub,
  icon: tileFor(flow, item, family),
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
  const offered = (items: readonly OwnableItem[]) => items.filter((item) => item.inPicker !== false);
  if (searching) return offered(searchOwnables(query, flow)).map((item) => rowOf(flow, item));
  if (flow !== 'asset') return offered(searchOwnables('', flow)).map((item) => rowOf(flow, item));
  if (!family) return ASSET_FAMILIES.map((entry) => ({ id: entry.id, label: entry.label, sub: entry.sub, icon: FAMILY_TILES[entry.id] }));
  const spare = somethingElse(family);
  if (more) return spare.map((entry) => rowOf(flow, elseItem(family, entry.code), family));
  const rows = assetFamily(family).items.map((item) => rowOf(flow, item, family));
  if (spare.length === 0) return rows;
  return [...rows, { id: MORE_ROW_ID, label: 'Something else', sub: `${spare.length} more kinds the form knows`, icon: Plus }];
}

/** The two rows at the foot of a picker, saying where the thing it does not handle belongs instead. */
export function handOverRows(flow: OwnableFlow): HandOverRow[] {
  const toAsset: HandOverRow = {
    id: 'asset',
    label: 'Add an asset instead',
    sub: 'property, gold, shares, receivables',
    icon: Gem,
    to: '/net-worth/assets/new',
  };
  const toDebt: HandOverRow = { id: 'debt', label: 'Add a debt instead', sub: 'card, mortgage, loan', icon: CreditCard, to: '/debts/new' };
  const toAccount: HandOverRow = {
    id: 'account',
    label: 'Add an account instead',
    sub: 'cash, bank, e-wallet, deposit',
    icon: Landmark,
    to: '/accounts/new',
  };
  if (flow === 'account') return [toAsset, toDebt];
  if (flow === 'asset') return [toAccount, toDebt];
  return [toAccount, toAsset];
}

/** Every field a picker's form can ask for, past the name everything has. */
export type FieldKey = 'balance' | 'bank' | 'currency' | 'matures' | 'rate' | 'units' | 'price' | 'grams' | 'face' | 'value' | 'person' | 'owed' | 'lender' | 'term' | 'card';

/**
 * Money held at a bank or a broker: the accounts worth asking which institution for, because the tax report
 * wants the institution's name on their kas row. Cash in a pocket and an e-money balance have no institution.
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
    // Every money account is asked which currency it holds. Dollars in a wallet, euros in cash and a deposit in
    // Singapore are all ordinary; taking the workspace's own currency without asking would silently mis-state them.
    case 'money':
      if (behaviour.valuedBy === 'deposit') return ['balance', 'bank', 'currency', 'matures', 'rate'];
      return AT_AN_INSTITUTION.includes(behaviour.subtype) ? ['balance', 'bank', 'currency'] : ['balance', 'currency'];
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

/**
 * Changing what a thing files as, after it exists.
 *
 * The picker hides the code while someone is choosing, which is right: nobody owns a "0503". Afterwards is the
 * other way round — the thing is on its own page, the code is printed there, and the only useful question is
 * "which of these is it really?". So the same words the picker used are offered again, now as a list to change.
 *
 * Only the code's own table is offered. A code is what the tax report files the row under, and a row cannot move
 * between Lampiran 1's tables without becoming a different thing: a flat is not a receivable. Anything the table
 * does not name is reached by typing the four digits, which is why that box never goes away.
 */

/** One line of the code picker: the words, the code behind them, and a value of its own. */
export interface CodeChoice {
  /** Unique within the picker. Two items can share a code — a current account and a savings account are both
   *  0102 — and a `select` that keyed on the code alone could not keep them apart. */
  value: string;
  code: string;
  label: string;
}

export interface CodeChoiceGroup {
  label: string;
  choices: CodeChoice[];
}

/** What the whole cash table is called on the screen that opens one. Not an asset family: money is an account. */
const KAS_LABEL = 'Cash and cash equivalents';

const FAMILY_LABELS: Record<HartaFamily, string> = {
  kas: KAS_LABEL,
  piutang: assetFamily('receivable').label,
  investasi: assetFamily('invest').label,
  bergerak: assetFamily('movable').label,
  tidak_bergerak: assetFamily('immovable').label,
  lainnya: assetFamily('other').label,
};

/** The items the app names in each harta table, in the order its own picker lists them. */
const NAMED_ITEMS: Record<HartaFamily, readonly OwnableItem[]> = {
  kas: CASH_ITEMS,
  piutang: assetFamily('receivable').items,
  investasi: assetFamily('invest').items,
  bergerak: assetFamily('movable').items,
  tidak_bergerak: assetFamily('immovable').items,
  lainnya: assetFamily('other').items,
};

const HARTA_FAMILIES = Object.keys(FAMILY_LABELS) as HartaFamily[];

const familyOfCode = (code: string): HartaFamily | null => KODE_HARTA.find((entry) => entry.code === code)?.family ?? null;

/**
 * The rest of a harta table: every code its named items have not already spent. English where the catalogue has
 * a word for it; otherwise what the form itself calls it, which for Giro or Cek is the only name there is.
 */
function spareCodes(family: HartaFamily): CodeChoice[] {
  const spent = new Set(NAMED_ITEMS[family].map((item) => item.code));
  return KODE_HARTA.filter((entry) => entry.family === family && !spent.has(entry.code)).map((entry) => ({
    value: `code:${entry.code}`,
    code: entry.code,
    label: (HARTA_ENGLISH as Record<string, string>)[entry.code] ?? entry.label,
  }));
}

const namedChoices = (family: HartaFamily): CodeChoice[] => NAMED_ITEMS[family].map((item) => ({ value: item.id, code: item.code, label: item.label }));

/** The four kode utang, said the way the debt picker says them rather than in the form's own sentence-long Indonesian. */
export const UTANG_CHOICES: readonly CodeChoice[] = [
  { value: '101', code: '101', label: 'Bank or finance-company loan' },
  { value: '102', code: '102', label: 'Credit card' },
  { value: '103', code: '103', label: 'Affiliate debt — family or a related company' },
  { value: '109', code: '109', label: 'Other debts' },
];

/**
 * What a thing already filed under `code` can be changed to: its own table's named items, then what is left of
 * that table under "Something else". A code the tables do not name — or none yet — opens every table instead,
 * because there is nothing to narrow by and a house must still be reachable.
 */
export function codeChoices(flow: OwnableFlow, code: string): CodeChoiceGroup[] {
  if (flow === 'debt') return [{ label: 'Payables', choices: [...UTANG_CHOICES] }];
  const family = familyOfCode(code);
  if (!family) {
    return HARTA_FAMILIES.map((one) => ({ label: FAMILY_LABELS[one], choices: [...namedChoices(one), ...spareCodes(one)] })).filter((group) => group.choices.length > 0);
  }
  const spare = spareCodes(family);
  const groups: CodeChoiceGroup[] = [{ label: FAMILY_LABELS[family], choices: namedChoices(family) }];
  if (spare.length > 0) groups.push({ label: 'Something else', choices: spare });
  return groups;
}

/** The codes a person's debt may file under: the receivable table for money owed to you, the kode utang for money you owe. */
export function personCodeChoices(direction: 'lent' | 'borrowed'): CodeChoice[] {
  // Never 102: a credit card is a card, and it has a form of its own.
  if (direction === 'borrowed') return UTANG_CHOICES.filter((choice) => choice.code !== '102');
  return namedChoices('piutang');
}

/**
 * The choice a code currently stands for, so a list opens on what the thing already is. Null when nothing names it.
 *
 * Two items can share a code — a current account and a saving account are both 0102, a fund account and other
 * cash equivalents both 0109 — and the code alone cannot tell them apart. The thing itself can: `value` is its
 * own item id, which for a money account is its subtype. It only ever chooses between choices that already
 * carry the right code, so a hint that belongs to another table changes nothing.
 */
export function choiceForCode(groups: readonly CodeChoiceGroup[], code: string, value?: string): CodeChoice | null {
  const sharing = groups.flatMap((group) => group.choices.filter((choice) => choice.code === code));
  return sharing.find((choice) => choice.value === value) ?? sharing[0] ?? null;
}

/** What a harta or utang code is called on the form itself. Empty when neither table knows it. */
export const codeLabel = (flow: OwnableFlow, code: string): string => (flow === 'debt' ? (KODE_UTANG.find((entry) => entry.code === code)?.label ?? '') : hartaLabel(code));
