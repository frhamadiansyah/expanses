import { balanceSheet, formatMinor, isoDate, lastNMonths, monthOf, portfolioSummary, type SheetLiability, type SheetRow, type SheetSectionKey } from '@expanses/core';
import { type AccountSubtype, type LiabilityKind, pocketParentIds } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { compactMoney } from '../../app/sidebar-model';
import { useEscape } from '../../app/use-escape';
import { useAccounts } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { RowIcon } from '../../ui/native';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { accountDestination } from '../accounts/destination';
import { useBaseCosts } from '../investments/queries';
import { useIncomeYear } from '../investments/use-income-year';
import { assetKindTile, assetSectionTile, debtKindTile } from '../ownables/catalogue-view';
import { buyChoices } from '../transactions/buy-in-form';
import { BOX, NOTE } from '../transactions/CashflowBoxes';
import { type DeskChartMonth, DeskNetWorthChart, useBoxWidth } from './DeskNetWorthChart';
import { STATUS_INK } from './HealthRatios';
import { ratioDisplay } from './health-cards';
import { figureOf, jointSeries, ownerRing, receivedPocketAccounts, sheetOwnerOf } from './joint-rows';
import { type KindLook, NetWorthPeek, type NetWorthPeekSubject, tintOf } from './NetWorthPeek';
import { assetSide, debtSide, type DeskKind, type DeskSide, type PeekKey, peekOrder, treemapOf, type TreemapBox, yearChange } from './networth-desk-model';
import { foldPockets } from './overview-rows';
import { memberName, useAssetProfiles, useAssetValues, useJointSheet, useNetWorthSeries, useOwnedTogether, useOwnerRings, useSheet } from './queries';
import { debtKind, rowKindOf, type RowKind } from './sheet-drawers';
import { spanSlice } from './span';
import { ASSET_STACK_KEYS, DEBT_STACK_KEYS, STACK_KEYS } from './stack-keys';
import { useHealthInputs, useHealthRatios } from './use-health';

const CHART_HEIGHT = 190;
const TREEMAP_HEIGHT = 150;

const GBTN =
  'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)] disabled:opacity-40 disabled:hover:bg-[var(--ph-surface)]';
const PBTN =
  'inline-flex h-[26px] items-center gap-[3px] rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)]';
const H2 = 'flex items-baseline justify-between gap-[10px] px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]';
const TH = 'border-b border-[var(--ph-hair)] bg-[var(--mac-head)] px-[10px] py-[6px] text-[11px] font-semibold text-[var(--ph-ink-3)]';

/** The chart's two drawings and two ranges, as the title bar's switches name them. */
type ChartView = 'line' | 'bars';
type DeskSpan = '1y' | 'all';
const VIEW_KEY = 'expanses.networth.chart';
const SPAN_KEY = 'expanses.networth.desk.span';
const FOLD_KEY = 'expanses.networth.desk.folded';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the choice still holds for this visit.
  }
}

/**
 * The colour each kind is drawn in: the asset sections in the colours the phone's bars and their key give them (the same
 * Tailwind hues), the debts in a family of reds and oranges, a colour a kind in the order the kinds are listed.
 */
const SECTION_COLOURS: Record<string, string> = {
  liquid: '#0891b2',
  receivable: '#3b82f6',
  invest: '#059669',
  movable: '#64748b',
  immovable: '#7c3aed',
  other: '#d97706',
};
const DEBT_COLOURS = ['#e11d48', '#ea580c', '#db2777', '#dc2626', '#c2410c', '#be123c'];
/** The parts inside Investments' box: shades between the box's tint and the surface. */
const PART_SHADES = [26, 20, 14, 10, 7, 5];

/** The ratios the health box shows, in its order; the rest are a click away on the health screen. */
const HEALTH_KEYS = ['emergency_fund', 'savings_ratio', 'debt_payments', 'liquidity'] as const;

/** Whose a row is on the household's sheet: the ring its circle wears and the name a reader hears. */
interface RowOwner {
  ring: string | null;
  name: string;
  received: boolean;
  native: { minor: number; currency: string } | null;
}

/**
 * Net worth on a wide screen (Mac redesign step 8, owner 2026-11-17 "ok build"): a title bar with Line / Bars, 12 months /
 * All, Prices, Trade and ＋ Add; the figure with its months drawn under it beside the Financial health ratios; then the
 * two sides of the sheet — Assets, and Debts with Investments under it — each a treemap strip of its kinds over a table of
 * its kinds and rows. A click on a box or a row opens its side peek, a double-click its page. The figures are the phone's
 * balance sheet (`balanceSheet` over `useSheet`, or the household's with one tax ID), so Total assets − Total debts is the
 * figure at the top, and a card counts all it owes here (Wallet shows only what is due now). The phone's Net worth is
 * not this page.
 */
export function DesktopNetWorth() {
  const { ws } = useApp();
  const base = ws.baseCurrency;
  const navigate = useNavigate();
  const today = isoDate();

  // ── The title bar's switches, this device's choice ─────────────────────────────────────────────────────────────────
  const [view, setViewState] = useState<ChartView>(() => (readLocal(VIEW_KEY) === 'bars' ? 'bars' : 'line'));
  const setView = (next: ChartView) => {
    setViewState(next);
    writeLocal(VIEW_KEY, next);
  };
  const [span, setSpanState] = useState<DeskSpan>(() => (readLocal(SPAN_KEY) === 'all' ? 'all' : '1y'));
  const setSpan = (next: DeskSpan) => {
    setSpanState(next);
    writeLocal(SPAN_KEY, next);
  };

  // ── The sheet: the phone's own reading, the household's with one tax ID ───────────────────────────────────────────
  // Thirteen month-ends for a year: the twelve drawn, and the one before them that the chip's change is read against.
  const months = lastNMonths(monthOf(today), span === 'all' ? 60 : 13);
  const series = useNetWorthSeries(months);
  const sheetInputs = useSheet();
  const household = useJointSheet();
  const ringsOf = useOwnerRings();
  const together = useOwnedTogether();
  const accounts = useAccounts();
  const assetValues = useAssetValues();
  const assetProfiles = useAssetProfiles();
  const joint = household.data;
  const holding = household.status === 'pending' || household.status === 'error';
  const points = holding ? [] : joint ? jointSeries(series.data ?? [], joint.received, joint.ratesToBase, base) : (series.data ?? []);
  const shown = span === 'all' ? spanSlice(points, 'all') : points.slice(-12);
  const sheetMissing = joint ? joint.missing : (sheetInputs.data?.missing ?? []);
  const unchartable = [...new Set(points.flatMap((point) => point.missing))].sort();
  const sheet = joint ? balanceSheet(joint.assets, joint.liabilities) : balanceSheet(sheetInputs.data?.assets ?? [], sheetInputs.data?.liabilities ?? []);
  const theirPockets = joint ? receivedPocketAccounts(joint.received, joint.rows, base) : { pockets: new Map(), parents: new Map() };
  const owners = new Map([...(joint?.rows ?? []), ...theirPockets.parents.values()].map((row) => [row.accountId, row]));
  const unrated = new Set((joint?.rows ?? []).filter((row) => row.amountMinor === null).map((row) => row.accountId));
  const everything = accounts.data ?? [];
  const byAccount = new Map(everything.map((account) => [account.id, account]));
  const parents = pocketParentIds(everything);
  const ownerOf = (accountId: string): RowOwner | null => {
    if (!joint) return null;
    const { owner, received, row } = sheetOwnerOf(accountId, owners, everything, joint.me);
    const native = row && row.amountMinor === null ? { minor: row.nativeMinor, currency: row.currency } : null;
    return { ring: ringsOf ? ownerRing(ringsOf.rings, owner) : null, name: memberName(joint.names, owner), received, native };
  };
  const sheetBlocked = joint ? joint.ownMissing.length > 0 : sheetMissing.length > 0;

  // What kind each row is: the phone's drawers' own reading (`rowKindOf`, `debtKind`).
  const subtypes = new Map<string, AccountSubtype>(everything.map((account) => [account.id, account.subtype]));
  for (const row of [...(joint?.rows ?? []), ...theirPockets.parents.values()]) if (row.received) subtypes.set(row.accountId, row.subtype as AccountSubtype);
  const debtFacts = new Map<string, { item?: string | null; icon?: SheetLiability['icon'] }>((joint?.liabilities ?? sheetInputs.data?.liabilities ?? []).map((row) => [row.accountId, row]));
  const assetKind = (section: string, row: SheetRow): RowKind => rowKindOf(section, row, (accountId) => subtypes.get(accountId));
  const debtRowKind = (row: SheetRow): RowKind => {
    const facts = debtFacts.get(row.accountId);
    return facts?.icon ? debtKind(facts.item ?? null, facts.icon) : assetKind('debts', row);
  };
  const assets: DeskSide = assetSide(foldPockets(sheet.assetGroups, everything, base, theirPockets.pockets), assetKind, unrated);
  const debts: DeskSide = debtSide(sheet.debts, debtRowKind, unrated);
  const debtColour = new Map(debts.kinds.map((kind, index) => [kind.key, DEBT_COLOURS[index % DEBT_COLOURS.length]!]));
  const lookOf = (side: 'asset' | 'debt', kind: string): KindLook =>
    side === 'asset' ? { colour: SECTION_COLOURS[kind] ?? '#64748b', Glyph: assetSectionTile(kind) } : { colour: debtColour.get(kind) ?? DEBT_COLOURS[0]!, Glyph: debtKindTile(kind) };
  const ready = !holding && sheetInputs.isSuccess && accounts.isSuccess;
  const nothing = ready && !sheetBlocked && assets.kinds.length === 0 && debts.kinds.length === 0;

  // ── The chart's months and the chip ────────────────────────────────────────────────────────────────────────────────
  const chartMonths: DeskChartMonth[] = shown.map((point) => ({
    month: point.month,
    netWorthMinor: point.netWorthMinor,
    bar: {
      netWorthMinor: point.netWorthMinor,
      assets: point.stack === null ? [] : ASSET_STACK_KEYS.map((key) => ({ key: key.key, minor: point.stack?.assets[key.key as SheetSectionKey] ?? 0 })),
      liabilities: point.stack === null ? [] : DEBT_STACK_KEYS.map((key) => ({ key: key.key, minor: point.stack?.liabilities[key.key as LiabilityKind] ?? 0 })),
    },
  }));
  const change = ready && sheetMissing.length === 0 ? yearChange(points, monthOf(today), sheet.netWorthMinor) : null;

  // ── Folding and the peek ───────────────────────────────────────────────────────────────────────────────────────────
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set((readLocal(FOLD_KEY) ?? '').split(',').filter(Boolean)));
  const toggleFold = (key: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeLocal(FOLD_KEY, [...next].join(','));
      return next;
    });
  const order = peekOrder(assets, debts, folded);
  const [peekKey, setPeekKey] = useState<PeekKey | null>(null);
  const subject = peekKey ? subjectOf(peekKey) : null;
  const peeking = subject !== null;
  const step = (by: -1 | 1) => {
    if (!peekKey) return;
    const at = order.indexOf(peekKey);
    const next = at < 0 ? undefined : order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setPeekKey(next);
  };
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);
  // The page makes room for the peek as it opens, which can move the boxes under one another: the row picked is brought
  // back into view. A double-click whose second click lands off the moved row or box still opens its page
  // (`usePeekDoubleClick`).
  useEffect(() => {
    if (!peekKey) return;
    document.querySelector('[data-networth-row][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [peekKey]);
  useEffect(() => {
    if (!peeking) return;
    const place = () => setPeekTop(Math.max(0, bar.current?.getBoundingClientRect().bottom ?? 52));
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [peeking]);
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (!peekKey) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (event.key === 'Escape') setPeekKey(null);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'ArrowDown') step(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  function subjectOf(key: PeekKey): NetWorthPeekSubject | null {
    const [type, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (type === 'asset-kind' || type === 'debt-kind') {
      const side = type === 'asset-kind' ? 'asset' : 'debt';
      const kind = (side === 'asset' ? assets : debts).kinds.find((each) => each.key === id);
      return kind ? { type: 'kind', side, kind, look: lookOf(side, kind.key), sideLabel: side === 'asset' ? 'assets' : 'debts' } : null;
    }
    const side = type === 'asset' ? 'asset' : 'debt';
    for (const kind of (side === 'asset' ? assets : debts).kinds) {
      const item = kind.items.find((each) => each.accountId === id);
      if (!item) continue;
      const owner = ownerOf(id);
      const account = owner?.received ? undefined : byAccount.get(id);
      return {
        type: 'item',
        side,
        item,
        kind,
        look: lookOf(side, kind.key),
        account,
        received: owner?.received ? { ownerName: owner.name, native: owner.native } : undefined,
        to: destinationOf(id),
        pockets: account ? pocketsOfParent(account.id) : [],
      };
    }
    return null;
  }
  function pocketsOfParent(accountId: string): string[] {
    return parents.has(accountId) ? everything.filter((account) => account.parentId === accountId && account.archivedAt === null).map((account) => account.id) : [];
  }
  function destinationOf(accountId: string) {
    if (ownerOf(accountId)?.received) return { to: '/net-worth/shared/$itemId' as const, params: { itemId: accountId } };
    const account = byAccount.get(accountId);
    return account ? accountDestination(account) : undefined;
  }
  const openPage = (key: PeekKey) => {
    window.scrollTo(0, 0);
    if (key.startsWith('asset-kind:')) return void navigate({ to: '/net-worth/assets' });
    if (key.startsWith('debt-kind:')) return void navigate({ to: '/net-worth/loans' });
    const to = destinationOf(key.slice(key.indexOf(':') + 1));
    if (to) void navigate(to as Parameters<typeof navigate>[0]);
  };
  const doubleClick = usePeekDoubleClick((key) => openPage(key as PeekKey));

  // ── Health, investments, trade ─────────────────────────────────────────────────────────────────────────────────────
  const health = useHealthInputs({ key: 'ttm' });
  const ratios = useHealthRatios({ flows: health.flows, totals: health.totals, jointTotals: health.jointTotals });
  const income = useIncomeYear();
  const baseCosts = useBaseCosts();
  const canTrade = buyChoices(assetValues.data ?? [], assetProfiles.data ?? []).buys.length > 0;
  const investKind = assets.kinds.find((kind) => kind.key === 'invest') ?? null;
  const investIds = new Set(investKind?.items.map((item) => item.accountId) ?? []);
  const investValues = (assetValues.data ?? []).filter((row) => investIds.has(row.accountId) && (row.mode === 'market' || row.mode === 'amount'));
  // The gain is read over the holdings this device keeps; with a partner's item among them it would not be the box's whole.
  const ownInvest = investKind !== null && investKind.items.every((item) => !ownerOf(item.accountId)?.received);
  const gain =
    ownInvest && baseCosts.data && investValues.length > 0
      ? portfolioSummary(
          investValues.map((row) => ({
            currency: row.currency,
            valueMinor: row.valueMinor,
            costMinor: row.costMinor,
            costBaseMinor: row.currency === base ? row.costMinor : (baseCosts.data.positions[row.accountId]?.costMinor ?? (row.costMinor === 0 ? 0 : null)),
          })),
          base,
          income.rates,
        )
      : null;

  const onRow = (key: PeekKey) => (event: MouseEvent) => {
    event.preventDefault();
    setPeekKey(key);
  };

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="networth-page" data-desk="true" {...doubleClick}>
      <header ref={bar} className="desk-titlebar sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Net worth</h1>
        <span className="flex-1" />
        <Segments label="Chart view" value={view} onChange={setView} options={[{ key: 'line', label: 'Line' }, { key: 'bars', label: 'Bars' }]} />
        <Segments label="Range" value={span} onChange={setSpan} options={[{ key: '1y', label: '12 months' }, { key: 'all', label: 'All' }]} />
        <Link to="/net-worth/prices" className={GBTN}>
          Prices
        </Link>
        {canTrade ? (
          <Link to="/transactions/new" search={{ mode: 'trade' }} className={GBTN}>
            Trade
          </Link>
        ) : (
          <button type="button" disabled className={GBTN} title="Nothing held to trade yet">
            Trade
          </button>
        )}
        <AddMenu />
      </header>
      <DeskNotices />

      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', peeking && 'mr-[322px]')}>
        <ErrorBox error={series.error ?? sheetInputs.error ?? household.error ?? health.error} />
        <div className="grid grid-cols-1 items-stretch gap-[14px] @min-[900px]:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <section className={BOX} aria-label="Net worth" data-testid="networth-box">
            <h2 className={H2}>
              Net worth<span className={NOTE}>assets − debts</span>
            </h2>
            <div data-testid="net-worth" className="flex flex-wrap items-baseline gap-x-[8px] gap-y-1 px-[14px]">
              {holding || !ready ? (
                <span className="text-[26px] leading-[32px] font-semibold text-[var(--ph-ink-3)]">—</span>
              ) : sheetMissing.length > 0 ? (
                <p className="py-2 text-[13px] text-[var(--ph-warn)]">No {sheetMissing.join(', ')} rate yet, so net worth cannot be added up.</p>
              ) : (
                <>
                  <span data-testid="net-worth-figure" className="text-[26px] leading-[32px] font-semibold whitespace-nowrap text-[var(--ph-ink)] tabular-nums">
                    {formatMinor(sheet.netWorthMinor, base)}
                  </span>
                  {change && (
                    <span
                      data-testid="net-worth-change"
                      className={cx(
                        'rounded-[5px] px-[6px] py-px text-[11.5px] whitespace-nowrap tabular-nums',
                        change.changeMinor < 0 ? 'bg-[color-mix(in_srgb,var(--ph-alarm)_13%,transparent)] text-[var(--ph-alarm)]' : 'bg-[color-mix(in_srgb,var(--ph-up)_13%,transparent)] text-[var(--ph-up)]',
                      )}
                    >
                      {change.changeMinor > 0 ? '+' : ''}
                      {formatMinor(change.changeMinor, base)}
                      {change.percent !== null && ` · ${change.percent > 0 ? '+' : ''}${change.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`} in 12 months
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="px-[14px] pt-[8px] pb-[10px]">
              <DeskNetWorthChart months={chartMonths} view={view} currency={base} keys={STACK_KEYS} height={CHART_HEIGHT} />
              {sheetMissing.length === 0 && unchartable.length > 0 && (
                <p data-testid="chart-missing" className="pt-[6px] text-[12px] text-[var(--ph-warn)]">
                  No {unchartable.join(', ')} rate for an earlier month, so the line breaks there.
                </p>
              )}
            </div>
          </section>

          <section className={BOX} aria-label="Financial health" data-testid="health-box">
            <h2 className={H2}>
              <Link to="/net-worth/health" className="hover:underline">
                Financial health
              </Link>
              <span className={NOTE}>last 12 months</span>
            </h2>
            {health.totals === null && health.missing.length > 0 ? (
              <p data-testid="ratios-missing" className="border-t border-[var(--ph-hair)] px-[14px] py-[10px] text-[13px] text-[var(--ph-warn)]">
                No {health.missing.join(', ')} rate yet, so the ratios cannot be worked out.
              </p>
            ) : (
              HEALTH_KEYS.flatMap((key) => {
                const ratio = ratios.find((each) => each.key === key);
                if (!ratio) return [];
                const display = ratioDisplay(ratio);
                return [
                  <Link key={key} to="/net-worth/health" data-testid={`health-${key}`} className="block border-t border-[var(--ph-hair)] px-[14px] py-[8px] hover:bg-[var(--ph-fill)]">
                    <span className="flex items-baseline justify-between gap-2 text-[13px] text-[var(--ph-ink)]">
                      <span className="min-w-0 truncate">{ratio.name}</span>
                      <span className={cx('shrink-0 text-[10.5px] font-bold tracking-[0.04em] uppercase', STATUS_INK[ratio.status])}>{display.statusLabel}</span>
                    </span>
                    <span className="mt-[2px] flex items-baseline justify-between gap-2">
                      <b className="text-[15px] font-semibold whitespace-nowrap text-[var(--ph-ink)] tabular-nums">{display.value}</b>
                      <span className="min-w-0 truncate text-[11.5px] text-[var(--ph-ink-3)]">guide {ratio.benchmarkText}</span>
                    </span>
                  </Link>,
                ];
              })
            )}
            <Link to="/net-worth/health" className="flex items-center justify-between border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[13px] text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]">
              All ratios
              <ChevronRight size={14} aria-hidden />
            </Link>
          </section>
        </div>

        {ready && sheetBlocked ? (
          <section className={BOX}>
            <p data-testid="balance-sheet-missing" className="px-[14px] py-[12px] text-[13px] text-[var(--ph-warn)]">
              No {sheetMissing.join(', ')} rate yet, so the balance sheet cannot be added up.
            </p>
          </section>
        ) : (
          ready && (
            <>
              {sheetMissing.length > 0 && (
                <section className={BOX}>
                  <p data-testid="balance-sheet-missing" className="px-[14px] py-[12px] text-[13px] text-[var(--ph-warn)]">
                    No {sheetMissing.join(', ')} rate yet, so the household's totals cannot be added up. Those items show in their own currency.
                  </p>
                </section>
              )}
              <div className="grid grid-cols-1 items-start gap-[14px] @min-[900px]:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
                <SideBox
                  side="asset"
                  data={assets}
                  totalLabel="Total assets"
                  totalTestId="sheet-total-assets"
                  currency={base}
                  lookOf={lookOf}
                  kindIcon={(kind, item) => assetKindTile(kind.key, item.kind.key)}
                  folded={folded}
                  onFold={toggleFold}
                  peekKey={peekKey}
                  onRow={onRow}
                  onOpen={openPage}
                  ownerOf={ownerOf}
                  together={together}
                  destinationOf={destinationOf}
                  empty={nothing}
                />
                <div className="flex min-w-0 flex-col gap-[14px]">
                  <SideBox
                    side="debt"
                    data={debts}
                    totalLabel="Total debts"
                    totalTestId="sheet-total-liabilities"
                    currency={base}
                    lookOf={lookOf}
                    kindIcon={(kind) => debtKindTile(kind.key)}
                    folded={folded}
                    onFold={toggleFold}
                    peekKey={peekKey}
                    onRow={onRow}
                    onOpen={openPage}
                    ownerOf={ownerOf}
                    together={together}
                    destinationOf={destinationOf}
                    empty={false}
                  />
                  {investKind && investKind.totalMinor !== null && (
                    <section className={BOX} aria-label="Investments" data-testid="investments-box">
                      <h2 className={H2}>
                        Investments
                        <span className={NOTE}>{investKind.share}% of assets</span>
                      </h2>
                      <Figure label="Value" testId="investments-value">
                        {formatMinor(investKind.totalMinor, base)}
                      </Figure>
                      {gain && gain.gainBaseMinor !== null && gain.costBaseMinor !== null && gain.costBaseMinor > 0 && (
                        <Figure label="Gain" testId="investments-gain" tone={gain.gainBaseMinor < 0 ? 'down' : gain.gainBaseMinor > 0 ? 'up' : undefined}>
                          {gain.gainBaseMinor > 0 ? '+' : ''}
                          {formatMinor(gain.gainBaseMinor, base)}
                          {gain.gainBps !== null && ` · ${gain.gainBps > 0 ? '+' : ''}${(gain.gainBps / 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}
                        </Figure>
                      )}
                      {income.received !== null && income.listed.length + income.bonds.length > 0 && (
                        <Figure label="Dividends this year" testId="investments-dividends">
                          {formatMinor(income.received, base)}
                        </Figure>
                      )}
                      <div className="flex flex-wrap items-center gap-x-[6px] border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[13px] text-[var(--mac-accent)]">
                        <Link to="/net-worth/assets" className="hover:underline">
                          Holdings
                        </Link>
                        <span className="text-[var(--ph-ink-3)]">·</span>
                        <Link to="/net-worth/investments/trades" className="hover:underline">
                          Trades
                        </Link>
                        <span className="text-[var(--ph-ink-3)]">·</span>
                        <Link to="/net-worth/investments/dividends" className="hover:underline">
                          Dividends
                        </Link>
                        <ChevronRight size={14} aria-hidden />
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </>
          )
        )}
      </div>

      {subject && peekKey && (
        <NetWorthPeek
          key={peekKey}
          subject={subject}
          currency={base}
          top={peekTop}
          first={order.indexOf(peekKey) <= 0}
          last={order.indexOf(peekKey) === -1 || order.indexOf(peekKey) === order.length - 1}
          onStep={step}
          onClose={() => setPeekKey(null)}
          onPick={(accountId) => setPeekKey(`${subject.side === 'asset' ? 'asset' : 'debt'}:${accountId}`)}
          onOpen={() => openPage(peekKey)}
        />
      )}
    </div>
  );
}

/** A switch in the title bar: two words on a grey track, the chosen one raised. */
function Segments<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (next: T) => void; options: readonly { key: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          onClick={() => onChange(option.key)}
          className={cx(
            'rounded-[5px] px-[11px] py-[3px] whitespace-nowrap',
            value === option.key ? 'bg-[var(--ph-selected)] font-medium text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'text-[var(--ph-ink-2)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** ＋ Add: what is added here — an asset (the add-asset picker) or a debt (the add-debt picker). */
function AddMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const away = (event: globalThis.MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const item = 'flex h-[26px] items-center rounded-[5px] px-[10px] text-[13px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--mac-accent)] hover:text-white';
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)} className={PBTN}>
        <span aria-hidden>＋</span>Add
      </button>
      {open && (
        <div role="menu" aria-label="Add" className="absolute top-full right-0 z-30 mt-1 min-w-[170px] rounded-[9px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-[6px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]">
          <Link role="menuitem" to="/net-worth/assets/new" className={item} onClick={() => setOpen(false)}>
            Asset…
          </Link>
          <Link role="menuitem" to="/debts/new" className={item} onClick={() => setOpen(false)}>
            Debt…
          </Link>
        </div>
      )}
    </div>
  );
}

/** One of the Investments box's figures: what it is on the left, the figure on the right. */
function Figure({ label, testId, tone, children }: { label: string; testId: string; tone?: 'up' | 'down'; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[13px] text-[var(--ph-ink)]">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span data-testid={testId} className={cx('shrink-0 whitespace-nowrap tabular-nums', tone === 'up' && 'text-[var(--ph-up)]', tone === 'down' && 'text-[var(--ph-alarm)]')}>
        {children}
      </span>
    </div>
  );
}

/**
 * A side of the sheet: its treemap strip (one box a kind, the largest first and showing its amount; Investments split
 * inside by holding type), then its table — a bold row a kind with its figure and share, folding with ▼, and its rows
 * under it — and the side's total. A click on a box or a row opens its peek; a double-click its page.
 */
function SideBox({
  side,
  data,
  totalLabel,
  totalTestId,
  currency,
  lookOf,
  kindIcon,
  folded,
  onFold,
  peekKey,
  onRow,
  onOpen,
  ownerOf,
  together,
  destinationOf,
  empty,
}: {
  side: 'asset' | 'debt';
  data: DeskSide;
  totalLabel: string;
  totalTestId: string;
  currency: string;
  lookOf: (side: 'asset' | 'debt', kind: string) => KindLook;
  kindIcon: (kind: DeskKind, item: DeskKind['items'][number]) => KindLook['Glyph'];
  folded: ReadonlySet<string>;
  onFold: (key: string) => void;
  peekKey: PeekKey | null;
  onRow: (key: PeekKey) => (event: MouseEvent) => void;
  onOpen: (key: PeekKey) => void;
  ownerOf: (accountId: string) => RowOwner | null;
  together: (accountId: string) => boolean;
  destinationOf: (accountId: string) => ReturnType<typeof accountDestination> | undefined;
  empty: boolean;
}) {
  const debt = side === 'debt';
  const kindKey = (key: string): PeekKey => (debt ? `debt-kind:${key}` : `asset-kind:${key}`);
  const itemKey = (id: string): PeekKey => (debt ? `debt:${id}` : `asset:${id}`);
  const boxes = treemapOf(data);
  const below = data.kinds.filter((kind) => kind.totalMinor !== null && kind.totalMinor < 0);
  let stripe = 0;
  // The figures' column is as wide as its widest figure (never a share of the box), so no figure is cut at any width.
  const widest = Math.max(
    formatMinor(data.totalMinor, currency).length,
    ...data.kinds.flatMap((kind) => [formatMinor(kind.totalMinor ?? 0, currency).length, ...kind.items.map((item) => formatMinor(item.minor ?? 0, currency).length + (item.approx ? 2 : 0))]),
  );
  const figureWidth = Math.ceil(widest * 7.6 + 22);
  return (
    <section className={cx(BOX, 'min-w-0 overflow-hidden')} aria-label={debt ? 'Debts' : 'Assets'} data-testid={debt ? 'debts-box' : 'assets-box'}>
      <h2 className={H2}>
        <Link to={debt ? '/net-worth/loans' : '/net-worth/assets'} className="hover:underline">
          {debt ? 'Debts' : 'Assets'}
        </Link>
        <span className={NOTE}>{debt ? 'all that is owed' : 'click a row to see it · ▼ folds'}</span>
      </h2>
      {boxes.length > 0 && <Treemap side={side} boxes={boxes} currency={currency} lookOf={lookOf} peekKey={peekKey} onPick={(key) => onRow(kindKey(key))} onOpen={(key) => onOpen(kindKey(key))} />}
      {below.length > 0 && (
        <p data-testid={`${side}-below-zero`} className="px-[14px] pb-[8px] text-[11.5px] text-[var(--ph-ink-3)]">
          {below.map((kind) => `${kind.label} is below zero at ${formatMinor(kind.totalMinor!, currency)}`).join(' · ')}, so the strip divides the rest.
        </p>
      )}
      {empty && (
        <p className="px-[14px] pb-[12px] text-[13px] text-[var(--ph-ink-3)]">
          Nothing yet. Accounts and cards are added on{' '}
          <Link to="/wallet" className="text-[var(--mac-accent)] hover:underline">
            Wallet
          </Link>
          ; a house, a car, gold or a fund with ＋ Add.
        </p>
      )}
      {data.kinds.length > 0 && (
        <table className="w-full table-fixed border-collapse text-[13px]" data-testid={debt ? 'debts-table' : 'assets-table'}>
          <thead>
            <tr className="text-left">
              <th className={cx(TH, 'pl-[14px]')}>{debt ? 'Debt' : 'Asset'}</th>
              <th className={cx(TH, 'text-right')} style={{ width: figureWidth }}>
                {debt ? 'Owed' : 'Value'}
              </th>
              <th className={cx(TH, 'w-[50px] pr-[14px] text-right')}>Share</th>
            </tr>
          </thead>
          {data.kinds.map((kind) => {
            const key = kindKey(kind.key);
            const open = !folded.has(key);
            const look = lookOf(side, kind.key);
            const selected = peekKey === key;
            const unratedKind = kind.totalMinor === null;
            return (
              <tbody key={kind.key}>
                <tr
                  data-networth-row
                  data-peek-row={key}
                  data-testid={debt ? `type-drawer-debts:${kind.key}` : `type-drawer-section-${kind.key}`}
                  aria-expanded={open}
                  aria-selected={selected}
                  onClick={onRow(key)}
                  onDoubleClick={() => onOpen(key)}
                  className={cx('cursor-default scroll-mt-[64px] scroll-mb-[16px]', selected ? 'bg-[var(--mac-accent)] text-white' : 'bg-[var(--ph-surface)] hover:bg-[var(--ph-fill)]')}
                >
                  <td className="py-[5px] pr-[8px] pl-[6px]">
                    <span className="flex min-w-0 items-center gap-[6px]">
                      <button
                        type="button"
                        aria-label={`${open ? 'Fold' : 'Unfold'} ${kind.label}`}
                        aria-expanded={open}
                        onClick={(event) => {
                          event.stopPropagation();
                          onFold(key);
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                        className={cx('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px]', selected ? 'text-white' : 'text-[var(--ph-ink-3)] hover:bg-[var(--ph-hair)]')}
                      >
                        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                      </button>
                      <RowIcon size={22} tint={tintOf(look.colour)}>
                        <look.Glyph size={12} aria-hidden />
                      </RowIcon>
                      <b className="min-w-0 font-semibold break-words">{kind.label}</b>
                    </span>
                  </td>
                  <td data-testid={`kind-total-${kind.key}`} className="px-[10px] py-[5px] text-right font-semibold whitespace-nowrap tabular-nums">
                    {unratedKind ? '—' : formatMinor(kind.totalMinor!, currency)}
                  </td>
                  <td className={cx('py-[5px] pr-[14px] text-right tabular-nums', !selected && 'text-[var(--ph-ink-3)]')}>{unratedKind || kind.totalMinor! <= 0 ? '' : `${kind.share}%`}</td>
                </tr>
                {open &&
                  kind.items.map((item) => {
                    const rowKey = itemKey(item.accountId);
                    const on = peekKey === rowKey;
                    const owner = ownerOf(item.accountId);
                    const Glyph = kindIcon(kind, item);
                    const to = destinationOf(item.accountId);
                    const figure =
                      item.minor === null && owner?.native ? formatMinor(owner.native.minor, owner.native.currency) : item.minor === null ? '—' : `${item.approx ? '≈ ' : ''}${formatMinor(item.minor, currency)}`;
                    const striped = stripe++ % 2 === 1;
                    const name = owner?.received ? `${owner.name}'s ${item.name}, ${figure}` : `${item.name}, ${figure}`;
                    return (
                      <tr
                        key={item.accountId}
                        data-networth-row
                        data-peek-row={rowKey}
                        data-testid={`sheet-row-${item.accountId}`}
                        aria-selected={on}
                        onClick={onRow(rowKey)}
                        onDoubleClick={() => onOpen(rowKey)}
                        className={cx('cursor-default scroll-mt-[64px] scroll-mb-[16px]', on ? 'bg-[var(--mac-accent)] text-white' : striped ? 'bg-[var(--mac-zebra)]' : undefined)}
                      >
                        <td className="py-[4px] pr-[8px] pl-[34px]">
                          <span className="flex min-w-0 items-center gap-[7px]">
                            <RowIcon size={20} ring={owner?.ring ?? undefined} mark={together(item.accountId)}>
                              <Glyph size={11} aria-hidden />
                            </RowIcon>
                            {to ? (
                              <Link
                                {...(to as { to: '/net-worth' })}
                                aria-label={name}
                                draggable={false}
                                onClick={onRow(rowKey)}
                                onDoubleClick={(event) => {
                                  event.stopPropagation();
                                  onOpen(rowKey);
                                }}
                                className="min-w-0 shrink truncate"
                              >
                                {item.name}
                              </Link>
                            ) : (
                              <span className="min-w-0 truncate">{item.name}</span>
                            )}
                            {item.kind.label !== kind.label && <span className={cx('hidden min-w-0 shrink-[100] truncate text-[11.5px] @min-[560px]:inline', on ? 'text-white/80' : 'text-[var(--ph-ink-3)]')}>{item.kind.label}</span>}
                          </span>
                        </td>
                        <td className="px-[10px] py-[4px] text-right whitespace-nowrap tabular-nums">{figure}</td>
                        <td />
                      </tr>
                    );
                  })}
              </tbody>
            );
          })}
          <tbody>
            <tr className="border-t border-[var(--ph-hair)] bg-[var(--ph-surface)]">
              <td className="py-[7px] pl-[14px] font-semibold">{totalLabel}</td>
              <td data-testid={totalTestId} className="px-[10px] py-[7px] text-right font-semibold whitespace-nowrap tabular-nums">
                {figureOf(data.totalMinor, data.kinds.flatMap((kind) => kind.items.map((item) => item.accountId)), new Set(data.kinds.flatMap((kind) => kind.items.filter((item) => item.minor === null).map((item) => item.accountId)))) === null
                  ? '—'
                  : formatMinor(data.totalMinor, currency)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
      {debt && data.kinds.some((kind) => kind.key === 'credit_card' || kind.items.some((item) => item.kind.key === 'credit_card')) && (
        <p data-testid="debts-card-note" className="border-t border-[var(--ph-hair)] px-[14px] py-[8px] text-[11.5px] text-[var(--ph-ink-3)]">
          Cards count everything owed here, instalments included (Wallet shows only what is due now).
        </p>
      )}
    </section>
  );
}

/**
 * The treemap strip: one box a kind, as wide as its share, tinted in its kind's colour. A box names its kind and share
 * where it has room — the largest its amount too — and a sliver keeps its colour and still opens its peek. Investments
 * is split inside, top to bottom, by holding type, each part's share being of Investments.
 */
function Treemap({
  side,
  boxes,
  currency,
  lookOf,
  peekKey,
  onPick,
  onOpen,
}: {
  side: 'asset' | 'debt';
  boxes: TreemapBox[];
  currency: string;
  lookOf: (side: 'asset' | 'debt', kind: string) => KindLook;
  peekKey: PeekKey | null;
  onPick: (key: string) => (event: MouseEvent) => void;
  onOpen: (key: string) => void;
}) {
  const [ref, width] = useBoxWidth<HTMLDivElement>();
  return (
    <div ref={ref} role="group" aria-label={side === 'debt' ? 'Debts by kind' : 'Assets by kind'} data-testid={`${side}-treemap`} className="relative mx-[14px] mb-[10px] overflow-hidden rounded-[8px]" style={{ height: TREEMAP_HEIGHT }}>
      {width > 0 &&
        boxes.map((box, index) => {
          const look = lookOf(side, box.key);
          const tint = tintOf(look.colour);
          const px = (box.width / 100) * width;
          const selected = peekKey === (side === 'debt' ? `debt-kind:${box.key}` : `asset-kind:${box.key}`);
          const words = px >= 56;
          const share = px >= 30;
          const amount = index === 0 && px >= 120;
          return (
            <button
              key={box.key}
              type="button"
              data-testid={`treemap-box-${box.key}`}
              data-peek-row={side === 'debt' ? `debt-kind:${box.key}` : `asset-kind:${box.key}`}
              aria-label={`${box.label}, ${formatMinor(box.minor, currency)}, ${box.share}%`}
              title={`${box.label} · ${box.share}% · ${formatMinor(box.minor, currency)}`}
              onClick={onPick(box.key)}
              onDoubleClick={() => onOpen(box.key)}
              className="absolute top-0 h-full overflow-hidden text-left"
              style={{
                left: `${box.left}%`,
                width: `${box.width}%`,
                background: tint.background,
                boxShadow: selected ? 'inset 0 0 0 2px var(--mac-accent)' : 'inset 0 0 0 1px var(--ph-surface)',
              }}
            >
              {box.parts.length > 0 &&
                box.parts.map((part, at) => (
                  <span
                    key={part.key}
                    aria-hidden
                    className="absolute right-0 left-0 overflow-hidden border-t border-[var(--ph-surface)] px-[6px] text-[10px] leading-[13px] whitespace-nowrap"
                    style={{ top: `${part.top}%`, height: `${part.height}%`, background: `color-mix(in srgb, ${look.colour} ${PART_SHADES[at] ?? 5}%, transparent)`, color: 'var(--ph-ink-2)' }}
                  >
                    {(part.height / 100) * TREEMAP_HEIGHT >= 13 && px >= 64 && (
                      <span className="absolute bottom-[2px] left-[6px] right-[4px] truncate">
                        {part.label} {part.share}%
                      </span>
                    )}
                  </span>
                ))}
              {share && (
                <span className="absolute top-0 right-0 left-0 block px-[7px] pt-[6px]" style={{ color: tint.foreground }}>
                  <span className="block truncate text-[12px] leading-[15px] font-semibold">
                    {words ? box.label : `${box.share}%`}
                    {words && amount ? ` · ${box.share}%` : ''}
                  </span>
                  {words && !amount && <span className="block text-[10.5px] leading-[14px] text-[var(--ph-ink-3)] tabular-nums">{box.share}%</span>}
                  {amount && <span className="block truncate text-[11px] leading-[14px] text-[var(--ph-ink-2)] tabular-nums">{compactMoney(box.minor, currency)}</span>}
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}
