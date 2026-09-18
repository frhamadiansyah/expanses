import type { AssetKind, AssetSubtype, PlanGroup, UnitKind } from './presets';
import type { CoretaxSection } from './coretax-fields';
import { type CoretaxCode, type HartaFamily, KODE_HARTA, KODE_UTANG, sectionOfCode } from '../coretax/codes';
import { searchTokens } from '../entry/quick-entry';

/**
 * One table for everything a person can own: the source both pickers and both existing forms read,
 * so a choice fixes the Coretax code and the behaviour together. See
 * docs/superpowers/specs/2026-09-18-coretax-pickers-design.md §2.
 */

export type OwnableFlow = 'account' | 'asset' | 'debt';
export type OwnableFamily = 'receivable' | 'invest' | 'movable' | 'immovable' | 'other';

/** The seven kinds of account that hold money. Mirrored by `AccountSubtype` in packages/db; a test holds them in step. */
export type MoneyAccountSubtype = 'cash' | 'bank' | 'savings' | 'time_deposit' | 'ewallet' | 'fund' | 'other_cash';

export type OwnableBehaviour =
  | { opens: 'money'; subtype: MoneyAccountSubtype; valuedBy: 'balance' | 'deposit'; spendable: boolean }
  | {
      opens: 'holding';
      assetKind: AssetKind;
      subtype: AssetSubtype;
      planGroup: PlanGroup;
      valuedBy: 'units' | 'face' | 'grams' | 'value' | 'balance';
      unitKind: UnitKind | null;
      lotSize: number | null;
      priceLabel: string | null;
      /** Gold jewellery: grams × the gold price, or a value typed instead. */
      orTyped?: true;
    }
  | { opens: 'person'; direction: 'lent' | 'borrowed'; valuedBy: 'ledger' }
  | { opens: 'loan'; valuedBy: 'loan'; asksRate: boolean }
  | { opens: 'card'; valuedBy: 'card' };

export interface OwnableItem {
  id: string;
  label: string;
  /** The quiet line under the label in the picker. */
  sub: string;
  code: string;
  /** The Coretax table it files under. Null for a debt: Bagian B is one table. */
  section: CoretaxSection | null;
  behaviour: OwnableBehaviour;
}

export interface OwnableFamilyRow {
  id: OwnableFamily;
  label: string;
  sub: string;
  section: CoretaxSection;
  hartaFamily: HartaFamily;
  items: readonly OwnableItem[];
}

/** Every way an item can be valued — the union `VALUED_BY_WORDS` must have a gloss for, no more and no less. */
type ValuedByWord = Extract<OwnableBehaviour, { opens: 'holding' }>['valuedBy'] | 'ledger';

/** The quiet line under an item, naming how it is valued — the mockup's own words. */
const VALUED_BY_WORDS: Record<ValuedByWord, string> = {
  units: 'units × price',
  face: 'face value × price',
  grams: 'grams × gold price',
  value: 'a value you type',
  ledger: 'from what people owe you',
  balance: 'the balance you hold',
};

const money = (
  subtype: MoneyAccountSubtype,
  label: string,
  sub: string,
  code: string,
  opts: { valuedBy?: 'balance' | 'deposit'; spendable?: boolean } = {},
): OwnableItem => ({
  id: subtype,
  label,
  sub,
  code,
  section: 'kas',
  behaviour: { opens: 'money', subtype, valuedBy: opts.valuedBy ?? 'balance', spendable: opts.spendable ?? true },
});

const holding = (
  id: string,
  label: string,
  code: string,
  behaviour: Omit<Extract<OwnableBehaviour, { opens: 'holding' }>, 'opens'>,
  sub?: string,
): OwnableItem => ({
  id,
  label,
  sub: sub ?? VALUED_BY_WORDS[behaviour.valuedBy],
  code,
  section: sectionOfCode(code),
  behaviour: { opens: 'holding', ...behaviour },
});

const receivable = (id: string, label: string, code: string): OwnableItem => ({
  id,
  label,
  sub: VALUED_BY_WORDS.ledger,
  code,
  section: sectionOfCode(code),
  behaviour: { opens: 'person', direction: 'lent', valuedBy: 'ledger' },
});

/**
 * §2.3 — every row `section: 'kas'`, `behaviour.opens: 'money'`, in the order the screen lists them.
 *
 * A label here is the app's own name for that kind of account, character for character: the Accounts page prints
 * `SUBTYPE_LABELS` beside every account and offers the same words in its Type select, and one kind of account
 * called two things is one kind of account nobody can match up. A test in apps/web holds the two lists in step.
 * The quiet line carries the words the label dropped, so searching for "bank" or "electronic money" still lands.
 */
export const CASH_ITEMS: readonly OwnableItem[] = [
  money('cash', 'Cash', 'banknotes and coins', '0101'),
  money('bank', 'Current account', 'everyday account at a bank', '0102'),
  money('savings', 'Saving account', 'money set aside', '0102'),
  money('time_deposit', 'Time deposit', 'locked until it matures', '0104', { valuedBy: 'deposit', spendable: false }),
  money('ewallet', 'Digital wallet', 'electronic money — GoPay, OVO, DANA', '0105'),
  money('fund', 'Fund account', 'broker or RDN cash', '0109'),
  money('other_cash', 'Other cash equivalents', 'cheque, wesel, commercial paper', '0109'),
];

const CASH_BY_SUBTYPE = new Map(CASH_ITEMS.map((item) => [item.id, item]));

export function cashItem(subtype: MoneyAccountSubtype): OwnableItem {
  const item = CASH_BY_SUBTYPE.get(subtype);
  if (!item) throw new Error(`Unknown money account subtype "${subtype}"`);
  return item;
}

const CASH_CODE_BY_SUBTYPE: Record<MoneyAccountSubtype, string> = {
  cash: '0101',
  bank: '0102',
  savings: '0102',
  time_deposit: '0104',
  ewallet: '0105',
  fund: '0109',
  other_cash: '0109',
};

/** The default kas code for any subtype string. Falls back to Tabungan (0102) for anything it does not know. */
export function cashCodeForSubtype(subtype: string): string {
  return CASH_CODE_BY_SUBTYPE[subtype as MoneyAccountSubtype] ?? '0102';
}

/** §2.4 receivables — value comes from the Lend & borrow ledger, not typed. */
const RECEIVABLE_ITEMS: readonly OwnableItem[] = [
  receivable('trade_receivable', 'Trade receivables', '0201'),
  receivable('affiliate_receivable', 'Affiliate receivables', '0202'),
  receivable('other_receivable', 'Other receivables', '0209'),
];

/** §2.4 investments — every row `subtype: 'investment'`, `planGroup: 'invest'`. */
const INVEST_ITEMS: readonly OwnableItem[] = [
  holding('stock', 'Listed shares', '0303', {
    assetKind: 'stock',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'units',
    unitKind: 'shares',
    lotSize: 100,
    priceLabel: 'Closing price',
  }),
  holding('unlisted_stock', 'Unlisted stocks', '0302', {
    assetKind: 'other',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'value',
    unitKind: null,
    lotSize: null,
    priceLabel: null,
  }),
  holding('fund', 'Mutual fund (reksadana)', '0307', {
    assetKind: 'fund',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'units',
    unitKind: 'units',
    lotSize: null,
    priceLabel: 'NAV per unit',
  }),
  holding('corporate_bond', 'Corporate bonds', '0304', {
    assetKind: 'bond',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'face',
    unitKind: 'face',
    lotSize: null,
    priceLabel: 'Face value',
  }),
  holding('bond', 'Government bonds (ORI, SBSN)', '0305', {
    assetKind: 'bond',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'face',
    unitKind: 'face',
    lotSize: null,
    priceLabel: 'Face value',
  }),
  holding('derivative', 'Derivatives', '0308', {
    assetKind: 'other',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'value',
    unitKind: null,
    lotSize: null,
    priceLabel: null,
  }),
  holding('endowment_insurance', 'Endowment insurance', '0310', {
    assetKind: 'other',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'value',
    unitKind: null,
    lotSize: null,
    priceLabel: null,
  }),
  holding('unit_link', 'Unit-linked insurance', '0311', {
    assetKind: 'other',
    subtype: 'investment',
    planGroup: 'invest',
    valuedBy: 'value',
    unitKind: null,
    lotSize: null,
    priceLabel: null,
  }),
];

/** §2.4 movable property — every row `assetKind: 'vehicle'`, `subtype: 'vehicle'`, `planGroup: 'use'`. */
const MOVABLE_ITEMS: readonly OwnableItem[] = [
  holding('motorcycle', 'Motorcycle', '0402', { assetKind: 'vehicle', subtype: 'vehicle', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('vehicle', 'Passenger car', '0403', { assetKind: 'vehicle', subtype: 'vehicle', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('other_movable', 'Other movable property', '0499', { assetKind: 'vehicle', subtype: 'vehicle', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
];

/** §2.4 immovable property — every row `assetKind: 'property'`, `subtype: 'property'`, `planGroup: 'use'`. */
const IMMOVABLE_ITEMS: readonly OwnableItem[] = [
  holding('property', 'Land and/or building for living in', '0502', { assetKind: 'property', subtype: 'property', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('apartment', 'Apartment', '0503', { assetKind: 'property', subtype: 'property', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('empty_land', 'Empty land', '0501', { assetKind: 'property', subtype: 'property', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('business_property', 'Land and/or building for business', '0506', { assetKind: 'property', subtype: 'property', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('rented_property', 'Land and/or building rented out', '0507', { assetKind: 'property', subtype: 'property', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('other_immovable', 'Other immovable property', '0509', { assetKind: 'property', subtype: 'property', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
];

/** §2.4 intangible and other — every row `subtype: 'investment'`. */
const OTHER_ITEMS: readonly OwnableItem[] = [
  holding('gold', 'Gold bullion', '0701', { assetKind: 'gold', subtype: 'investment', planGroup: 'invest', valuedBy: 'grams', unitKind: 'grams', lotSize: null, priceLabel: 'Buyback price per gram' }),
  holding('gold_jewellery', 'Gold jewellery', '0702', { assetKind: 'gold', subtype: 'investment', planGroup: 'invest', valuedBy: 'grams', unitKind: 'grams', lotSize: null, priceLabel: 'Buyback price per gram', orTyped: true }, 'grams (or a value you type)'),
  holding('non_gold_bullion', 'Non-gold bullion', '0703', { assetKind: 'other', subtype: 'investment', planGroup: 'invest', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('non_gold_jewellery', 'Non-gold jewellery', '0704', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('gemstone', 'Gemstones', '0705', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('art', 'Art and antiques', '0706', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('electronics', 'Electronics', '0708', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('furniture', 'Household furniture', '0709', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('office_equipment', 'Office equipment', '0710', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('patent', 'Patent', '0601', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('royalty', 'Royalty', '0602', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('trademark', 'Trademark', '0603', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
  holding('other', 'Other property', '0799', { assetKind: 'other', subtype: 'investment', planGroup: 'use', valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null }),
];

/** The legacy asset item — kept for what is already there, never offered in the picker. See §2.4. */
const LEGACY_CASH_ASSET: OwnableItem = {
  id: 'cash',
  label: 'Bank, cash or deposit',
  sub: 'better added as an account',
  code: '0102',
  section: 'kas',
  behaviour: { opens: 'holding', assetKind: 'cash', subtype: 'bank', planGroup: 'liquid', valuedBy: 'balance', unitKind: null, lotSize: null, priceLabel: null },
};

/** §2.4 — the five families, in the order the screen lists them. */
export const ASSET_FAMILIES: readonly OwnableFamilyRow[] = [
  { id: 'receivable', label: 'Receivables', sub: 'money owed to you', section: 'piutang', hartaFamily: 'piutang', items: RECEIVABLE_ITEMS },
  { id: 'invest', label: 'Investments', sub: 'shares, bonds, funds, insurance', section: 'investasi', hartaFamily: 'investasi', items: INVEST_ITEMS },
  { id: 'movable', label: 'Movable property', sub: 'vehicles and machinery', section: 'bergerak', hartaFamily: 'bergerak', items: MOVABLE_ITEMS },
  { id: 'immovable', label: 'Immovable property', sub: 'land and buildings', section: 'tidak_bergerak', hartaFamily: 'tidak_bergerak', items: IMMOVABLE_ITEMS },
  { id: 'other', label: 'Intangible and other', sub: 'gold, jewellery, patents, things', section: 'lainnya', hartaFamily: 'lainnya', items: OTHER_ITEMS },
];

/** Every family's items plus the legacy `cash` item — never the families themselves, which exclude it. */
export const ASSET_ITEMS: readonly OwnableItem[] = [...ASSET_FAMILIES.flatMap((family) => family.items), LEGACY_CASH_ASSET];

const ASSET_BY_ID = new Map(ASSET_ITEMS.map((item) => [item.id, item]));
const FAMILY_BY_ID = new Map(ASSET_FAMILIES.map((family) => [family.id, family]));

export function assetFamily(id: OwnableFamily): OwnableFamilyRow {
  const family = FAMILY_BY_ID.get(id);
  if (!family) throw new Error(`Unknown asset family "${id}"`);
  return family;
}

/** How an "else:NNNN" id is built by `elseItem`, and read back by `assetItem`. */
const elseId = (code: string) => `else:${code}`;

export function assetItem(id: string): OwnableItem {
  if (id.startsWith('else:')) {
    const code = id.slice('else:'.length);
    for (const family of ASSET_FAMILIES) {
      if (somethingElse(family.id).some((entry) => entry.code === code)) return elseItem(family.id, code);
    }
    throw new Error(`Unknown asset id "${id}"`);
  }
  const item = ASSET_BY_ID.get(id);
  if (!item) throw new Error(`Unknown asset id "${id}"`);
  return item;
}

/** §2.5 — every `KODE_HARTA` entry the family's own items have not already spent, in `KODE_HARTA`'s order. */
export function somethingElse(id: OwnableFamily): CoretaxCode[] {
  const family = assetFamily(id);
  const spent = new Set(family.items.map((item) => item.code));
  return KODE_HARTA.filter((entry) => entry.family === family.hartaFamily && !spent.has(entry.code));
}

/** Every code reachable through "Something else" (§2.5) — the union `HARTA_ENGLISH` must gloss, no more and no less. */
type SomethingElseCode =
  | '0301' | '0306' | '0309' | '0399'
  | '0401' | '0404' | '0405' | '0406' | '0407' | '0408' | '0409' | '0410' | '0411' | '0412'
  | '0504' | '0505'
  | '0699' | '0707' | '0711' | '0712';

/** English gloss for a "Something else" code, in the mockup's own words. Only the reachable codes need one. */
export const HARTA_ENGLISH: Record<SomethingElseCode, string> = {
  '0301': 'Shares bought to resell',
  '0306': 'Other debt securities',
  '0309': 'Equity not in share form',
  '0399': 'Other investments',
  '0401': 'Bicycle',
  '0404': 'Bus',
  '0405': 'Road transport vehicle',
  '0406': 'Special-purpose vehicle',
  '0407': 'Train',
  '0408': 'Aircraft',
  '0409': 'Ship',
  '0410': 'Machinery',
  '0411': 'Cart',
  '0412': 'Yacht',
  '0504': 'Vessel',
  '0505': 'Land for business',
  '0699': 'Other intangible property',
  '0707': 'Special sports equipment',
  '0711': 'Jet ski',
  '0712': 'Business inventory',
};

/** The `assetKind` / `subtype` / `planGroup` a "Something else" holding takes, by the family it came out of. */
const ELSE_BEHAVIOUR: Record<OwnableFamily, { assetKind: AssetKind; subtype: AssetSubtype; planGroup: PlanGroup }> = {
  receivable: { assetKind: 'other', subtype: 'investment', planGroup: 'invest' },
  invest: { assetKind: 'other', subtype: 'investment', planGroup: 'invest' },
  movable: { assetKind: 'vehicle', subtype: 'vehicle', planGroup: 'use' },
  immovable: { assetKind: 'property', subtype: 'property', planGroup: 'use' },
  other: { assetKind: 'other', subtype: 'investment', planGroup: 'use' },
};

/** §2.5 — the typed-value item a "Something else" row stands for. Throws unless the family has that code spare. */
export function elseItem(id: OwnableFamily, code: string): OwnableItem {
  const spare = somethingElse(id);
  if (!spare.some((entry) => entry.code === code)) throw new Error(`Family "${id}" has no spare code "${code}"`);
  // Verified above: every reachable "Something else" code is a SomethingElseCode, so HARTA_ENGLISH always has it.
  const label = HARTA_ENGLISH[code as SomethingElseCode];
  const { assetKind, subtype, planGroup } = ELSE_BEHAVIOUR[id];
  return {
    id: elseId(code),
    label,
    sub: label,
    code,
    section: sectionOfCode(code),
    behaviour: { opens: 'holding', assetKind, subtype, planGroup, valuedBy: 'value', unitKind: null, lotSize: null, priceLabel: null },
  };
}

/** §2.6 — no section: Bagian B is one table. Order follows the mockup. */
export const DEBT_ITEMS: readonly OwnableItem[] = [
  { id: 'home_mortgage', label: 'Home mortgage', sub: 'owed, lender, rate, months left', code: '101', section: null, behaviour: { opens: 'loan', valuedBy: 'loan', asksRate: true } },
  { id: 'apartment_mortgage', label: 'Apartment mortgage', sub: 'owed, lender, rate, months left', code: '101', section: null, behaviour: { opens: 'loan', valuedBy: 'loan', asksRate: true } },
  { id: 'vehicle_leasing', label: 'Vehicle leasing', sub: 'owed, lender, rate, months left', code: '101', section: null, behaviour: { opens: 'loan', valuedBy: 'loan', asksRate: true } },
  { id: 'credit_card', label: 'Credit card', sub: "the card's own form", code: '102', section: null, behaviour: { opens: 'card', valuedBy: 'card' } },
  { id: 'multi_purpose_loan', label: 'Multi-purpose loan', sub: 'owed, lender, rate, months left', code: '101', section: null, behaviour: { opens: 'loan', valuedBy: 'loan', asksRate: true } },
  { id: 'personal_loan', label: 'Personal loan', sub: 'owed, lender, rate, months left', code: '101', section: null, behaviour: { opens: 'loan', valuedBy: 'loan', asksRate: true } },
  { id: 'online_loan', label: 'Online loan or paylater', sub: 'owed, lender, months left', code: '101', section: null, behaviour: { opens: 'loan', valuedBy: 'loan', asksRate: false } },
  { id: 'affiliate_debt', label: 'Affiliate debt — family or a related company', sub: 'owed, who', code: '103', section: null, behaviour: { opens: 'person', direction: 'borrowed', valuedBy: 'ledger' } },
  { id: 'other_debt', label: 'Other debts', sub: 'owed, who', code: '109', section: null, behaviour: { opens: 'person', direction: 'borrowed', valuedBy: 'ledger' } },
];

const DEBT_BY_ID = new Map(DEBT_ITEMS.map((item) => [item.id, item]));

export function debtItem(id: string): OwnableItem {
  const item = DEBT_BY_ID.get(id);
  if (!item) throw new Error(`Unknown debt id "${id}"`);
  return item;
}

const FLOW_ITEMS: Record<OwnableFlow, readonly OwnableItem[]> = {
  account: CASH_ITEMS,
  asset: ASSET_ITEMS,
  debt: DEBT_ITEMS,
};

/**
 * The words an item can be found by: label, sub-line and code, lower-cased and split apart. A hyphen
 * stays inside its word ("non-gold" is one word) so a query for "gold" never lands on "Non-gold
 * jewellery" — only on words that actually are "gold".
 */
function ownableWords(item: OwnableItem): string[] {
  return `${item.label} ${item.sub} ${item.code}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean);
}

/**
 * Items of a flow matching every token of the query, by label, sub-line and code. Each token has to be
 * the start of some word — prefix, not substring — so typing "unit" finds "Unit-linked insurance" as
 * it is typed, while "gold" still never lands inside "Non-gold jewellery" (a hyphen keeps that one
 * word). An empty query is everything.
 */
export function searchOwnables(query: string, flow: OwnableFlow): readonly OwnableItem[] {
  const items = FLOW_ITEMS[flow];
  const tokens = searchTokens(query);
  if (!tokens.length) return items;
  return items.filter((item) => {
    const words = ownableWords(item);
    return tokens.every((t) => words.some((w) => w.startsWith(t)));
  });
}
