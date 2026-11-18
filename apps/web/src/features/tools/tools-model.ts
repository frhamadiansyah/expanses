import { ArrowUpFromLine, CreditCard, FileSpreadsheet, HandCoins, ListChecks, Receipt, Store, type LucideIcon } from 'lucide-react';
import { CATALOGUE } from '../calculators/catalogue';

/*
 * The Mac's Tools page (Mac Settings and Tools mockup B, 2026-11-18): one page of tiles, grouped — the calculators,
 * each straight to its own page, then Cards, Money, and Tax & data side by side. Every tile is a place the app already
 * has; the page only gathers them. The phone keeps its Account page, which lists the same places.
 */

export type ToolGroupKey = 'calculators' | 'cards' | 'money' | 'data';

export interface ToolTile {
  key: string;
  label: string;
  /** One grey line: what the tool is for (the calculators' own blurbs, else the mockup's). */
  line: string;
  icon: LucideIcon;
  /** The square's colour, a Mac system colour. */
  tint: string;
  /** Where the tile goes; null for Statement check, which asks which account first. */
  to: string | null;
}

export interface ToolGroup {
  key: ToolGroupKey;
  title: string;
  tiles: readonly ToolTile[];
}

/** The calculators' colours, in the catalogue's order: Emergency, Education, Retirement, Life cover, Loan. */
const CALCULATOR_TINTS: Readonly<Record<string, string>> = {
  '/calculators/emergency': '#ff9500',
  '/calculators/education': '#007aff',
  '/calculators/retirement': '#a2845e',
  '/calculators/life-cover': '#34c759',
  '/calculators/loan': '#5856d6',
};

/** Statement check's own address, opened with `?account=` once an account is chosen. */
export const STATEMENT_CHECK = '/statement/list';

/** Where the sidebar's Tools › goes. */
export const TOOLS_TO = '/tools';

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    key: 'calculators',
    title: 'Calculators',
    tiles: CATALOGUE.map((entry) => ({ key: entry.to, label: entry.label, line: entry.blurb, icon: entry.icon, tint: CALCULATOR_TINTS[entry.to] ?? '#8e8e93', to: entry.to })),
  },
  {
    key: 'cards',
    title: 'Cards',
    tiles: [
      { key: 'recommend', label: 'Which card?', line: 'The card that earns most for a purchase.', icon: CreditCard, tint: '#007aff', to: '/recommend' },
      { key: 'merchants', label: 'Merchants', line: 'Where each card was used, and what it earned.', icon: Store, tint: '#ff2d55', to: '/cards/merchants' },
    ],
  },
  {
    key: 'money',
    title: 'Money',
    tiles: [
      { key: 'lend-borrow', label: 'Lend & borrow', line: 'Money lent to or borrowed from people.', icon: HandCoins, tint: '#30b0c7', to: '/net-worth/lend-borrow' },
      { key: 'receipt-split', label: 'Split a receipt', line: 'One receipt, several categories or people.', icon: Receipt, tint: '#ff9500', to: '/transactions/receipt-split/start' },
    ],
  },
  {
    key: 'data',
    title: 'Tax & data',
    tiles: [
      { key: 'tax-report', label: 'Tax report', line: 'Assets and debts for the yearly SPT.', icon: FileSpreadsheet, tint: '#8e8e93', to: '/tax-report' },
      { key: 'import', label: 'Import', line: 'Bring in a bank statement or a spreadsheet.', icon: ArrowUpFromLine, tint: '#8e8e93', to: '/import' },
      // Beyond the mockup: the sidebar's old Tools menu held it, so it stays a tool. It asks which account first.
      { key: 'statement-check', label: 'Statement check', line: 'A statement, line by line, against what is recorded.', icon: ListChecks, tint: '#34c759', to: null },
    ],
  },
];

const fold = (text: string) => text.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * "Find a tool": the groups with only the tiles whose name or line holds every word typed (any order), and no group
 * left empty. Nothing typed is every tile.
 */
export function findTools(query: string, groups: readonly ToolGroup[] = TOOL_GROUPS): ToolGroup[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...groups];
  return groups
    .map((group) => ({ ...group, tiles: group.tiles.filter((tile) => words.every((word) => fold(`${tile.label} ${tile.line} ${group.title}`).includes(word))) }))
    .filter((group) => group.tiles.length > 0);
}
