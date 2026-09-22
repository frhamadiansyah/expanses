import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Calculator,
  CalendarRange,
  CheckCheck,
  CreditCard,
  FileSpreadsheet,
  HandCoins,
  House,
  Landmark,
  PiggyBank,
  Scale,
  Settings,
  Sparkles,
  Store,
  Tags,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: readonly NavItem[];
}

/**
 * The phone's tab bar. Four places and, between them, the button that records a purchase — an action
 * rather than a place, because a purchase is recorded where it happens.
 *
 * The fourth place is the account sheet, which holds everything else, so its route is not listed here.
 */
export const TABS: readonly NavItem[] = [
  { to: '/transactions', label: 'Transactions', icon: Wallet },
  { to: '/net-worth', label: 'Net worth', icon: Scale },
  { to: '/cards', label: 'Cards', icon: CreditCard },
] as const;

/**
 * The account sheet: everything the bar cannot hold, grouped the way it is looked for. Backup leads —
 * on a phone it is the only safety net, so it is the first thing in the first group.
 */
export const MORE_GROUPS: readonly NavGroup[] = [
  {
    title: 'Keep it safe',
    items: [
      { to: '/backup', label: 'Backup', icon: ArrowDownToLine },
      { to: '/import', label: 'Import CSV', icon: ArrowUpFromLine },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/', label: 'Dashboard', icon: House },
      { to: '/budget', label: 'Budget', icon: PiggyBank },
      { to: '/bills', label: 'Recurring', icon: Bell },
      { to: '/events', label: 'Events', icon: CalendarRange },
      { to: '/goals', label: 'Goals', icon: Sparkles },
      { to: '/accounts', label: 'Accounts', icon: Landmark },
      // A debt is not opened from any one screen — a card, a mortgage and money borrowed from family land in three
      // different places — so the picker that sorts that out is reached from here rather than hidden behind one of them.
      { to: '/debts/new', label: 'Add a debt', icon: HandCoins },
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
export const REACHABLE: readonly string[] = [...TABS.map((t) => t.to), ...MORE_GROUPS.flatMap((g) => g.items.map((i) => i.to))];
