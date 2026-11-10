import {
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Calculator,
  CalendarRange,
  CheckCheck,
  CreditCard,
  History,
  LayoutGrid,
  FileSpreadsheet,
  HandCoins,
  PiggyBank,
  Receipt,
  Smartphone,
  Sparkles,
  TrendingUp,
  Store,
  Tags,
  UserRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** A short second line under the label, for a place whose name alone does not say what it holds. */
  note?: string;
}

export interface NavGroup {
  title: string;
  items: readonly NavItem[];
}

/**
 * The phone's tab bar. Four places and, between them, the button that records a purchase — an action
 * rather than a place, because a purchase is recorded where it happens.
 *
 * The fourth place is the Account page, which holds everything else; it is `ACCOUNT_TAB`, drawn last on the bar.
 */
export const TABS: readonly NavItem[] = [
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/net-worth', label: 'Net worth', icon: TrendingUp },
  // Everything money is spent from or owed on: the Accounts page and the Cards tab, as one place.
  { to: '/wallet', label: 'Wallet', icon: CreditCard },
] as const;

/** The bar's last place: the Account page, a main page of its own. */
export const ACCOUNT_TAB: NavItem = { to: '/account', label: 'Account', icon: UserRound };

/**
 * The Settings group of the Account page. Backup leads the safe-keeping: on a phone it is the only safety net.
 * Capture is drawn on the phone app only (it reads that phone's notifications and screenshots).
 */
export const SETTINGS_ITEMS: readonly NavItem[] = [
  { to: '/settings/capture', label: 'Capture', icon: Smartphone },
  { to: '/settings/widget', label: 'Widget', icon: LayoutGrid },
  { to: '/backup', label: 'Backup', icon: ArrowDownToLine },
  { to: '/settings/activity', label: 'Activity', icon: History },
  { to: '/settings/default', label: 'Default', icon: WalletCards },
  { to: '/import', label: 'Import', icon: ArrowUpFromLine },
] as const;

/** The rest of the Account page, grouped the way it is looked for. */
export const MORE_GROUPS: readonly NavGroup[] = [
  {
    title: 'Money',
    items: [
      { to: '/budget', label: 'Budget', icon: PiggyBank },
      { to: '/bills', label: 'Recurring', icon: Bell },
      { to: '/events', label: 'Events', icon: CalendarRange },
      { to: '/goals', label: 'Goals', icon: Sparkles },
      // No "Add a debt" here. This page is a list of places, and a debt is added from the screens that list debts:
      // the Debts page's own +, and Lend & borrow's Add a loan. A door among the places made one line of this menu
      // open a form where every other line opens a screen.
      // Money lent and borrowed lives here rather than in Cashflow's ⋯ menu, which is left to the workspace.
      { to: '/net-worth/lend-borrow', label: 'Lend & borrow', icon: HandCoins },
      { to: '/transactions/receipt-split/start', label: 'Split a receipt', icon: Receipt },
      { to: '/categories', label: 'Categories', icon: Tags },
    ],
  },
  {
    title: 'Cards',
    items: [
      { to: '/recommend', label: 'Which card?', icon: CreditCard },
      { to: '/cards/merchants', label: 'Merchants', icon: Store },
    ],
  },
  {
    title: 'Work it out',
    items: [
      { to: '/review', label: 'Review', icon: CheckCheck },
      { to: '/calculators', label: 'Calculators', icon: Calculator },
      { to: '/tax-report', label: 'Tax report', icon: FileSpreadsheet },
    ],
  },
] as const;

/** Every route a person can reach from the shell, so a test can prove none has been stranded. */
export const REACHABLE: readonly string[] = [...TABS.map((t) => t.to), ACCOUNT_TAB.to, ...SETTINGS_ITEMS.map((i) => i.to), ...MORE_GROUPS.flatMap((g) => g.items.map((i) => i.to))];
