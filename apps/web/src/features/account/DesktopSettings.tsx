import { LATEST_VERSION } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Cloud, History, Info, MonitorSmartphone, Search, Smartphone, Tags, Users, WalletCards, type LucideIcon } from 'lucide-react';
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
import { DeskWorkspaces } from '../sharing/DeskSharing';
import { DeskDevicePane, DeskLinkedDevices } from '../devices/DeskDevices';
import { useBooks } from '../workspaces/queries';
import { isCardOption, paymentLabel } from '../transactions/PaymentSheet';
import { pickerGroups } from '../transactions/CategoryPicker';
import { paymentKey } from '../transactions/quick-row';
import { resolveDefaultPaidWith, usePayableOptions, useStoredDefaultPaidWith, writeDefaultPaidWith } from './default-paid-with';
import { DeskGroup, DeskIcon, DeskRow, PaneTitle } from './desk-rows';
import { matchSections, readSection, SETTINGS_SECTIONS, type SettingsSection, shownSection, writeSection } from './settings-desk-model';
import { DeskBar } from '../../ui/desk';

const ICONS: Record<SettingsSection, LucideIcon> = {
  workspaces: Users,
  devices: MonitorSmartphone,
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
      <DeskGroup title="New spending" footer="The payment method a new transaction starts with in this workspace. Choosing another for one purchase does not change it.">
        <DeskRow
          lead={<DeskIcon icon={WalletCards} tint="#ff9500" />}
          title="Payment method"
          right={
            <select
              aria-label="Payment method for new spending"
              value={current}
              disabled={!ready || !stored.isSuccess || busy}
              onChange={(event) => void choose(event.target.value)}
              className="h-[30px] max-w-[260px] rounded-[9px] border border-[var(--mk-field-line)] bg-[var(--mk-field)] px-[8px] text-[13px] text-[var(--mk-ink)] focus:outline-2 focus:outline-[var(--mk-blue)] disabled:opacity-40"
            >
              <option value="">None</option>
              {money.length > 0 && <optgroup label="Money">{money.map(option)}</optgroup>}
              {cards.length > 0 && <optgroup label="Cards">{cards.map(option)}</optgroup>}
            </select>
          }
        />
      </DeskGroup>
      <p className="px-[4px] text-[12px] leading-[16px] text-[var(--mk-ink-2)]">What holding ＋ does and the One line look are phone settings, chosen on the phone where they are used.</p>
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
      <p className="mb-[14px] px-[4px] text-[13px] leading-[18px] text-[var(--mk-ink-2)]">What was changed by hand, newest first, with Undo where the earlier figures are still whole.</p>
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

/** A section's mark in the list: its round coloured icon, white on its own colour when the section is open. */
function SectionIcon({ icon: Icon, tint, on }: { icon: LucideIcon; tint: string; on: boolean }) {
  if (!on) return <DeskIcon icon={Icon} tint={tint} size={24} />;
  return (
    <span aria-hidden className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full bg-white/25 text-white">
      <Icon size={14} strokeWidth={2.2} />
    </span>
  );
}

function Pane({ section, device }: { section: SettingsSection; device?: string }) {
  switch (section) {
    case 'workspaces':
      return <DeskWorkspaces />;
    case 'devices':
      return device ? <DeskDevicePane deviceId={device} /> : <DeskLinkedDevices />;
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
 * one last chosen here is shown otherwise. `section` is the route's own (/backup is Backup, /account/devices Devices);
 * `device` is /account/devices/$deviceId's, that device's pane under Devices.
 */
export function DesktopSettings({ section: fixed, device }: { section?: SettingsSection; device?: string }) {
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
    <div className="flex min-h-dvh flex-col bg-[var(--mk-page)]" data-testid="settings-page" data-desk="true">
      <DeskBar crumb="Settings">
        {isMacApp() && <span className="text-[13px] font-semibold text-[var(--mk-ink-3)]">⌘,</span>}
      </DeskBar>
      {/* No reminder to back up over Backup itself (/backup and ?section=backup, as the phone's Backup page). */}
      <DeskNotices backup={section !== 'backup'} />
      <div className="flex min-h-0 flex-1">
        {/* v1: the sections on the white page, no rule beside them — rounded rows like the sidebar's, the open one filled
            in its section's colour. */}
        <nav aria-label="Settings sections" className="sticky top-[var(--desk-bar)] h-[calc(100dvh-var(--desk-bar))] w-[256px] shrink-0 overflow-y-auto py-[10px] pr-[8px] pl-[24px]">
          <label className="relative mb-[12px] flex h-[34px] items-center rounded-[12px] bg-[var(--mk-pill)] text-[13.5px]">
            <Search size={15} aria-hidden className="pointer-events-none absolute left-[11px] text-[var(--mk-ink-2)]" />
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
              className="h-full w-full rounded-[12px] bg-transparent pr-[10px] pl-[33px] text-[13.5px] text-[var(--mk-ink)] placeholder:text-[var(--mk-ink-2)] focus:outline-2 focus:outline-[var(--mk-blue)]"
            />
          </label>
          <ul className="space-y-[3px]">
            {matches.map(({ key, hits }) => {
              const info = available.find((each) => each.key === key)!;
              const on = key === section;
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-current={on ? 'page' : undefined}
                    onClick={() => choose(key)}
                    className={cx(
                      'flex min-h-[34px] w-full items-center gap-[11px] rounded-[12px] px-[12px] py-[6px] text-left text-[14px]',
                      on ? 'font-semibold text-white' : 'text-[var(--mk-ink)] hover:bg-[var(--mk-side-hover)]',
                    )}
                    style={on ? { background: info.tint } : undefined}
                  >
                    <SectionIcon icon={ICONS[key]} tint={info.tint} on={on} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{info.name}</span>
                      {hits.length > 0 && <span className={cx('block truncate text-[11.5px] font-normal', on ? 'text-white/85' : 'text-[var(--mk-ink-2)]')}>{hits.join(' · ')}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {matches.length === 0 && <p className="px-[12px] pt-[4px] text-[13px] text-[var(--mk-ink-2)]">No setting by that name.</p>}
        </nav>
        {/* A region, not a <section>: each group inside is one, and a group is found by its own heading. */}
        <div role="region" className="min-w-0 flex-1 px-[32px] pt-[14px] pb-[32px]" aria-label={available.find((each) => each.key === section)?.name}>
          <div className="max-w-[620px]">
            <Pane section={section} device={device} />
          </div>
        </div>
      </div>
    </div>
  );
}
