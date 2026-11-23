import { isoDate } from '@expanses/core';
import { type AccountRow, pocketParentIds } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, ChevronsUpDown, Settings, Wrench } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
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
import { useWalletCards } from '../features/wallet/useWalletCards';
import { CARD_W, cardHeightFor, type WalletCard, WalletFace } from '../ui/native';
import { WorkspaceDot } from '../features/workspaces/WorkspaceBadge';
import { WorkspaceSheet } from '../features/workspaces/WorkspaceSheet';
import { useAccounts, useBalances, useIsBookShared } from '../lib/queries';
import { cx } from '../ui';
import { useApp } from './context';
import {
  ACCOUNT_ICONS,
  NAV_COLOUR,
  activeTo,
  billsDueCount,
  compactMoney,
  footerStatus,
  readAccountsFolded,
  SETTINGS_TO,
  SIDEBAR_GROUPS,
  type SidebarAccount,
  type SidebarItem,
  sidebarAccounts,
  TOOLS_TO,
  writeAccountsFolded,
} from './sidebar-model';

const ROW = 'flex h-[33px] items-center gap-[11px] rounded-[12px] px-[12px] text-[14px] text-[var(--mk-ink)] hover:bg-[var(--mk-side-hover)]';
const ROW_ON = 'font-semibold text-white hover:bg-[var(--nav-on)]';
const ICON = 'h-[18px] w-[18px] shrink-0 text-[var(--mk-ink-2)]';
const HEADER = 'px-[12px] pt-[14px] pb-[5px] text-[11.5px] font-bold tracking-[0.06em] text-[var(--mk-ink-3)] uppercase';
const GREY = 'ml-auto shrink-0 whitespace-nowrap pl-2 text-[12px] text-[var(--mk-ink-2)] tabular-nums';
/** A count on the open page's coloured row: white on a paler white. */
const ON_COUNT = 'bg-white/25 text-white';
const PILL = 'ml-auto shrink-0 whitespace-nowrap rounded-full bg-[var(--mk-c-red)] px-[7px] text-[11.5px] leading-[18px] font-bold text-white tabular-nums';

/**
 * The money accounts and cards of the open workspace, with Wallet's figure for each, in Wallet's order. The figures
 * (the ledger's balances, the cards' instalments) are read only while the list is open: folded, the sidebar asks the
 * ledger nothing, and a screen that needs no ledger reads none.
 */
export function useSidebarAccounts(withFigures: boolean): SidebarAccount[] {
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
    // Folded (or still reading): the names alone, as the Tools page's Statement check asks for them too.
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

function Badge({ kind, on }: { kind: SidebarItem['badge']; on?: boolean }) {
  const review = usePendingDraftCount().data ?? 0;
  const late = useLateDebtCount();
  const bills = useMonthlyBills(isoDate()).data ?? [];
  if (kind === 'review') return review > 0 ? <span className={cx(PILL, on && ON_COUNT)}>{review}</span> : null;
  if (kind === 'late') {
    const note = lateNote(late);
    return note ? <span className={cx(PILL, on && ON_COUNT)}>{note}</span> : null;
  }
  if (kind === 'bills') {
    const due = billsDueCount(bills, isoDate());
    return due > 0 ? <span className={cx(GREY, on && cx(ON_COUNT, 'rounded-full px-[7px] font-bold'))}>{due}</span> : null;
  }
  return null;
}

function NavRow({ to, params, label, icon, on, right, name, colour }: { to: string; params?: Record<string, string>; label: string; icon: ReactNode; on: boolean; right?: ReactNode; name?: string; colour?: string }) {
  return (
    <Link
      to={to}
      params={params}
      className={cx(ROW, 'sidebar-row', on && ROW_ON)}
      style={on ? ({ background: colour ?? 'var(--nav-wallet)', '--nav-on': colour ?? 'var(--nav-wallet)' } as CSSProperties) : undefined}
      aria-current={on ? 'page' : undefined}
      aria-label={name}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right}
    </Link>
  );
}

/** A card's own face, a few pixels wide, in place of an icon (v1's account rows). */
function MiniFace({ card }: { card: WalletCard }) {
  const width = 22;
  return (
    <span aria-hidden className="relative -mx-[2px] block shrink-0 overflow-hidden rounded-[3.5px]" style={{ width, height: cardHeightFor(width) }}>
      <WalletFace card={card} band={false} scale={width / CARD_W} figure={false} />
    </span>
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
    <p data-testid="sidebar-status" className="flex items-center gap-[6px] border-t border-[var(--mk-side-line)] px-[12px] pt-[8px] pb-[2px] text-[11.5px] text-[var(--mk-ink-2)]">
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
  /*
   * The end-to-end build starts Accounts folded: its journeys find an account by its name on the page they test, and
   * the same name in the sidebar would be a second match. The sidebar's own journey opens it (e2e/sidebar.spec.ts).
   */
  const [folded, setFolded] = useState(() => readAccountsFolded(globalThis.localStorage, import.meta.env.VITE_E2E === '1'));
  const accounts = useSidebarAccounts(!folded);
  const faces = useWalletCards().cards;
  const destinations = [...SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => item.to)), ...accounts.map((account) => (account.to === '/cards/$cardId' ? `/cards/${account.id}` : `/accounts/${account.id}`))];
  const on = activeTo(pathname, destinations);
  // The open row stays in sight: a card's page lights its row far down the Accounts list.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [pathname, folded, accounts.length]);
  const fold = () => {
    setFolded(!folded);
    writeAccountsFolded(!folded);
  };

  return (
    <aside className="ph-sidebar mk sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col border-r border-[var(--mk-side-line)] bg-[var(--mk-side)] px-[12px] pb-[12px] md:flex">
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto pt-[var(--ph-side-top)]">
        <button
          type="button"
          aria-label="Workspace"
          onClick={() => setChoosing(true)}
          className="mb-[6px] flex w-full items-center gap-[10px] rounded-[12px] px-[10px] py-[7px] text-left hover:bg-[var(--mk-side-hover)]"
        >
          <WorkspaceDot book={openBook} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] leading-[18px] font-bold text-[var(--mk-ink)]">{openBook?.name ?? workspaceName}</span>
            <span className="block truncate text-[12px] leading-[16px] text-[var(--mk-ink-2)]">
              {openBook?.baseCurrency ?? ws.baseCurrency} · {shared ? 'shared' : 'on this device'}
            </span>
          </span>
          <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-[var(--mk-ink-3)]" />
        </button>
        {choosing && <WorkspaceSheet onClose={() => setChoosing(false)} />}

        <nav aria-label="Sections">
          {SIDEBAR_GROUPS.map((group) => (
            <div key={group.title ?? 'first'}>
              {group.title && <p className={HEADER}>{group.title}</p>}
              {group.items.map((item) => (
                <NavRow
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  colour={NAV_COLOUR[item.to]}
                  icon={<item.icon className={cx(ICON, on === item.to && 'text-white')} strokeWidth={1.8} aria-hidden />}
                  on={on === item.to}
                  right={item.badge ? <Badge kind={item.badge} on={on === item.to} /> : undefined}
                />
              ))}
            </div>
          ))}
          {accounts.length > 0 && (
            <div>
              <button type="button" onClick={fold} aria-expanded={!folded} aria-label={folded ? 'Show accounts' : 'Hide accounts'} className={cx(HEADER, 'flex w-full items-center')}>
                <span className="flex items-center gap-[3px]">
                  Accounts
                  <ChevronDown size={12} strokeWidth={2.4} aria-hidden className={cx('transition-transform', folded && '-rotate-90')} />
                </span>
              </button>
              {!folded &&
                accounts.map((account) => {
                  const Icon = ACCOUNT_ICONS[account.kind];
                  const face = account.kind === 'card' ? faces.find((one) => one.key === account.id) : undefined;
                  const lit = on === `${account.to === '/cards/$cardId' ? '/cards/' : '/accounts/'}${account.id}`;
                  const href = account.to === '/cards/$cardId' ? `/cards/${account.id}` : `/accounts/${account.id}`;
                  return (
                    <NavRow
                      key={account.id}
                      to={account.to}
                      params={account.to === '/cards/$cardId' ? { cardId: account.id } : { accountId: account.id }}
                      label={account.name}
                      icon={face ? <MiniFace card={face} /> : <Icon className={cx(ICON, lit && 'text-white')} strokeWidth={1.8} aria-hidden />}
                      on={on === href}
                      right={account.minor === null ? undefined : <span className={cx(GREY, lit && 'text-white/85')}>{compactMoney(account.minor, account.currency)}</span>}
                    />
                  );
                })}
            </div>
          )}
        </nav>
      </div>

      <div className="relative pt-2">
        {/* Tools › opens the Tools page (Mac Settings and Tools, B): every tool a tile, Statement check among them. */}
        <NavRow
          to={TOOLS_TO}
          label="Tools"
          colour="var(--nav-tools)"
          icon={<Wrench className={cx(ICON, on === TOOLS_TO && 'text-white')} strokeWidth={1.8} aria-hidden />}
          on={on === TOOLS_TO}
          right={<ChevronRight size={13} aria-hidden className={cx('ml-auto shrink-0', on === TOOLS_TO ? 'text-white/80' : 'text-[var(--mk-ink-3)]')} />}
        />
        <NavRow
          to={SETTINGS_TO}
          label="Settings"
          name="App settings"
          colour="var(--nav-settings)"
          icon={<Settings className={cx(ICON, on === SETTINGS_TO && 'text-white')} strokeWidth={1.8} aria-hidden />}
          on={on === SETTINGS_TO}
        />
        <div className="mt-1">
          <Footer />
        </div>
      </div>
    </aside>
  );
}
