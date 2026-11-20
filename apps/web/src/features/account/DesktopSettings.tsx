import { LATEST_VERSION } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Cloud, History, Info, Link2, Search, Smartphone, Tags, Users, WalletCards, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import pkg from '../../../package.json';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { isMacApp, isPhoneApp } from '../../lib/mac';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { hasWidget } from '../../native/widget-summary';
import { cx, ErrorBox } from '../../ui';
import { ActivityList } from '../activity/ActivityPage';
import { DeskBackup } from '../backup/DeskBackup';
import { useCategorySetMembership, useCategorySets } from '../categories/set-queries';
import { buildName } from '../recovery/failure-record';
import { DeskDevices, DeskWorkspaces } from '../sharing/DeskSharing';
import { useBooks } from '../workspaces/queries';
import { isCardOption, paymentLabel } from '../transactions/PaymentSheet';
import { pickerGroups } from '../transactions/CategoryPicker';
import { paymentKey } from '../transactions/quick-row';
import { resolveDefaultPaidWith, usePayableOptions, useStoredDefaultPaidWith, writeDefaultPaidWith } from './default-paid-with';
import { DeskGroup, DeskIcon, DeskRow, PaneTitle } from './desk-rows';
import { matchSections, readSection, SETTINGS_SECTIONS, type SettingsSection, shownSection, writeSection } from './settings-desk-model';

const ICONS: Record<SettingsSection, LucideIcon> = {
  workspaces: Users,
  devices: Link2,
  backup: Cloud,
  defaults: WalletCards,
  categories: Tags,
  activity: History,
  capture: Smartphone,
  about: Info,
};

/** Defaults: where Paid with starts on new spending — the Default page's first choice, as one Mac pop-up. */
function DeskDefaults() {
  const { database, ws } = useApp();
  const queryClient = useQueryClient();
  const stored = useStoredDefaultPaidWith();
  const { options, accounts, ready } = usePayableOptions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const found = ready && stored.isSuccess ? resolveDefaultPaidWith(stored.data, options) : null;
  const current = found ? paymentKey(found.accountId, found.cardId) : '';
  const accountOf = (id: string) => accounts.find((account) => account.id === id);
  const money = options.filter((option) => !isCardOption(option, accountOf(option.accountId)));
  const cards = options.filter((option) => isCardOption(option, accountOf(option.accountId)));

  // The Default page's own write, saved as it is chosen (a Mac settings pane has no Save).
  async function choose(key: string) {
    setBusy(true);
    setError(null);
    try {
      await writeDefaultPaidWith(database, ws.workspaceId, key || null);
      await queryClient.invalidateQueries({ queryKey: ['default-paid-with'] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const option = (each: (typeof options)[number]) => {
    const key = paymentKey(each.accountId, each.cardId);
    return (
      <option key={key} value={key}>
        {paymentLabel(each)}
      </option>
    );
  };

  return (
    <div data-testid="settings-defaults">
      <PaneTitle>Defaults</PaneTitle>
      <div className="mb-[12px] empty:hidden">
        <ErrorBox error={error ?? stored.error} />
      </div>
      <DeskGroup title="New spending" footer="Where Paid with starts on a new transaction in this workspace. Choosing another for one purchase does not change it.">
        <DeskRow
          lead={<DeskIcon icon={WalletCards} tint="#ff9500" />}
          title="Paid with"
          right={
            <select
              aria-label="Paid with for new spending"
              value={current}
              disabled={!ready || !stored.isSuccess || busy}
              onChange={(event) => void choose(event.target.value)}
              className="h-[24px] max-w-[260px] rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[6px] text-[12.5px] text-[var(--ph-ink)] disabled:opacity-40"
            >
              <option value="">None</option>
              {money.length > 0 && <optgroup label="Money">{money.map(option)}</optgroup>}
              {cards.length > 0 && <optgroup label="Cards">{cards.map(option)}</optgroup>}
            </select>
          }
        />
      </DeskGroup>
      <p className="px-[2px] text-[11.5px] leading-[15px] text-[var(--ph-ink-3)]">What holding ＋ does and the One line look are phone settings, chosen on the phone where they are used.</p>
    </div>
  );
}

/** Categories: the editor itself is its own page; each kind and the sets open it. */
function DeskCategories() {
  const accounts = useAccounts().data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const inOpenBook = useInOpenBook();
  const sets = useCategorySets().data ?? [];
  const count = (kind: 'expense' | 'income') => {
    const groups = pickerGroups(accounts, kind, membership, inOpenBook);
    const subs = groups.reduce((sum, group) => sum + group.children.length, 0);
    return `${groups.length} ${groups.length === 1 ? 'category' : 'categories'}${subs > 0 ? `, ${subs} sub-categories` : ''}`;
  };
  return (
    <div data-testid="settings-categories">
      <PaneTitle>Categories</PaneTitle>
      <DeskGroup title="This workspace" footer="Each opens the category editor: add, rename, move or archive a category there.">
        <DeskRow lead={<DeskIcon icon={Tags} tint="#af52de" />} title="Expense categories" subtitle={count('expense')} to="/categories" />
        <DeskRow lead={<DeskIcon icon={Tags} tint="#34c759" />} title="Income categories" subtitle={count('income')} to="/categories" search={{ kind: 'income' }} />
        <DeskRow lead={<DeskIcon icon={Tags} tint="#8e8e93" />} title="Sets" subtitle={`${sets.length} ${sets.length === 1 ? 'set' : 'sets'} · categories an event draws on`} to="/categories/sets" />
      </DeskGroup>
    </div>
  );
}

function DeskActivity() {
  return (
    <div data-testid="settings-activity">
      <PaneTitle>Activity</PaneTitle>
      <p className="mb-[14px] px-[2px] text-[12px] leading-[16px] text-[var(--ph-ink-3)]">What was changed by hand, newest first, with Undo where the earlier figures are still whole.</p>
      <ActivityList narrow />
    </div>
  );
}

/** Capture and the widget: the iPhone app's own, on a wide iPhone screen only (never the Mac). */
function DeskCapture() {
  return (
    <div data-testid="settings-capture">
      <PaneTitle>Capture</PaneTitle>
      <DeskGroup>
        <DeskRow lead={<DeskIcon icon={Smartphone} tint="#ff3b30" />} title="Capture" subtitle="Bank messages, emails and screenshots" to="/settings/capture" />
        {hasWidget() && <DeskRow lead={<DeskIcon icon={Smartphone} tint="#8e8e93" />} title="Widget" to="/settings/widget" />}
      </DeskGroup>
    </div>
  );
}

function DeskAbout() {
  const build = useQuery({ queryKey: ['build-name'], queryFn: async () => (await buildName().catch(() => null)) ?? `${pkg.version} (web)`, staleTime: Infinity });
  return (
    <div data-testid="settings-about">
      <PaneTitle>About</PaneTitle>
      <DeskGroup>
        <DeskRow lead={<DeskIcon icon={Info} tint="#8e8e93" />} title="cicis" subtitle={isMacApp() ? 'Mac app' : isPhoneApp() ? 'iPhone app' : 'In the browser'} right={<span data-testid="about-version">{build.data ?? ''}</span>} />
        <DeskRow title="Data version" right={<span>{`update ${LATEST_VERSION}`}</span>} />
      </DeskGroup>
    </div>
  );
}

function Pane({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'workspaces':
      return <DeskWorkspaces />;
    case 'devices':
      return <DeskDevices />;
    case 'backup':
      return <DeskBackup />;
    case 'defaults':
      return <DeskDefaults />;
    case 'categories':
      return <DeskCategories />;
    case 'activity':
      return <DeskActivity />;
    case 'capture':
      return <DeskCapture />;
    case 'about':
      return <DeskAbout />;
  }
}

/**
 * Settings on a wide screen (Mac Settings and Tools, A), styled like the Mac's System Settings: the title bar, then an
 * inner column — Search and the sections, each a coloured square and its name — and the chosen section's rows beside
 * it. The sidebar's Settings, the Mac menu's Settings… (⌘,) and /backup open it; `?section=` names a section, and the
 * one last chosen here is shown otherwise. `section` is the route's own (/backup is Backup).
 */
export function DesktopSettings({ section: fixed }: { section?: SettingsSection }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const asked = (useSearch({ strict: false }) as { section?: SettingsSection }).section;
  const books = useBooks().data ?? [];
  const [remembered, setRemembered] = useState(() => readSection());
  const [query, setQuery] = useState('');
  const available = SETTINGS_SECTIONS.filter((each) => each.key !== 'capture' || isPhoneApp());
  const section = shownSection(fixed ?? asked, remembered, available.map((each) => each.key));
  const matches = matchSections(query, available, { workspaces: books.map((book) => book.name) });

  const choose = (key: SettingsSection) => {
    // Remembered only when chosen here: a deep link or /backup shows its section without changing the device's choice.
    writeSection(key);
    setRemembered(key);
    void navigate({ to: '/account', search: { section: key }, replace: pathname === '/account' });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--ov-ground)]" data-testid="settings-page" data-desk="true">
      <header className="desk-titlebar sticky top-0 z-10 flex h-[52px] shrink-0 items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Settings</h1>
        <span className="flex-1" />
        {isMacApp() && <span className="text-[12px] text-[var(--ph-ink-3)]">⌘,</span>}
      </header>
      {/* No reminder to back up over Backup itself (/backup and ?section=backup, as the phone's Backup page). */}
      <DeskNotices backup={section !== 'backup'} />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="sticky top-[var(--desk-bar)] h-[calc(100dvh-var(--desk-bar))] w-[230px] shrink-0 overflow-y-auto border-r border-[var(--ph-hair)] bg-[var(--mac-head)] px-[8px] py-[12px]">
          <label className="relative mb-[10px] flex h-[26px] items-center rounded-[7px] bg-[var(--ph-fill)] text-[12px]">
            <Search size={13} aria-hidden className="pointer-events-none absolute left-[8px] text-[var(--ph-ink-3)]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault();
                  setQuery('');
                } else if (event.key === 'Enter' && matches[0]) {
                  choose(matches[0].key);
                }
              }}
              placeholder="Search"
              aria-label="Search settings"
              autoComplete="off"
              className="h-full w-full rounded-[7px] bg-transparent pr-2 pl-[26px] text-[12px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-2 focus:outline-[var(--mac-accent)]"
            />
          </label>
          <ul className="space-y-[2px]">
            {matches.map(({ key, hits }) => {
              const info = available.find((each) => each.key === key)!;
              const on = key === section;
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-current={on ? 'page' : undefined}
                    onClick={() => choose(key)}
                    className={cx('flex w-full items-center gap-[9px] rounded-[7px] px-[8px] py-[5px] text-left text-[13px]', on ? 'bg-[var(--mac-accent)] text-white' : 'text-[var(--ph-ink)] hover:bg-[var(--ph-side-hover)]')}
                  >
                    <DeskIcon icon={ICONS[key]} tint={info.tint} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{info.name}</span>
                      {hits.length > 0 && <span className={cx('block truncate text-[11px]', on ? 'text-white/80' : 'text-[var(--ph-ink-3)]')}>{hits.join(' · ')}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {matches.length === 0 && <p className="px-[8px] pt-[4px] text-[12px] text-[var(--ph-ink-3)]">No setting by that name.</p>}
        </nav>
        {/* A region, not a <section>: each group inside is one, and a group is found by its own heading. */}
        <div role="region" className="min-w-0 flex-1 px-[30px] py-[22px]" aria-label={available.find((each) => each.key === section)?.name}>
          <div className="max-w-[620px]">
            <Pane section={section} />
          </div>
        </div>
      </div>
    </div>
  );
}
