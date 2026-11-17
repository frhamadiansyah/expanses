import { isoDate } from '@expanses/core';
import { type AccountRow, pocketParentIds } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Settings, Wrench } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { getLastBackupAt } from '../features/backup/backupState';
import { useMonthlyBills } from '../features/bills/queries';
import { dueNowMinor, laterByCard } from '../features/cards/limit-usage';
import { lateNote } from '../features/debt-plan/plan-view';
import { useLateDebtCount } from '../features/debt-plan/queries';
import { useInstallments } from '../features/loans/queries';
import { owedMinor } from '../features/networth/debt-rows';
import { usePendingDraftCount } from '../features/review/queries';
import { useSyncStatus } from '../features/sharing/queries';
import { parentTotal, pocketsOf, spendingBook } from '../features/accounts/pockets';
import { useHeldRates } from '../features/accounts/queries';
import { readJointOrder, walletKeys } from '../features/wallet/wallet-joint';
import { walletCredit, walletMoney } from '../features/wallet/wallet-model';
import { useOpenBook } from '../features/workspaces/queries';
import { WorkspaceDot } from '../features/workspaces/WorkspaceBadge';
import { WorkspaceSheet } from '../features/workspaces/WorkspaceSheet';
import { useAccounts, useBalances, useIsBookShared } from '../lib/queries';
import { cx } from '../ui';
import { useApp } from './context';
import { useEscape } from './use-escape';
import {
  ACCOUNT_ICONS,
  activeTo,
  billsDueCount,
  compactMoney,
  footerStatus,
  readAccountsFolded,
  SETTINGS_TO,
  SIDEBAR_GROUPS,
  SIDEBAR_TOOLS,
  type SidebarAccount,
  type SidebarItem,
  sidebarAccounts,
  STATEMENT_CHECK,
  writeAccountsFolded,
} from './sidebar-model';

const ROW = 'flex h-[26px] items-center gap-2 rounded-[6px] px-2 text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-side-hover)]';
const ROW_ON = 'bg-[var(--ph-side-on)] hover:bg-[var(--ph-side-on)]';
const ICON = 'h-[15px] w-[15px] shrink-0 text-[var(--ph-dot)]';
const HEADER = 'px-2 pt-3 pb-1 text-[11px] font-semibold text-[var(--ph-ink-3)]';
const GREY = 'ml-auto text-[12px] text-[var(--ph-ink-3)] tabular-nums';
const PILL = 'ml-auto rounded-full bg-[var(--ph-alarm)] px-[6px] text-[10.5px] leading-4 font-semibold text-white tabular-nums';

/**
 * The money accounts and cards of the open workspace, with Wallet's figure for each, in Wallet's order. The figures
 * (the ledger's balances, the cards' instalments) are read only while the list is open: folded, the sidebar asks the
 * ledger nothing, and a screen that needs no ledger reads none.
 */
function useSidebarAccounts(withFigures: boolean): SidebarAccount[] {
  const { ws } = useApp();
  const accounts = useAccounts();
  const balances = useBalances(undefined, withFigures);
  const plans = useInstallments(undefined, withFigures);
  const everything = accounts.data ?? [];
  const all = balances.data ?? {};
  const book = spendingBook(everything);
  const money = walletMoney(everything);
  const credit = walletCredit(everything);
  const parents = pocketParentIds(everything);
  const rates = useHeldRates(book.filter((a) => a.kind === 'asset' && a.archivedAt === null && a.currency).map((a) => a.currency!));
  const held = rates.data?.rates ?? {};
  const later = laterByCard(plans.data ?? [], isoDate());
  if (!accounts.isSuccess) return [];
  if (!withFigures || !balances.isSuccess) {
    // Folded (or still reading): the names alone, for the Tools menu's Statement check.
    return sidebarAccounts({ order: walletKeys(everything, [], readJointOrder()), money, credit, moneyFigure: (account) => ({ minor: null, currency: account.currency ?? ws.baseCurrency }), dueNow: () => 0, baseCurrency: ws.baseCurrency }).map((row) => ({ ...row, minor: null }));
  }
  return sidebarAccounts({
    order: walletKeys(everything, [], readJointOrder()),
    money,
    credit,
    moneyFigure: (account: AccountRow) =>
      parents.has(account.id)
        ? { minor: parentTotal(pocketsOf(account.id, book), all, ws.baseCurrency, held).totalMinor, currency: ws.baseCurrency }
        : { minor: all[account.id] ?? 0, currency: account.currency ?? ws.baseCurrency },
    dueNow: (card) => dueNowMinor(owedMinor(all, card.id), later[card.id] ?? 0),
    baseCurrency: ws.baseCurrency,
  });
}

function Badge({ kind }: { kind: SidebarItem['badge'] }) {
  const review = usePendingDraftCount().data ?? 0;
  const late = useLateDebtCount();
  const bills = useMonthlyBills(isoDate()).data ?? [];
  if (kind === 'review') return review > 0 ? <span className={PILL}>{review}</span> : null;
  if (kind === 'late') {
    const note = lateNote(late);
    return note ? <span className={PILL}>{note}</span> : null;
  }
  if (kind === 'bills') {
    const due = billsDueCount(bills);
    return due > 0 ? <span className={GREY}>{due}</span> : null;
  }
  return null;
}

function NavRow({ to, params, label, icon, on, right, name }: { to: string; params?: Record<string, string>; label: string; icon: ReactNode; on: boolean; right?: ReactNode; name?: string }) {
  return (
    <Link to={to} params={params} className={cx(ROW, on && ROW_ON)} aria-current={on ? 'page' : undefined} aria-label={name}>
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {right}
    </Link>
  );
}

/** Tools ›: a small menu over the foot of the sidebar. Statement check asks which account first. */
function ToolsMenu({ accounts, onClose }: { accounts: readonly SidebarAccount[]; onClose: () => void }) {
  const [checking, setChecking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  const item = 'flex h-[24px] items-center rounded-[5px] px-[10px] text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-dot)] hover:text-white';
  return (
    <div
      ref={box}
      role="menu"
      aria-label="Tools"
      className="absolute bottom-full left-0 z-40 mb-1 min-w-[220px] rounded-[9px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-[6px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
    >
      {checking ? (
        <>
          <button type="button" className={cx(item, 'w-full gap-1 text-[var(--ph-ink-3)]')} onClick={() => setChecking(false)}>
            <ChevronLeft size={13} aria-hidden /> Statement check · which account?
          </button>
          {accounts.length === 0 && <p className="px-[10px] py-1 text-[12px] text-[var(--ph-ink-3)]">No accounts yet.</p>}
          {accounts.map((account) => (
            <Link key={account.id} role="menuitem" to={STATEMENT_CHECK} search={{ account: account.id }} className={item} onClick={onClose}>
              {account.name}
            </Link>
          ))}
        </>
      ) : (
        <>
          <p className="px-[10px] pt-[2px] pb-[2px] text-[11px] font-semibold text-[var(--ph-ink-3)]">Tools</p>
          {SIDEBAR_TOOLS.map((tool) => (
            <Link key={tool.to} role="menuitem" to={tool.to} className={item} onClick={onClose}>
              {tool.label}
            </Link>
          ))}
          <button type="button" role="menuitem" className={cx(item, 'w-full justify-between')} onClick={() => setChecking(true)}>
            Statement check <ChevronRight size={13} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}

function Footer() {
  const { database, ws } = useApp();
  const shared = useIsBookShared();
  const live = useSyncStatus(ws.bookId ?? '');
  const lastBackup = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, []);
  if (!lastBackup.isSuccess) return null;
  const status = footerStatus({ shared, running: live.running, failing: live.failing, lastSyncedAt: live.lastSyncedAt, lastBackupAt: lastBackup.data, now });
  const dot = status.tone === 'ok' ? 'var(--ph-up)' : status.tone === 'warn' ? 'var(--ph-warn)' : 'var(--ph-alarm)';
  return (
    <p data-testid="sidebar-status" className="flex items-center gap-[6px] border-t border-[var(--ph-hair)] px-2 pt-2 pb-[2px] text-[11px] text-[var(--ph-ink-3)]">
      <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: dot }} />
      <span className="min-w-0 truncate">{status.text}</span>
    </p>
  );
}

/**
 * The wide screen's sidebar, option A (Mac sidebar mockup, 2026-11-17): the workspace, three groups by job, the
 * workspace's accounts with their balances, Tools and Settings. The Mac app leaves room at the top for the window's
 * buttons, which sit over it (`.mac-app`, set in main.tsx).
 */
export function Sidebar() {
  const { workspaceName, ws } = useApp();
  const openBook = useOpenBook();
  const shared = useIsBookShared();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [choosing, setChoosing] = useState(false);
  const [tools, setTools] = useState(false);
  /*
   * The end-to-end build starts Accounts folded: its journeys find an account by its name on the page they test, and
   * the same name in the sidebar would be a second match. The sidebar's own journey opens it (e2e/sidebar.spec.ts).
   */
  const [folded, setFolded] = useState(() => readAccountsFolded(globalThis.localStorage, import.meta.env.VITE_E2E === '1'));
  const accounts = useSidebarAccounts(!folded);
  const destinations = [...SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => item.to)), ...accounts.map((account) => (account.to === '/cards/$cardId' ? `/cards/${account.id}` : `/accounts/${account.id}`))];
  const on = activeTo(pathname, destinations);
  const fold = () => {
    setFolded(!folded);
    writeAccountsFolded(!folded);
  };

  return (
    <aside className="ph-sidebar sticky top-0 hidden h-dvh w-[250px] shrink-0 flex-col border-r border-[var(--ph-hair)] bg-[var(--ph-side)] px-[10px] pb-[10px] md:flex">
      <div className="min-h-0 flex-1 overflow-y-auto pt-[var(--ph-side-top)]">
        <button
          type="button"
          aria-label="Workspace"
          onClick={() => setChoosing(true)}
          className="mb-2 flex w-full items-center gap-2 rounded-[7px] px-2 py-[5px] text-left hover:bg-[var(--ph-side-hover)]"
        >
          <WorkspaceDot book={openBook} size={22} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-4 font-semibold text-[var(--ph-ink)]">{openBook?.name ?? workspaceName}</span>
            <span className="block truncate text-[11px] leading-[14px] text-[var(--ph-ink-3)]">
              {openBook?.baseCurrency ?? ws.baseCurrency} · {shared ? 'shared' : 'on this device'}
            </span>
          </span>
          <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
        </button>
        {choosing && <WorkspaceSheet onClose={() => setChoosing(false)} />}

        <nav aria-label="Sections">
          {SIDEBAR_GROUPS.map((group) => (
            <div key={group.title ?? 'first'}>
              {group.title && <p className={HEADER}>{group.title}</p>}
              {group.items.map((item) => (
                <NavRow key={item.to} to={item.to} label={item.label} icon={<item.icon className={ICON} strokeWidth={1.7} aria-hidden />} on={on === item.to} right={item.badge ? <Badge kind={item.badge} /> : undefined} />
              ))}
            </div>
          ))}
          {accounts.length > 0 && (
            <div>
              <button type="button" onClick={fold} aria-expanded={!folded} aria-label={folded ? 'Show accounts' : 'Hide accounts'} className={cx(HEADER, 'flex w-full items-center justify-between')}>
                Accounts
                <ChevronDown size={12} aria-hidden className={cx('transition-transform', folded && '-rotate-90')} />
              </button>
              {!folded &&
                accounts.map((account) => {
                  const Icon = ACCOUNT_ICONS[account.kind];
                  const href = account.to === '/cards/$cardId' ? `/cards/${account.id}` : `/accounts/${account.id}`;
                  return (
                    <NavRow
                      key={account.id}
                      to={account.to}
                      params={account.to === '/cards/$cardId' ? { cardId: account.id } : { accountId: account.id }}
                      label={account.name}
                      icon={<Icon className={ICON} strokeWidth={1.7} aria-hidden />}
                      on={on === href}
                      right={account.minor === null ? undefined : <span className={GREY}>{compactMoney(account.minor, account.currency)}</span>}
                    />
                  );
                })}
            </div>
          )}
        </nav>
      </div>

      <div className="relative pt-2">
        {tools && <ToolsMenu accounts={accounts} onClose={() => setTools(false)} />}
        <button type="button" aria-haspopup="menu" aria-expanded={tools} onClick={() => setTools(!tools)} className={cx(ROW, 'w-full')}>
          <Wrench className="h-[15px] w-[15px] shrink-0 text-[var(--ph-ink-2)]" strokeWidth={1.7} aria-hidden />
          Tools
          <ChevronRight size={13} aria-hidden className="ml-auto text-[var(--ph-ink-3)]" />
        </button>
        <NavRow to={SETTINGS_TO} label="Settings" name="App settings" icon={<Settings className="h-[15px] w-[15px] shrink-0 text-[var(--ph-ink-2)]" strokeWidth={1.7} aria-hidden />} on={on === SETTINGS_TO} />
        <div className="mt-1">
          <Footer />
        </div>
      </div>
    </aside>
  );
}
