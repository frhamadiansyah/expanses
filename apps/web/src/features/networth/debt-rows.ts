import { balanceSheet, convertMinor, currencyInfo, displayAmount, formatMinor, periodOn, type SheetLiability, sumToBase } from '@expanses/core';
import type { AccountRow, LoanTermsRow, PersonDebtRow } from '@expanses/db';
import { totalOf } from './asset-rows';

/**
 * The Debts page: everything owed, grouped the way the Assets page groups what is owned.
 *
 * Nothing here works a balance out. A loan and a card owe what the ledger says they owe (the same reading the
 * card's own page calls its current balance: billed and unbilled, instalments included), a person is owed what the
 * Lend & borrow ledger says, and the due-within-a-year split is the balance sheet's own. What this file does is
 * sort those readings into groups and add them up through `sumToBase` — every rate, or no total and the rate named.
 */

export type DebtKind = 'loan' | 'card' | 'person';
export type DebtIcon = 'home' | 'car' | 'loan' | 'card' | 'person';

export type DebtAccount = Pick<AccountRow, 'id' | 'name' | 'kind' | 'subtype' | 'currency' | 'archivedAt'>;

/** What a card's last statement says, read by the card's own statement reader — never rebuilt here. */
export interface CardFacts {
  last4: string | null;
  /** False until the card has a billing date, and so no statements to read. */
  hasTerms: boolean;
  /** When the last statement's bill is due, or null with nothing to pay. */
  dueOn: string | null;
  /** What the last statement closed at. Nothing or less means nothing was billed. */
  billedMinor: number;
  /** What is left of that bill. */
  leftToPayMinor: number;
}

export interface DebtRow {
  key: string;
  kind: DebtKind;
  /** The account a loan or a card opens; the account an unnamed payable sits in. Null for a person. */
  accountId: string | null;
  /** The person Lend & borrow is opened for. Null for anything else. */
  personName: string | null;
  name: string;
  detail: string;
  icon: DebtIcon;
  last4: string | null;
  /** What is owed, in the debt's own currency. */
  minor: number;
  currency: string;
  /** The same in the base currency, or null when there is no rate. */
  baseMinor: number | null;
  /** The currency without a rate, when there is one. */
  missing: string | null;
  /** The rate `baseMinor` was worked at, for the desktop's "at 16.200". Null in the base currency. */
  rate: number | null;
}

export interface DebtGroup {
  kind: DebtKind;
  label: string;
  /** The group in the base currency, or null when a rate is missing — never the sum of the rest. */
  totalMinor: number | null;
  missing: string[];
  rows: DebtRow[];
}

export interface ClearedLoan {
  accountId: string;
  name: string;
  clearedOn: string | null;
}

export interface DueSplit {
  withinYearMinor: number | null;
  longTermMinor: number | null;
  missing: string[];
}

export interface DebtSheet {
  groups: DebtGroup[];
  total: { totalMinor: number | null; missing: string[] };
  cleared: ClearedLoan[];
  due: DueSplit;
}

export interface DebtInputs {
  /** Every account; the liabilities are picked out here, and a loan's asset is looked up among the rest. */
  accounts: readonly DebtAccount[];
  /** The ledger's native balances, raw (a liability is negative). */
  balances: Readonly<Record<string, number>>;
  loans: readonly LoanTermsRow[];
  cards: Readonly<Record<string, CardFacts>>;
  /** The people you owe, as Lend & borrow lists them: one per person per currency. */
  people: readonly PersonDebtRow[];
  /** The balance sheet's inputs, for the due split. Null until they are read. */
  /**
   * The balance sheet's own reading, exactly as `sheetInputsAt` hands it over: the liabilities, and one `missing`
   * list collected across *both* sides of the sheet. Only `liabilities` is read here — see `dueSplit` for why.
   */
  sheet: { liabilities: readonly SheetLiability[]; missing: readonly string[] } | null;
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
}

export const DEBT_GROUP_LABELS: Record<DebtKind, string> = { loan: 'Loans', card: 'Credit cards', person: 'Payables' };
const ORDER: DebtKind[] = ['loan', 'card', 'person'];

/** A figure without its symbol, in its currency's decimals: `712.500.000`, `40,00`. For a row under a header that names the currency. */
export function bareFigure(minor: number, currency: string, locale = 'id-ID'): string {
  const { exponent } = currencyInfo(currency);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(minor / 10 ** exponent);
}

/** `2 Sep`: day first, and the three-letter month on every engine (en-GB writes "Sept" on some). */
export const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}`;
const percent = (bps: number) => `${(bps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;

function converted(minor: number, currency: string, baseCurrency: string, rates: Readonly<Record<string, number>>) {
  if (currency === baseCurrency) return { baseMinor: minor, missing: null, rate: null };
  const rate = rates[currency];
  if (rate === undefined || !(rate > 0)) return { baseMinor: minor === 0 ? 0 : null, missing: minor === 0 ? null : currency, rate: null };
  return { baseMinor: convertMinor(minor, currency, baseCurrency, rate), missing: null, rate };
}

function loanDetail(terms: LoanTermsRow | undefined, today: string): string {
  if (!terms) return 'no terms yet';
  const rate = periodOn(terms.periods, today)?.rateBps ?? 0;
  return [terms.lenderName, percent(rate), `${terms.tenorMonths} months`, terms.isHomeLoan ? 'mortgage' : null].filter(Boolean).join(' · ');
}

function cardDetail(facts: CardFacts | undefined, owedMinor: number, currency: string): string {
  if (!facts || !facts.hasTerms) return 'add the billing date';
  if (facts.billedMinor <= 0) return 'nothing billed';
  const unbilled = owedMinor - facts.leftToPayMinor;
  const tail = unbilled > 0 ? ` · ${bareFigure(unbilled, currency)} unbilled` : '';
  if (facts.leftToPayMinor > 0 && facts.dueOn) return `due ${dayMonth(facts.dueOn)}${tail}`;
  return `bill paid${tail}`;
}

/**
 * What a loan or a card owes: the ledger's balance, billed and unbilled, instalments included, and never below
 * nothing (a card paid past its bill owes nothing). The card's own page reads its Unpaid tile and its current
 * balance from here, so the Debts page and the card can never disagree.
 */
export function owedMinor(balances: Readonly<Record<string, number>>, accountId: string): number {
  return Math.max(0, displayAmount('liability', balances[accountId] ?? 0));
}

/**
 * What a card has been paid past what it owed: money the bank holds for you, in the card's own currency. Nothing
 * while anything is owed. `owedMinor` stays at nothing for such a card, so the Debts total never nets it off.
 */
export function creditMinor(balances: Readonly<Record<string, number>>, accountId: string): number {
  return Math.max(0, -displayAmount('liability', balances[accountId] ?? 0));
}

/** The line an overpaid card carries, on its Unpaid tile and as its Debts row's subtitle: `Credit Rp 250.000`. */
export const creditLine = (minor: number, currency: string) => `Credit ${formatMinor(minor, currency)}`;

/**
 * Everything owed, in three groups. `today` picks each loan's current rate; it defaults to the real today.
 */
export function groupDebts(input: DebtInputs, today: string = new Date().toISOString().slice(0, 10)): DebtSheet {
  const { accounts, balances, loans, cards, people, baseCurrency, ratesToBase } = input;
  const termsOf = new Map(loans.map((terms) => [terms.accountId, terms]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const owed = (id: string) => owedMinor(balances, id);
  const live = accounts.filter((a) => a.kind === 'liability' && a.archivedAt === null);

  const rows: DebtRow[] = [];
  const cleared: ClearedLoan[] = [];
  for (const account of live) {
    const currency = account.currency ?? baseCurrency;
    if (account.subtype === 'loan') {
      const terms = termsOf.get(account.id);
      if (terms?.status === 'paid_off') {
        cleared.push({ accountId: account.id, name: account.name, clearedOn: terms.statusOn });
        continue;
      }
      const minor = owed(account.id);
      // An open loan is listed whatever it shows; one with no terms is listed only while something is owed on it.
      if (!terms && minor === 0) continue;
      const asset = terms?.assetAccountId ? byId.get(terms.assetAccountId) : undefined;
      const icon: DebtIcon = terms?.isHomeLoan ? 'home' : asset?.subtype === 'vehicle' ? 'car' : 'loan';
      rows.push({ key: account.id, kind: 'loan', accountId: account.id, personName: null, name: account.name, detail: loanDetail(terms, today), icon, last4: null, minor, currency, ...converted(minor, currency, baseCurrency, ratesToBase) });
    } else if (account.subtype === 'credit_card') {
      const minor = owed(account.id);
      const facts = cards[account.id];
      const credit = creditMinor(balances, account.id);
      const detail = credit > 0 ? creditLine(credit, currency) : cardDetail(facts, minor, currency);
      rows.push({ key: account.id, kind: 'card', accountId: account.id, personName: null, name: account.name, detail, icon: 'card', last4: facts?.last4 ?? null, minor, currency, ...converted(minor, currency, baseCurrency, ratesToBase) });
    }
  }

  // People as Lend & borrow lists them; a payable no person holds is still owed, so it is listed by its own name.
  const held = new Set(people.flatMap((p) => p.loans.map((l) => l.accountId)));
  for (const p of people) {
    const since = p.loans.map((l) => l.openedOn).sort()[0];
    rows.push({ key: `person:${p.personName}:${p.currency}`, kind: 'person', accountId: null, personName: p.personName, name: p.personName, detail: since ? `since ${dayMonth(since)}` : '', icon: 'person', last4: null, minor: p.totalMinor, currency: p.currency, ...converted(p.totalMinor, p.currency, baseCurrency, ratesToBase) });
  }
  for (const account of live) {
    if (account.subtype !== 'payable' || held.has(account.id)) continue;
    const minor = owed(account.id);
    if (minor === 0) continue;
    const currency = account.currency ?? baseCurrency;
    rows.push({ key: account.id, kind: 'person', accountId: account.id, personName: null, name: account.name, detail: '', icon: 'person', last4: null, minor, currency, ...converted(minor, currency, baseCurrency, ratesToBase) });
  }

  const groups = ORDER.map((kind): DebtGroup => {
    const own = rows.filter((row) => row.kind === kind);
    const total = sumToBase({ amounts: own.map((row) => ({ minor: row.minor, currency: row.currency })), baseCurrency, ratesToBase });
    return { kind, label: DEBT_GROUP_LABELS[kind], totalMinor: total.totalMinor, missing: total.missing, rows: own };
  }).filter((group) => group.rows.length > 0);

  return { groups, total: totalOf(groups), cleared, due: dueSplit(input.sheet, missingOf(rows)) };
}

/** The rates the debts themselves are waiting on, in the very reading the totals above used, each named once. */
function missingOf(rows: readonly DebtRow[]): string[] {
  return [...new Set(rows.map((row) => row.missing).filter((code): code is string => code !== null))].sort();
}

/**
 * The balance sheet's own split of what is owed: its rows, its function.
 *
 * The sheet hands back one `missing` list for *both* sides of the sheet, so a missing rate on an **asset** — a
 * dollar holding with no dollar rate, say — used to hide the split of everything owed, which has nothing to do with
 * it. What withholds the split is a rate one of the **debts** is waiting on: those are the figures the split is made
 * of, read at the same rates the group totals above were read at, so the two can never disagree — a figure on one
 * side and a refusal on the other, or two figures that do not add up. The assets' own missing rates stay the balance
 * sheet's business, on `/net-worth`, where they belong.
 */
function dueSplit(sheet: DebtInputs['sheet'], missingRates: readonly string[]): DueSplit {
  if (!sheet) return { withinYearMinor: null, longTermMinor: null, missing: [] };
  if (missingRates.length > 0) return { withinYearMinor: null, longTermMinor: null, missing: [...missingRates] };
  const { shortTerm, longTerm } = balanceSheet([], [...sheet.liabilities]);
  return { withinYearMinor: shortTerm.totalMinor, longTermMinor: longTerm.totalMinor, missing: [] };
}
