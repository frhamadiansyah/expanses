import { currencyInfo, currencyText, formatMinor } from '@expanses/core';
import type { AccountRow, MonthlyBill } from '@expanses/db';
import {
  ArrowLeftRight,
  Award,
  Banknote,
  CalendarDays,
  CalendarRange,
  CreditCard,
  Flag,
  House,
  Inbox,
  Landmark,
  PieChart,
  Smartphone,
  Target,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { isDueSoon } from '../features/bills/bill-view';
import { TOOLS_TO } from '../features/tools/tools-model';

/*
 * The wide screen's sidebar (Mac app and a wide browser), option A of the Mac sidebar mockup (2026-11-17): three short
 * groups by job, the workspace's own accounts with their balances, then Tools and Settings at the foot. The phone keeps
 * its tab bar and Account page; nothing here is drawn on a phone.
 */

/** What a row carries on its right: Review's red count, the plan's red "N late", Bills' grey count. */
export type SidebarBadge = 'review' | 'late' | 'bills';

export interface SidebarItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: SidebarBadge;
}

export interface SidebarGroup {
  /** Null for the first group, which has no header. */
  title: string | null;
  items: readonly SidebarItem[];
}

export const SIDEBAR_GROUPS: readonly SidebarGroup[] = [
  {
    title: null,
    items: [
      { to: '/overview', label: 'Overview', icon: House },
      { to: '/transactions', label: 'Cashflow', icon: ArrowLeftRight },
      { to: '/budget', label: 'Budget', icon: PieChart },
      { to: '/bills', label: 'Bills', icon: CalendarDays, badge: 'bills' },
      { to: '/review', label: 'Review', icon: Inbox, badge: 'review' },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/wallet', label: 'Wallet', icon: WalletCards },
      { to: '/net-worth', label: 'Net worth', icon: TrendingUp },
      { to: '/cards/points', label: 'Points', icon: Award },
    ],
  },
  {
    title: 'Plans',
    items: [
      { to: '/goals', label: 'Goals', icon: Flag },
      { to: '/events', label: 'Events', icon: CalendarRange },
      { to: '/net-worth/plan', label: 'Debt-free plan', icon: Target, badge: 'late' },
    ],
  },
];

/** Each page's own colour (tokens.css `--nav-*`), filled behind its row while it is open (Mac v1). */
export const NAV_COLOUR: Readonly<Record<string, string>> = {
  '/overview': 'var(--nav-overview)',
  '/transactions': 'var(--nav-cashflow)',
  '/budget': 'var(--nav-budget)',
  '/bills': 'var(--nav-bills)',
  '/review': 'var(--nav-review)',
  '/wallet': 'var(--nav-wallet)',
  '/net-worth': 'var(--nav-networth)',
  '/cards/points': 'var(--nav-points)',
  '/goals': 'var(--nav-goals)',
  '/events': 'var(--nav-events)',
  '/net-worth/plan': 'var(--nav-plan)',
};

/** Tools ›: the Tools page (Mac Settings and Tools, B), a tile for each tool — Statement check among them. */
export { TOOLS_TO } from '../features/tools/tools-model';

/** Settings: the Account page, which holds workspaces and sharing, Categories, Backup, Activity, Capture and the rest. */
export const SETTINGS_TO = '/account';

/**
 * Where each item of the sidebar before option A lives now, so nothing is stranded (a test reads this). Categories,
 * Backup and Account moved into Settings; Transactions is Cashflow; the old second list went to Tools.
 */
export const MOVED: Readonly<Record<string, string>> = {
  '/transactions': 'Cashflow',
  '/wallet': 'Wallet',
  '/budget': 'Budget',
  '/events': 'Events',
  '/goals': 'Goals',
  '/categories': 'Settings',
  '/net-worth': 'Net worth',
  '/net-worth/plan': 'Debt-free plan',
  '/review': 'Review',
  '/calculators': 'Tools',
  '/tax-report': 'Tools',
  '/recommend': 'Tools',
  '/import': 'Tools',
  '/backup': 'Settings',
  '/account': 'Settings',
};

/**
 * Pages without a row of their own, read as the row they belong to (a card page under Wallet, Backup under Settings, a
 * calculator under Tools). The first that fits wins, so a tool under /cards is listed before /cards itself.
 */
const BELONGS: readonly [prefix: string, to: string][] = [
  ['/calculators', TOOLS_TO],
  ['/recommend', TOOLS_TO],
  ['/tax-report', TOOLS_TO],
  ['/import', TOOLS_TO],
  ['/statement', TOOLS_TO],
  ['/cards/merchants', TOOLS_TO],
  ['/accounts', '/wallet'],
  ['/cards', '/wallet'],
  ['/categories', SETTINGS_TO],
  ['/backup', SETTINGS_TO],
  ['/settings', SETTINGS_TO],
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * The one row drawn as selected: the longest destination the address sits under, so the plan lights the plan rather
 * than Net worth, and an account's page lights that account's row rather than Wallet. Null when nothing fits.
 */
export function activeTo(pathname: string, destinations: readonly string[]): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const best = [...destinations, SETTINGS_TO, TOOLS_TO].filter((to) => under(path, to)).sort((a, b) => b.length - a.length)[0];
  if (best) return best;
  return BELONGS.find(([prefix]) => under(path, prefix))?.[1] ?? null;
}

/** Bills' grey count: this month's bills late or due within the few days (`isDueSoon`), the Bills page's Due soon. */
export function billsDueCount(rows: readonly Pick<MonthlyBill, 'state' | 'window'>[], today: string): number {
  return rows.filter((bill) => isDueSoon(bill, today)).length;
}

/**
 * A balance short enough for a sidebar row: rupiah in millions ("142,5 jt") and billions ("1,2 M"), as Net worth's
 * axis prints them; any other currency in whole units ("US$1.840"). Below a million rupiah, whole rupiah ("Rp 193.000", the
 * no-break space `currencyText` gives a lettered symbol in every engine).
 */
export function compactMoney(minor: number, currency: string): string {
  const major = minor / 10 ** currencyInfo(currency).exponent;
  const abs = Math.abs(major);
  const sign = major < 0 ? '−' : '';
  if (currency === 'IDR' && abs >= 1e9) return `${sign}${(abs / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (currency === 'IDR' && abs >= 1e6) return `${sign}${(abs / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  const whole = currencyText(new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }), abs);
  return `${sign}${whole}`;
}

export type AccountRowKind = 'bank' | 'card' | 'cash' | 'wallet';

export interface SidebarAccount {
  id: string;
  name: string;
  kind: AccountRowKind;
  /**
   * The figure, in `currency`: a money account's balance (or its pockets' total), a card's due now, as owed (negative).
   * Null when a pocket's rate is missing, so the row says nothing rather than a wrong total.
   */
  minor: number | null;
  currency: string;
  to: '/accounts/$accountId' | '/cards/$cardId';
}

export const ACCOUNT_ICONS: Record<AccountRowKind, LucideIcon> = { bank: Landmark, card: CreditCard, cash: Banknote, wallet: Smartphone };

export function kindOf(account: Pick<AccountRow, 'subtype'>): AccountRowKind {
  if (account.subtype === 'credit_card') return 'card';
  if (account.subtype === 'cash' || account.subtype === 'other_cash') return 'cash';
  if (account.subtype === 'ewallet' || account.subtype === 'emoney') return 'wallet';
  return 'bank';
}

/**
 * The workspace's own money accounts and credit cards, in Wallet's order (`order`, the keys Wallet draws its cards in),
 * each with the figure Wallet's card shows: `moneyMinor` for money (pockets already summed by the caller), what is due
 * now for a card. A partner's joint cards are Wallet's, not this workspace's accounts, and are not listed.
 */
export function sidebarAccounts(input: {
  order: readonly string[];
  money: readonly AccountRow[];
  credit: readonly AccountRow[];
  moneyFigure: (account: AccountRow) => { minor: number | null; currency: string };
  dueNow: (card: AccountRow) => number;
  baseCurrency: string;
}): SidebarAccount[] {
  const byId = new Map<string, SidebarAccount>();
  for (const account of input.money) {
    const figure = input.moneyFigure(account);
    byId.set(account.id, { id: account.id, name: account.name, kind: kindOf(account), minor: figure.minor, currency: figure.currency, to: '/accounts/$accountId' });
  }
  for (const card of input.credit) {
    byId.set(card.id, { id: card.id, name: card.name, kind: 'card', minor: -input.dueNow(card), currency: card.currency ?? input.baseCurrency, to: '/cards/$cardId' });
  }
  return input.order.flatMap((key) => byId.get(key) ?? []);
}

const FOLD_KEY = 'cicis.sidebar.accounts-folded';

/**
 * Whether Accounts is folded, as this browser last left it; `unset` until it has been folded or opened once (open for
 * people; the end-to-end build starts it folded, see Sidebar.tsx).
 */
export function readAccountsFolded(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage, unset = false): boolean {
  try {
    const stored = storage?.getItem(FOLD_KEY);
    return stored === '1' ? true : stored === '0' ? false : unset;
  } catch {
    return unset;
  }
}

export function writeAccountsFolded(folded: boolean, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(FOLD_KEY, folded ? '1' : '0');
  } catch {
    // Without storage the fold lasts until the page reloads.
  }
}

export type FooterTone = 'ok' | 'warn' | 'alarm';

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayMonthOf = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * The line at the sidebar's foot, from what the app already knows: the open workspace's sync (shared only) and the
 * last backup file. "Synced 09:12 · backed up 08:40", "On this device · not backed up", "Sync failed · backed up 2 Nov".
 * Green while both are fine, amber with no backup or none for a week, red while a sync is failing.
 */
export function footerStatus(input: {
  shared: boolean;
  running: boolean;
  failing: boolean;
  lastSyncedAt: number | null;
  lastBackupAt: string | null;
  now: Date;
}): { text: string; tone: FooterTone } {
  const { now } = input;
  const when = (ms: number) => (sameDay(new Date(ms), now) ? clock(ms) : dayMonthOf(ms));
  const sync = !input.shared
    ? 'On this device'
    : input.running
      ? 'Syncing…'
      : input.failing
        ? 'Sync failed'
        : input.lastSyncedAt !== null
          ? `Synced ${when(input.lastSyncedAt)}`
          : 'Shared';
  const backupMs = input.lastBackupAt ? Date.parse(input.lastBackupAt) : NaN;
  const backedUp = Number.isFinite(backupMs);
  const backup = backedUp ? `backed up ${when(backupMs)}` : 'not backed up';
  const stale = !backedUp || now.getTime() - backupMs > 7 * 24 * 60 * 60 * 1000;
  const tone: FooterTone = input.shared && input.failing && !input.running ? 'alarm' : stale ? 'warn' : 'ok';
  return { text: `${sync} · ${backup}`, tone };
}

/**
 * The pages that draw their own title bar and grey page edge to edge rather than sitting in the column: Overview (Mac
 * Overview A) always, and Cashflow (Mac Cashflow D), Budget, Bills, Review, Wallet, Net worth, Points, Goals, Events, an event, the Debt-free plan, Tools and Settings (with /backup) on a wide screen — not an account's own
 * history (`?account=`), which keeps its list, and not on a phone, held either way, where each is the phone's own page
 * in the column.
 */
const EDGE_TO_EDGE_WIDE = [
  '/transactions',
  '/budget',
  '/bills',
  '/review',
  '/wallet',
  '/net-worth',
  '/cards/points',
  '/goals',
  '/events',
  // The Debt-free plan and its views (Mac Debt-free plan): Plan, Schedule, Report, and Pay first, which is the Plan view.
  '/net-worth/plan',
  '/net-worth/plan/schedule',
  '/net-worth/plan/report',
  '/net-worth/plan/pay-first',
  // Tools and Settings (Mac Settings and Tools): a page of tiles, and System Settings' two columns (Backup among them).
  '/tools',
  '/account',
  '/backup',
  // Settings › Devices, and one device's pane in it (Link my devices on the Mac).
  '/account/devices',
];
/** Pages of one thing, drawn edge to edge on a wide screen: an event (Mac Events) — not its settings, plan or costs. */
const EDGE_TO_EDGE_PATTERNS = [
  /^\/events\/[^/]+$/,
  // An account's and a card's own page (Mac account pages): not the static pages beside them (New account, Add, Points,
  // Merchants, New card). A kind with no Mac page (a deposit, a debit card) brings the column itself (`DeskColumn`).
  /^\/accounts\/(?!new$|add$)[^/]+$/,
  /^\/cards\/(?!points$|merchants$|new$)[^/]+$/,
  /^\/account\/devices\/[^/]+$/,
];
export function edgeToEdge(pathname: string, phoneShell: boolean, accountScoped = false): boolean {
  if (pathname === '/overview') return true;
  if (phoneShell || accountScoped) return false;
  return EDGE_TO_EDGE_WIDE.includes(pathname) || EDGE_TO_EDGE_PATTERNS.some((pattern) => pattern.test(pathname));
}
