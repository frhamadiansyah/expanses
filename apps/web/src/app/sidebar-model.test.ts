import type { MonthlyBill } from '@expanses/db';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { TOOL_GROUPS } from '../features/tools/tools-model';
import {
  activeTo,
  billsDueCount,
  compactMoney,
  edgeToEdge,
  footerStatus,
  kindOf,
  MOVED,
  readAccountsFolded,
  SETTINGS_TO,
  SIDEBAR_GROUPS,
  TOOLS_TO,
  sidebarAccounts,
  writeAccountsFolded,
} from './sidebar-model';

const account = (id: string, name: string, subtype: AccountRow['subtype'], currency = 'IDR') => ({ id, name, subtype, currency }) as AccountRow;

describe('the sidebar groups (option A)', () => {
  it('reads Overview, Cashflow, Budget, Bills, Review; then Money and Plans', () => {
    expect(SIDEBAR_GROUPS.map((group) => [group.title, group.items.map((item) => item.label)])).toEqual([
      [null, ['Overview', 'Cashflow', 'Budget', 'Bills', 'Review']],
      ['Money', ['Wallet', 'Net worth', 'Points']],
      ['Plans', ['Goals', 'Events', 'Debt-free plan']],
    ]);
  });

  it('carries the counts where the mockup draws them', () => {
    const badges = Object.fromEntries(SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => [item.label, item.badge ?? null])));
    expect(badges).toMatchObject({ Bills: 'bills', Review: 'review', 'Debt-free plan': 'late', Wallet: null });
  });

  it('strands nothing the old sidebar had: each old place is a row, a tool or Settings', () => {
    const rows = new Map(SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => [item.to, item.label])));
    // A tool is a tile on the Tools page; Calculators is its first row (each calculator a tile of its own).
    const tools = new Set(['/calculators', ...TOOL_GROUPS.flatMap((group) => group.tiles.map((tile) => tile.to))]);
    for (const [to, where] of Object.entries(MOVED)) {
      if (where === 'Tools') expect(tools.has(to), to).toBe(true);
      else if (where === 'Settings') expect([SETTINGS_TO, '/categories', '/backup']).toContain(to);
      else expect(rows.get(to), to).toBe(where);
    }
    expect(Object.keys(MOVED)).toHaveLength(15);
  });
});

describe('which row is selected', () => {
  const rows = SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => item.to));

  it('lights the deepest row the address sits under', () => {
    expect(activeTo('/net-worth/plan', rows)).toBe('/net-worth/plan');
    expect(activeTo('/net-worth', rows)).toBe('/net-worth');
    expect(activeTo('/net-worth/investments', rows)).toBe('/net-worth');
    expect(activeTo('/cards/points', rows)).toBe('/cards/points');
    expect(activeTo('/transactions/new', rows)).toBe('/transactions');
    expect(activeTo('/transactions/', rows)).toBe('/transactions');
  });

  it('lights an account row on its own page, else Wallet', () => {
    expect(activeTo('/accounts/a1', [...rows, '/accounts/a1'])).toBe('/accounts/a1');
    expect(activeTo('/accounts/a2/edit', [...rows, '/accounts/a1'])).toBe('/wallet');
    expect(activeTo('/cards/c9/statement', [...rows, '/cards/c9'])).toBe('/cards/c9');
  });

  it('lights Settings for what moved into it, and nothing for a page with no row', () => {
    expect(activeTo('/account', rows)).toBe(SETTINGS_TO);
    expect(activeTo('/account/workspaces/b1', rows)).toBe(SETTINGS_TO);
    expect(activeTo('/categories', rows)).toBe(SETTINGS_TO);
    expect(activeTo('/backup', rows)).toBe(SETTINGS_TO);
    expect(activeTo('/tools', rows)).toBe(TOOLS_TO);
    expect(activeTo('/calculators', rows)).toBe(TOOLS_TO);
    expect(activeTo('/calculators/loan', rows)).toBe(TOOLS_TO);
    expect(activeTo('/statement/list', rows)).toBe(TOOLS_TO);
    expect(activeTo('/cards/merchants', rows)).toBe(TOOLS_TO);
    expect(activeTo('/tax-report', rows)).toBe(TOOLS_TO);
    // A tool under a row of its own stays that row's: Lend & borrow is in Net worth.
    expect(activeTo('/net-worth/lend-borrow', rows)).toBe('/net-worth');
    // A prefix of a word is not a parent: /budgetary is not under /budget.
    expect(activeTo('/budgetary', rows)).toBeNull();
  });
});

describe("Bills' count", () => {
  it('counts the bills late or due within 3 days, out yet or not — the Bills page’s Due soon — not the later, paid or paused ones', () => {
    const today = '2026-11-17';
    const due = (state: MonthlyBill['state'], payBy: string) => ({ state, window: { month: '2026-11', opensOn: payBy, payBy } });
    const rows = [
      due('overdue', '2026-11-10'),
      due('dueSoon', '2026-11-19'),
      // Due the day it comes out, in 3 days: not out yet, but due soon all the same.
      due('upcoming', '2026-11-20'),
      due('upcoming', '2026-11-21'),
      due('open', '2026-11-28'),
      due('paid', '2026-11-18'),
      due('skipped', '2026-11-18'),
      due('paused', '2026-11-18'),
    ];
    expect(billsDueCount(rows, today)).toBe(3);
    expect(billsDueCount([], today)).toBe(0);
  });
});

describe('compact balances', () => {
  it('prints rupiah in jt and M, the way Net worth’s axis does', () => {
    expect(compactMoney(142_500_000, 'IDR')).toBe('142,5 jt');
    expect(compactMoney(-8_400_000, 'IDR')).toBe('−8,4 jt');
    expect(compactMoney(1_250_000_000, 'IDR')).toBe('1,3 M');
    expect(compactMoney(61_000_000, 'IDR')).toBe('61 jt');
  });

  it('prints under a million rupiah, and every other currency, in whole units', () => {
    // Rupiah's lettered symbol takes a no-break space before its digits, as the rest of the app prints it; "US$" none.
    expect(compactMoney(950_000, 'IDR')).toBe('Rp\u00a0950.000');
    expect(compactMoney(184_000, 'USD')).toBe('US$1.840');
    expect(compactMoney(-184_050, 'USD')).toBe('−US$1.841');
  });
});

describe('the accounts list', () => {
  const bca = account('bca', 'BCA Tahapan', 'savings');
  const cash = account('cash', 'Wallet cash', 'cash');
  const gopay = account('gopay', 'GoPay', 'ewallet');
  const visa = account('visa', 'BCA Visa', 'credit_card');

  it("keeps Wallet's order, money with its figure and a card with what is due now, as owed", () => {
    const rows = sidebarAccounts({
      order: ['gopay', 'visa', 'bca', 'cash', 'joint:x'],
      money: [bca, cash, gopay],
      credit: [visa],
      moneyFigure: (a) => ({ minor: { bca: 142_500_000, cash: 300_000, gopay: 1_900_000 }[a.id] ?? 0, currency: 'IDR' }),
      dueNow: () => 8_400_000,
      baseCurrency: 'IDR',
    });
    expect(rows.map((row) => [row.name, row.kind, row.minor, row.to])).toEqual([
      ['GoPay', 'wallet', 1_900_000, '/accounts/$accountId'],
      ['BCA Visa', 'card', -8_400_000, '/cards/$cardId'],
      ['BCA Tahapan', 'bank', 142_500_000, '/accounts/$accountId'],
      ['Wallet cash', 'cash', 300_000, '/accounts/$accountId'],
    ]);
  });

  it('reads each kind from the subtype', () => {
    expect(['bank', 'savings', 'time_deposit', 'cash', 'other_cash', 'ewallet', 'emoney', 'credit_card'].map((subtype) => kindOf({ subtype } as AccountRow))).toEqual([
      'bank',
      'bank',
      'bank',
      'cash',
      'cash',
      'wallet',
      'wallet',
      'card',
    ]);
  });
});

describe('the Accounts fold', () => {
  const memory = () => {
    const store = new Map<string, string>();
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  };

  it('stays open until folded, and remembers the fold either way', () => {
    const storage = memory();
    expect(readAccountsFolded(storage)).toBe(false);
    writeAccountsFolded(true, storage);
    expect(readAccountsFolded(storage)).toBe(true);
    writeAccountsFolded(false, storage);
    expect(readAccountsFolded(storage)).toBe(false);
  });

  it('starts as asked while nothing is stored, and a stored choice wins over that', () => {
    const storage = memory();
    expect(readAccountsFolded(storage, true)).toBe(true);
    writeAccountsFolded(false, storage);
    expect(readAccountsFolded(storage, true)).toBe(false);
  });

  it('reads the start state when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readAccountsFolded(blocked)).toBe(false);
    expect(readAccountsFolded(blocked, true)).toBe(true);
  });
});

describe('the status line at the foot', () => {
  const now = new Date(2026, 10, 17, 14, 0);
  const at = (h: number, m: number, day = 17) => new Date(2026, 10, day, h, m).getTime();

  it('says a personal workspace is on this device, with the last backup time', () => {
    expect(footerStatus({ shared: false, running: false, failing: false, lastSyncedAt: null, lastBackupAt: new Date(at(9, 12)).toISOString(), now })).toEqual({
      text: 'On this device · backed up 09:12',
      tone: 'ok',
    });
  });

  it('says when a shared workspace last synced, and the date for another day', () => {
    expect(footerStatus({ shared: true, running: false, failing: false, lastSyncedAt: at(13, 5), lastBackupAt: new Date(at(8, 0, 15)).toISOString(), now })).toEqual({
      text: 'Synced 13:05 · backed up 15 Nov',
      tone: 'ok',
    });
    expect(footerStatus({ shared: true, running: true, failing: false, lastSyncedAt: at(13, 5), lastBackupAt: null, now }).text).toBe('Syncing… · not backed up');
    expect(footerStatus({ shared: true, running: false, failing: false, lastSyncedAt: null, lastBackupAt: null, now }).text).toBe('Shared · not backed up');
  });

  it('turns amber without a backup or with one over a week old, red while a sync fails', () => {
    expect(footerStatus({ shared: false, running: false, failing: false, lastSyncedAt: null, lastBackupAt: null, now }).tone).toBe('warn');
    expect(footerStatus({ shared: false, running: false, failing: false, lastSyncedAt: null, lastBackupAt: new Date(at(9, 0, 9)).toISOString(), now }).tone).toBe('warn');
    expect(footerStatus({ shared: true, running: false, failing: true, lastSyncedAt: at(9, 0), lastBackupAt: new Date(at(9, 0)).toISOString(), now })).toEqual({
      text: 'Sync failed · backed up 09:00',
      tone: 'alarm',
    });
  });
});

describe('which pages run edge to edge', () => {
  it('Overview always; Cashflow, Budget, Bills, Review, Wallet, Net worth, Points, Goals, Events and an event on a wide screen only, never in the phone shell or for one account', () => {
    expect(edgeToEdge('/overview', false)).toBe(true);
    expect(edgeToEdge('/overview', true)).toBe(true);
    expect(edgeToEdge('/transactions', false)).toBe(true);
    expect(edgeToEdge('/transactions', true)).toBe(false);
    // An account's own history keeps its list in the column.
    expect(edgeToEdge('/transactions', false, true)).toBe(false);
    expect(edgeToEdge('/transactions/new', false)).toBe(false);
    expect(edgeToEdge('/budget', false)).toBe(true);
    expect(edgeToEdge('/budget', true)).toBe(false);
    expect(edgeToEdge('/budget/edit', false)).toBe(false);
    // The Debt-free plan's views (Mac Debt-free plan); All debts keeps its column.
    for (const path of ['/net-worth/plan', '/net-worth/plan/schedule', '/net-worth/plan/report', '/net-worth/plan/pay-first']) {
      expect(edgeToEdge(path, false)).toBe(true);
      expect(edgeToEdge(path, true)).toBe(false);
    }
    expect(edgeToEdge('/net-worth/plan/debts', false)).toBe(false);
    expect(edgeToEdge('/bills', false)).toBe(true);
    expect(edgeToEdge('/bills', true)).toBe(false);
    expect(edgeToEdge('/bills/yearly', false)).toBe(false);
    expect(edgeToEdge('/review', false)).toBe(true);
    expect(edgeToEdge('/review', true)).toBe(false);
    expect(edgeToEdge('/wallet', false)).toBe(true);
    expect(edgeToEdge('/wallet', true)).toBe(false);
    expect(edgeToEdge('/wallet/reorder', false)).toBe(false);
    expect(edgeToEdge('/net-worth', false)).toBe(true);
    expect(edgeToEdge('/net-worth', true)).toBe(false);
    // Its sub pages (Assets, Liabilities, an asset, Prices) keep the column.
    expect(edgeToEdge('/net-worth/assets', false)).toBe(false);
    expect(edgeToEdge('/net-worth/prices', false)).toBe(false);
    // An account's and a card's own page are Mac pages; the static pages beside them and the pages under them keep the column.
    expect(edgeToEdge('/accounts/a1', false)).toBe(true);
    expect(edgeToEdge('/accounts/a1', true)).toBe(false);
    expect(edgeToEdge('/cards/c1', false)).toBe(true);
    expect(edgeToEdge('/cards/c1', true)).toBe(false);
    for (const path of ['/accounts/new', '/accounts/add', '/accounts/a1/move', '/accounts/a1/pocket', '/cards/merchants', '/cards/c1/statement', '/cards/c1/settings']) {
      expect(edgeToEdge(path, false)).toBe(false);
    }
    expect(edgeToEdge('/cards/points', false)).toBe(true);
    // Events and an event's own page; its settings, plan and costs keep the column.
    expect(edgeToEdge('/events', false)).toBe(true);
    expect(edgeToEdge('/events', true)).toBe(false);
    expect(edgeToEdge('/events/e1', false)).toBe(true);
    expect(edgeToEdge('/events/e1', true)).toBe(false);
    expect(edgeToEdge('/events/e1/settings', false)).toBe(false);
    expect(edgeToEdge('/events/e1/plan', false)).toBe(false);
    expect(edgeToEdge('/events/e1/plan/i1', false)).toBe(false);
    expect(edgeToEdge('/cards/points', true)).toBe(false);
    // A programme's own page (history, expiry) keeps the column.
    expect(edgeToEdge('/cards/points/p1', false)).toBe(false);
    expect(edgeToEdge('/goals', false)).toBe(true);
    expect(edgeToEdge('/goals', true)).toBe(false);
    // A goal's own page, its history and its form keep the column.
    expect(edgeToEdge('/goals/g1', false)).toBe(false);
    expect(edgeToEdge('/goals/new', false)).toBe(false);
    expect(edgeToEdge('/tools', false)).toBe(true);
    expect(edgeToEdge('/tools', true)).toBe(false);
    expect(edgeToEdge('/account', false)).toBe(true);
    expect(edgeToEdge('/account', true)).toBe(false);
    expect(edgeToEdge('/backup', false)).toBe(true);
    expect(edgeToEdge('/account/workspaces/b1', false)).toBe(false);
    expect(edgeToEdge('/backup/icloud', false)).toBe(false);
  });
});
