import { currencyInfo, isExchangeResultKey, parsePeriod } from '@expanses/core';
import type { TransactionEntryView, TransactionView } from '@expanses/db';

/** A figure short enough to sit beside a bar — `12M`, `900K`, `45` — with no currency, since every bar shares one. */
export function compactMinor(amountMinor: number, currency: string): string {
  const { exponent } = currencyInfo(currency);
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(amountMinor / 10 ** exponent);
}

/** A bar in one of the three columns: what it is, what it is called, and how much ran through it. */
export interface FlowNode {
  key: string;
  name: string;
  amountMinor: number;
}

/** A money account in the middle column, with which side of the ledger it sits on. */
export interface FlowAccount extends FlowNode {
  /** A credit card, which the chart draws in the alarm colour: money spent that is owed rather than gone. */
  card: boolean;
}

/** A band between two bars, as thick as the money it carries. */
export interface FlowLink {
  source: string;
  target: string;
  amountMinor: number;
}

export interface MoneyFlow {
  /** Where the money came from: income categories, biggest first. */
  sources: FlowNode[];
  /** What it landed in and was paid from, biggest first. */
  accounts: FlowAccount[];
  /** Where it went: spending categories, biggest first, then `others` and `saved` when there is anything in them. */
  targets: FlowNode[];
  /** Left to middle and middle to right, in no particular order. */
  links: FlowLink[];
  incomeMinor: number;
  spentMinor: number;
}

/** The tail of the spending folded into one bar. */
export const OTHERS_KEY = 'others';
/** What came in and was not spent. */
export const SAVED_KEY = 'saved';

export interface MoneyFlowOptions {
  /** How many spending categories stand on their own before the rest fold into Others. Infinity folds nothing. */
  topCategories: number;
  /**
   * A category's top-level ancestor, by category id, for the categories that have one: a child's spending is drawn
   * under its parent, as the ring draws it. A category not named here stands as itself.
   */
  roots?: Readonly<Record<string, { id: string; name: string }>>;
}

const isMoney = (entry: TransactionEntryView) => entry.accountKind === 'asset' || entry.accountKind === 'liability';
const isCard = (entry: TransactionEntryView) => entry.accountSubtype === 'credit_card';

/** Rounds a split so the parts add back up to the whole, the last part taking whatever rounding left over. */
function splitAcross(amountMinor: number, weights: readonly number[]): number[] {
  const whole = weights.reduce((sum, weight) => sum + weight, 0);
  if (whole <= 0) return weights.map((_, index) => (index === 0 ? amountMinor : 0));
  const parts = weights.map((weight) => Math.round((amountMinor * weight) / whole));
  const over = parts.reduce((sum, part) => sum + part, 0) - amountMinor;
  parts[parts.length - 1]! -= over;
  return parts;
}

/**
 * Where a period's money came from, what it passed through and where it went, as three columns and the bands
 * between them.
 *
 * Only money that changed hands with the outside world is a flow: income lands in an account, spending leaves one.
 * A transfer between two money accounts — a top-up, a card paid off, cash drawn — moves nothing in or out, so it is
 * left out; a fee charged on one is spending, and is kept. Opening balances and corrections are nobody's money.
 * A refund is spending in reverse, so it comes off its category and goes back to its account.
 *
 * Amounts are in the minor units the rows were read in — the workspace's own currency, as the list's totals are.
 * `saved` is what came in and was not spent, when that is more than nothing; it is drawn out of the accounts that
 * ended the period with more in them than went out, in proportion, so the bands still meet the bars they leave.
 */
export function moneyFlow(rows: readonly TransactionView[], month: string, options: MoneyFlowOptions): MoneyFlow {
  const period = parsePeriod(month);
  const inPeriod = (tx: TransactionView) => period !== null && (period.from === null || tx.occurredOn >= period.from) && (period.to === null || tx.occurredOn <= period.to);
  const rootOf = (entry: TransactionEntryView) => options.roots?.[entry.accountId] ?? { id: entry.accountId, name: entry.accountName };

  const sources = new Map<string, FlowNode>();
  const accounts = new Map<string, FlowAccount>();
  const spending = new Map<string, FlowNode>();
  /** `source|target` → amount, so two purchases from one account in one category are one band. */
  const bands = new Map<string, number>();
  const add = (source: string, target: string, amountMinor: number) => bands.set(`${source}|${target}`, (bands.get(`${source}|${target}`) ?? 0) + amountMinor);
  const bump = <T extends FlowNode>(into: Map<string, T>, node: T) => {
    const had = into.get(node.key);
    if (had) had.amountMinor += node.amountMinor;
    else into.set(node.key, { ...node });
  };

  for (const tx of rows) {
    if (tx.status !== 'posted' || tx.excluded || !inPeriod(tx)) continue;
    const money = tx.entries.filter(isMoney);
    // An exchange's gain or loss rides on the transfer it came from and is neither spending nor income.
    const expenses = tx.entries.filter((entry) => entry.accountKind === 'expense' && !isExchangeResultKey(entry.accountSystemKey));
    const incomes = tx.entries.filter((entry) => entry.accountKind === 'income' && !isExchangeResultKey(entry.accountSystemKey));
    if (expenses.length === 0 && incomes.length === 0) continue;
    const paid = money.filter((entry) => entry.amountBaseMinor < 0);
    const received = money.filter((entry) => entry.amountBaseMinor > 0);

    /*
     * Which accounts the money went through: spending comes out of the ones that were credited, income lands in
     * the ones that were debited, and a refund — spending with its sign turned — comes back into a debited one. A
     * purchase paid from two accounts at once is split between them in the proportion each paid.
     */
    const through = (amountMinor: number, outward: boolean) => {
      const first = outward === amountMinor > 0 ? paid : received;
      const sides = first.length > 0 ? first : money;
      return splitAcross(Math.abs(amountMinor), sides.map((entry) => Math.abs(entry.amountBaseMinor))).map((part, index) => ({ entry: sides[index]!, part: amountMinor < 0 ? -part : part }));
    };
    for (const expense of expenses) {
      const root = rootOf(expense);
      bump(spending, { key: root.id, name: root.name, amountMinor: expense.amountBaseMinor });
      for (const { entry, part } of through(expense.amountBaseMinor, true)) {
        bump(accounts, { key: entry.accountId, name: entry.accountName, amountMinor: 0, card: isCard(entry) });
        add(entry.accountId, root.id, part);
      }
    }
    for (const income of incomes) {
      const root = rootOf(income);
      // Income is a credit, so it comes through negative: the chart reads it as the money it brought in.
      const earned = -income.amountBaseMinor;
      bump(sources, { key: root.id, name: root.name, amountMinor: earned });
      for (const { entry, part } of through(earned, false)) {
        bump(accounts, { key: entry.accountId, name: entry.accountName, amountMinor: 0, card: isCard(entry) });
        add(root.id, entry.accountId, part);
      }
    }
  }

  // A category refunded more than it was charged this period would be a bar of negative height: it is left out.
  const positive = (nodes: Map<string, FlowNode>) => [...nodes.values()].filter((node) => node.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor);
  const earned = positive(sources);
  const spent = positive(spending);
  const incomeMinor = earned.reduce((sum, node) => sum + node.amountMinor, 0);
  const spentMinor = spent.reduce((sum, node) => sum + node.amountMinor, 0);

  // The tail folds into Others; a bar on its own that would be the whole of Others stays as itself.
  const kept = spent.length > options.topCategories + 1 ? spent.slice(0, options.topCategories) : spent;
  const folded = new Set(spent.slice(kept.length).map((node) => node.key));
  const othersMinor = spent.slice(kept.length).reduce((sum, node) => sum + node.amountMinor, 0);
  const targets: FlowNode[] = [...kept];
  if (othersMinor > 0) targets.push({ key: OTHERS_KEY, name: 'Others', amountMinor: othersMinor });

  const links: FlowLink[] = [];
  const inOf = new Map<string, number>();
  const outOf = new Map<string, number>();
  for (const [pair, amountMinor] of bands) {
    if (amountMinor <= 0) continue;
    const [source, target] = pair.split('|') as [string, string];
    if (sources.has(source) && !earned.some((node) => node.key === source)) continue;
    if (spending.has(target) && !spent.some((node) => node.key === target)) continue;
    const to = folded.has(target) ? OTHERS_KEY : target;
    const had = links.find((link) => link.source === source && link.target === to);
    if (had) had.amountMinor += amountMinor;
    else links.push({ source, target: to, amountMinor });
    if (accounts.has(source)) outOf.set(source, (outOf.get(source) ?? 0) + amountMinor);
    if (accounts.has(target)) inOf.set(target, (inOf.get(target) ?? 0) + amountMinor);
  }

  // What was kept, drawn from the accounts that ended up ahead, each in proportion to how far ahead it was.
  const savedMinor = incomeMinor - spentMinor;
  if (savedMinor > 0) {
    const ahead = [...accounts.values()].map((account) => ({ key: account.key, by: (inOf.get(account.key) ?? 0) - (outOf.get(account.key) ?? 0) })).filter((account) => account.by > 0);
    const parts = splitAcross(savedMinor, ahead.map((account) => account.by));
    ahead.forEach((account, index) => {
      if (parts[index]! <= 0) return;
      links.push({ source: account.key, target: SAVED_KEY, amountMinor: parts[index]! });
      outOf.set(account.key, (outOf.get(account.key) ?? 0) + parts[index]!);
    });
    targets.push({ key: SAVED_KEY, name: 'Saved', amountMinor: savedMinor });
  }

  // An account is as tall as the busier of its two sides, and one nothing ran through is not drawn.
  const through = [...accounts.values()]
    .map((account) => ({ ...account, amountMinor: Math.max(inOf.get(account.key) ?? 0, outOf.get(account.key) ?? 0) }))
    .filter((account) => account.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);

  return { sources: earned, accounts: through, targets, links, incomeMinor, spentMinor };
}
