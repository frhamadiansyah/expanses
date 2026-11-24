import { balanceSheet, formatMinor, isoDate, lastNMonths, monthOf, portfolioSummary, type SheetLiability, type SheetRow, type SheetSectionKey } from '@expanses/core';
import { type AccountSubtype, type LiabilityKind, pocketParentIds } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { Banknote, ChevronDown, ChevronRight, CreditCard, Landmark, Shield, TrendingUp } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
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
import { type DeskChartMonth, DeskNetWorthChart, useBoxWidth } from './DeskNetWorthChart';
import { ratioDisplay } from './health-cards';
import { figureOf, jointSeries, ownerRing, receivedPocketAccounts, sheetOwnerOf } from './joint-rows';
import { type KindLook, NetWorthPeek, type NetWorthPeekSubject, tintOf } from './NetWorthPeek';
import { assetSide, debtsAgainstAssets, debtSide, type DeskKind, type DeskSide, monthChange, type PeekKey, peekOrder, sheetLine, treemapOf, type TreemapBox, yearChange } from './networth-desk-model';
import { foldPockets } from './overview-rows';
import { memberName, useAssetProfiles, useAssetValues, useJointSheet, useNetWorthSeries, useOwnedTogether, useOwnerRings, useSheet } from './queries';
import { debtKind, rowKindOf, type RowKind } from './sheet-drawers';
import { spanSlice } from './span';
import { ASSET_STACK_KEYS, DEBT_STACK_KEYS, STACK_KEYS } from './stack-keys';
import { useHealthInputs, useHealthRatios } from './use-health';
import { CARD, CARD_HEAD, CARD_NOTE, DeskBar, DeskTitle, type IconColour, PILL, PILL_BLUE, Seg, StatTile, Tag, TileRow, type Tone, Track, tileMoney } from '../../ui/desk';
import { macV2 } from '../../ui/mac-detail';
import { PEEK_ROOM } from '../../ui/native/panel-frame';

const CHART_HEIGHT = 176;
const TREEMAP_HEIGHT = 150;

const H2 = CARD_HEAD;
/** A group's name over its rows (v1): small capitals in grey, its total at the right. */
const GROUP_HEAD = 'text-[12px] font-bold tracking-[0.06em] uppercase';

/** The chart's two drawings and two ranges, as the title bar's switches name them. */
type ChartView = 'line' | 'bars';
type DeskSpan = '6m' | '1y' | 'all';
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
  const [span, setSpanState] = useState<DeskSpan>(() => {
    const kept = readLocal(SPAN_KEY);
    return kept === 'all' || kept === '6m' ? kept : '1y';
  });
  // v1 draws the line only; Line / Bars is v2's.
  const chartView: ChartView = macV2 ? view : 'line';
  const setSpan = (next: DeskSpan) => {
    setSpanState(next);
    writeLocal(SPAN_KEY, next);
  };

  // ── The sheet: the phone's own reading, the household's with one tax ID ───────────────────────────────────────────
  // Thirteen month-ends for a year (or six months): those drawn, and the one before them that the chip's change is read against.
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
  const shown = span === 'all' ? spanSlice(points, 'all') : points.slice(span === '6m' ? -6 : -12);
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
  const sinceLast = ready && sheetMissing.length === 0 ? monthChange(points, monthOf(today), sheet.netWorthMinor) : null;
  const debtShare = ready && sheetMissing.length === 0 ? debtsAgainstAssets(debts.totalMinor, assets.totalMinor) : null;
  // A side's total is a figure only while every one of its rows has one (a partner's item with no rate leaves it blank).
  const sideFigure = (side: DeskSide) =>
    figureOf(side.totalMinor, side.kinds.flatMap((kind) => kind.items.map((item) => item.accountId)), new Set(side.kinds.flatMap((kind) => kind.items.filter((item) => item.minor === null).map((item) => item.accountId))));

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

  const totalsKnown = holding || !ready ? null : sheetMissing.length > 0 ? null : { assets: sideFigure(assets), debts: sideFigure(debts) };
  const sideProps = { currency: base, lookOf, folded, onFold: toggleFold, peekKey, onRow, onOpen: openPage, ownerOf, together, destinationOf };

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="networth-page" data-desk="true" {...doubleClick}>
      <DeskBar crumb="Net worth" barRef={bar}>
        {macV2 && (
          <Seg
            label="Chart view"
            value={view}
            onChange={setView}
            options={[
              { value: 'line', label: 'Line' },
              { value: 'bars', label: 'Bars' },
            ]}
          />
        )}
        <Seg
          label="Range"
          value={span}
          onChange={setSpan}
          options={[
            { value: '6m', label: '6 months' },
            { value: '1y', label: '1 year' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Link to="/net-worth/prices" className={PILL}>
          Prices
        </Link>
        {canTrade ? (
          <Link to="/transactions/new" search={{ mode: 'trade' }} className={PILL}>
            Trade
          </Link>
        ) : (
          <button type="button" disabled className={PILL} title="Nothing held to trade yet">
            Trade
          </button>
        )}
        <Link to="/tax-report" className={PILL}>
          Tax report
        </Link>
        <AddMenu />
      </DeskBar>
      <DeskNotices />
      <DeskTitle title="Net worth" line={ready && !sheetBlocked ? sheetLine(today, assets, debts) : undefined} />

      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peeking && PEEK_ROOM)}>
        <ErrorBox error={series.error ?? sheetInputs.error ?? household.error ?? health.error} />

        {/* Total: the figure, its change since last month, the two sides, and the months drawn beside them. */}
        <section className={cx(CARD, 'grid grid-cols-1 gap-x-[24px] @min-[820px]:grid-cols-[minmax(330px,1fr)_minmax(0,1.75fr)]')} aria-label="Net worth" data-testid="networth-box">
          <div className="min-w-0 pb-[18px]">
            <h2 className={H2}>
              <TrendingUp size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />
              Total
            </h2>
            <div data-testid="net-worth" className="px-[20px]">
              {holding || !ready ? (
                <span className="text-[42px] leading-[50px] font-extrabold text-[var(--mk-ink-3)]">—</span>
              ) : sheetMissing.length > 0 ? (
                <p className="py-2 text-[13px] text-[var(--mk-t-orange)]">No {sheetMissing.join(', ')} rate yet, so net worth cannot be added up.</p>
              ) : (
                <>
                  <p data-testid="net-worth-figure" className="text-[clamp(30px,2.9vw,42px)] leading-[50px] font-extrabold tracking-[-0.6px] whitespace-nowrap text-[var(--mk-ink)] tabular-nums">
                    {formatMinor(sheet.netWorthMinor, base)}
                  </p>
                  <div className="mt-[8px] flex flex-col items-start gap-[6px]">
                    {sinceLast && (
                      <Tag tone={sinceLast.changeMinor < 0 ? 'red' : 'green'} testId="net-worth-month-change" className="px-[10px] py-[2px] text-[12.5px]">
                        {sinceLast.percent !== null
                          ? `${sinceLast.percent > 0 ? '+' : ''}${sinceLast.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
                          : `${sinceLast.changeMinor > 0 ? '+' : ''}${tileMoney(sinceLast.changeMinor, base)}`}{' '}
                        since {sinceLast.since}
                      </Tag>
                    )}
                    {macV2 && change && (
                      <Tag tone={change.changeMinor < 0 ? 'red' : 'green'} testId="net-worth-change" className="px-[10px] py-[2px] text-[12.5px]">
                        {change.changeMinor > 0 ? '+' : ''}
                        {formatMinor(change.changeMinor, base)}
                        {change.percent !== null && ` · ${change.percent > 0 ? '+' : ''}${change.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`} in 12 months
                      </Tag>
                    )}
                  </div>
                </>
              )}
            </div>
            {totalsKnown && (
              <div className="mt-[16px] space-y-[8px] px-[20px] text-[14px]">
                <SideLine colour="var(--mk-c-green)" label="Assets" minor={totalsKnown.assets} currency={base} testId="sheet-total-assets" />
                <SideLine colour="var(--mk-c-red)" label="Debts" minor={totalsKnown.debts} currency={base} testId="sheet-total-liabilities" />
              </div>
            )}
          </div>
          <div className="min-w-0 px-[20px] pt-[18px] pb-[14px] @min-[820px]:pl-0">
            <DeskNetWorthChart months={chartMonths} view={chartView} currency={base} keys={STACK_KEYS} height={CHART_HEIGHT} />
            {sheetMissing.length === 0 && unchartable.length > 0 && (
              <p data-testid="chart-missing" className="pt-[6px] text-[12px] text-[var(--mk-t-orange)]">
                No {unchartable.join(', ')} rate for an earlier month, so the line breaks there.
              </p>
            )}
          </div>
        </section>

        {macV2 && <HealthTiles missing={health.totals === null && health.missing.length > 0 ? health.missing : null} ratios={ratios} />}

        {ready && sheetBlocked ? (
          <section className={CARD}>
            <p data-testid="balance-sheet-missing" className="px-[20px] py-[14px] text-[13px] text-[var(--mk-t-orange)]">
              No {sheetMissing.join(', ')} rate yet, so the balance sheet cannot be added up.
            </p>
          </section>
        ) : (
          ready && (
            <>
              {sheetMissing.length > 0 && (
                <section className={CARD}>
                  <p data-testid="balance-sheet-missing" className="px-[20px] py-[14px] text-[13px] text-[var(--mk-t-orange)]">
                    No {sheetMissing.join(', ')} rate yet, so the household's totals cannot be added up. Those items show in their own currency.
                  </p>
                </section>
              )}
              <div className="grid grid-cols-1 items-start gap-[16px] @min-[860px]:grid-cols-2">
                <SideCard
                  side="asset"
                  data={assets}
                  total={totalsKnown?.assets ?? null}
                  kindIcon={(kind, item) => assetKindTile(kind.key, item.kind.key)}
                  empty={nothing}
                  {...sideProps}
                />
                <div className="flex min-w-0 flex-col gap-[16px]">
                  <SideCard side="debt" data={debts} total={totalsKnown?.debts ?? null} kindIcon={(kind) => debtKindTile(kind.key)} empty={false} debtShare={debtShare} {...sideProps} />
                  {macV2 && investKind && investKind.totalMinor !== null && (
                    <section className={CARD} aria-label="Investments" data-testid="investments-box">
                      <h2 className={H2}>
                        <Landmark size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />
                        Investments
                        <span className={CARD_NOTE}>{investKind.share}% of assets</span>
                      </h2>
                      <div className="pb-[6px]">
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
                        <div className="mx-[20px] flex flex-wrap items-center gap-x-[6px] border-t border-[var(--mk-line)] py-[9px] text-[13px] font-semibold text-[var(--mk-blue)]">
                          <Link to="/net-worth/assets" className="hover:underline">
                            Holdings
                          </Link>
                          <span className="text-[var(--mk-ink-3)]">·</span>
                          <Link to="/net-worth/investments/trades" className="hover:underline">
                            Trades
                          </Link>
                          <span className="text-[var(--mk-ink-3)]">·</span>
                          <Link to="/net-worth/investments/dividends" className="hover:underline">
                            Dividends
                          </Link>
                          <ChevronRight size={14} aria-hidden />
                        </div>
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

/** One side's line under the total: its dot, its name, its figure (a dash while a row has no rate). */
function SideLine({ colour, label, minor, currency, testId }: { colour: string; label: string; minor: number | null; currency: string; testId: string }) {
  return (
    <p className="flex items-center gap-[9px]">
      <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: colour }} />
      <span className="min-w-0 flex-1 truncate text-[var(--mk-ink-2)]">{label}</span>
      <span data-testid={testId} className="shrink-0 font-bold whitespace-nowrap text-[var(--mk-ink)] tabular-nums">
        {minor === null ? '—' : formatMinor(minor, currency)}
      </span>
    </p>
  );
}

const HEALTH_LOOK: Record<(typeof HEALTH_KEYS)[number], { icon: typeof Shield; colour: IconColour }> = {
  emergency_fund: { icon: Shield, colour: 'green' },
  savings_ratio: { icon: TrendingUp, colour: 'blue' },
  debt_payments: { icon: CreditCard, colour: 'orange' },
  liquidity: { icon: Banknote, colour: 'teal' },
};
const STATUS_TONE: Record<string, Tone> = { good: 'green', watch: 'orange', act: 'red', unknown: 'grey' };

/** v2's Financial health: the four ratios as tiles, each with its status and its guide, All ratios for the rest. */
function HealthTiles({ missing, ratios }: { missing: readonly string[] | null; ratios: ReturnType<typeof useHealthRatios> }) {
  return (
    <section aria-label="Financial health" data-testid="health-box">
      <h2 className="flex items-center gap-[9px] px-[4px] pb-[10px] text-[15.5px] font-bold text-[var(--mk-ink-2)]">
        <Shield size={17} strokeWidth={1.9} aria-hidden />
        <Link to="/net-worth/health" className="hover:underline">
          Financial health
        </Link>
        <span className="ml-auto text-[12.5px] font-semibold">last 12 months</span>
        <Link to="/net-worth/health" className="text-[12.5px] font-semibold text-[var(--mk-blue)] hover:underline">
          All ratios ›
        </Link>
      </h2>
      {missing ? (
        <p data-testid="ratios-missing" className={cx(CARD, 'px-[20px] py-[14px] text-[13px] text-[var(--mk-t-orange)]')}>
          No {missing.join(', ')} rate yet, so the ratios cannot be worked out.
        </p>
      ) : (
        <TileRow>
          {HEALTH_KEYS.flatMap((key) => {
            const ratio = ratios.find((each) => each.key === key);
            if (!ratio) return [];
            const display = ratioDisplay(ratio);
            return [
              <StatTile
                key={key}
                testId={`health-${key}`}
                to="/net-worth/health"
                icon={HEALTH_LOOK[key].icon}
                colour={HEALTH_LOOK[key].colour}
                badge={<Tag tone={STATUS_TONE[ratio.status] ?? 'grey'}>{display.statusLabel}</Tag>}
                value={display.value}
                label={`${ratio.name} · guide ${ratio.benchmarkText}`}
              />,
            ];
          })}
        </TileRow>
      )}
    </section>
  );
}

/**
 * ＋ Add asset (v1's words): the same menu as before — an asset (the add-asset picker) or a debt (the add-debt picker) —
 * so a debt is still one click away from the page that lists it.
 */
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
  const item = 'flex h-[30px] items-center rounded-[8px] px-[10px] text-[13.5px] whitespace-nowrap text-[var(--mk-ink)] hover:bg-[var(--mk-blue)] hover:text-white';
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)} className={PILL_BLUE}>
        <span aria-hidden>＋</span>Add asset
      </button>
      {open && (
        <div role="menu" aria-label="Add" className="absolute top-full right-0 z-30 mt-[6px] min-w-[170px] rounded-[12px] bg-[var(--mk-page)] p-[6px] shadow-[0_8px_28px_rgb(0_0_0/0.18)] ring-1 ring-[var(--mk-line)]">
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
function Figure({ label, testId, tone, children }: { label: string; testId: string; tone?: 'up' | 'down'; children: ReactNode }) {
  return (
    <div className="mx-[20px] flex items-center gap-3 border-t border-[var(--mk-line)] py-[8px] text-[13.5px] text-[var(--mk-ink)]">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        data-testid={testId}
        className={cx('shrink-0 font-semibold whitespace-nowrap tabular-nums', tone === 'up' && 'text-[var(--mk-t-green)]', tone === 'down' && 'text-[var(--mk-t-red)]')}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * A side of the sheet, v1's card: its total in the heading, then each kind as a group — its name in grey small capitals
 * with its total, folding with ▾ — and its rows under it, a name and a figure. A click on a group or a row opens its peek;
 * a double-click its page. The Debts card ends with Debts against assets. v2 adds the treemap strip over it (one box a
 * kind, Investments split inside by holding type), each kind's share and each row's kind.
 */
function SideCard({
  side,
  data,
  total,
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
  debtShare,
}: {
  side: 'asset' | 'debt';
  data: DeskSide;
  /** The side's total, or null while one of its rows has no rate. */
  total: number | null;
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
  debtShare?: number | null;
}) {
  const debt = side === 'debt';
  const kindKey = (key: string): PeekKey => (debt ? `debt-kind:${key}` : `asset-kind:${key}`);
  const itemKey = (id: string): PeekKey => (debt ? `debt:${id}` : `asset:${id}`);
  const boxes = macV2 ? treemapOf(data) : [];
  const below = data.kinds.filter((kind) => kind.totalMinor !== null && kind.totalMinor < 0);
  const Icon = debt ? CreditCard : Landmark;
  return (
    <section className={cx(CARD, 'min-w-0 overflow-hidden pb-[12px]')} aria-label={debt ? 'Debts' : 'Assets'} data-testid={debt ? 'debts-box' : 'assets-box'}>
      <h2 className={H2}>
        <Icon size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />
        <Link to={debt ? '/net-worth/loans' : '/net-worth/assets'} className="hover:underline">
          {debt ? 'Debts' : 'Assets'}
        </Link>
        <span className="ml-auto flex min-w-0 items-baseline gap-[10px]">
          {macV2 && <span className="truncate text-[12.5px] font-semibold">{debt ? 'all that is owed' : 'click a row to see it · ▼ folds'}</span>}
          {total !== null && data.kinds.length > 0 && (
            <span data-testid={`${side}-card-total`} className="shrink-0 text-[14px] font-bold text-[var(--mk-ink)] tabular-nums">
              {tileMoney(total, currency)}
            </span>
          )}
        </span>
      </h2>
      {boxes.length > 0 && <Treemap side={side} boxes={boxes} currency={currency} lookOf={lookOf} peekKey={peekKey} onPick={(key) => onRow(kindKey(key))} onOpen={(key) => onOpen(kindKey(key))} />}
      {macV2 && below.length > 0 && (
        <p data-testid={`${side}-below-zero`} className="px-[20px] pb-[8px] text-[12px] text-[var(--mk-ink-2)]">
          {below.map((kind) => `${kind.label} is below zero at ${formatMinor(kind.totalMinor!, currency)}`).join(' · ')}, so the strip divides the rest.
        </p>
      )}
      {empty && (
        <p className="px-[20px] pb-[8px] text-[13px] text-[var(--mk-ink-2)]">
          Nothing yet. Accounts and cards are added on{' '}
          <Link to="/wallet" className="text-[var(--mk-blue)] hover:underline">
            Wallet
          </Link>
          ; a house, a car, gold or a fund with ＋ Add asset.
        </p>
      )}
      {data.kinds.length > 0 && (
        <div className="px-[12px]" data-testid={debt ? 'debts-table' : 'assets-table'}>
          {data.kinds.map((kind) => {
            const key = kindKey(kind.key);
            const open = !folded.has(key);
            const selected = peekKey === key;
            const unratedKind = kind.totalMinor === null;
            return (
              <div key={kind.key} role="group" aria-label={kind.label} className="pt-[8px]">
                <div
                  data-networth-row
                  data-peek-row={key}
                  data-testid={debt ? `type-drawer-debts:${kind.key}` : `type-drawer-section-${kind.key}`}
                  aria-expanded={open}
                  aria-selected={selected}
                  onClick={onRow(key)}
                  onDoubleClick={() => onOpen(key)}
                  className={cx(
                    'flex cursor-default scroll-mt-[64px] scroll-mb-[16px] items-center gap-[6px] rounded-[9px] py-[5px] pr-[8px] pl-[2px]',
                    selected ? 'bg-[var(--mk-blue)] text-white' : 'text-[var(--mk-ink-3)] hover:bg-[var(--mk-pill)]',
                  )}
                >
                  <button
                    type="button"
                    aria-label={`${open ? 'Fold' : 'Unfold'} ${kind.label}`}
                    aria-expanded={open}
                    onClick={(event) => {
                      event.stopPropagation();
                      onFold(key);
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    className={cx('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]', selected ? 'text-white' : 'text-[var(--mk-ink-3)] hover:bg-[var(--mk-pill-hover)]')}
                  >
                    {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                  </button>
                  <span className={cx(GROUP_HEAD, 'min-w-0 truncate')}>{kind.label}</span>
                  {macV2 && !unratedKind && kind.totalMinor! > 0 && (
                    <Tag tone="grey">
                      {kind.share}%
                    </Tag>
                  )}
                  <span data-testid={`kind-total-${kind.key}`} className={cx('ml-auto shrink-0 text-[13px] font-bold whitespace-nowrap tabular-nums', !selected && 'text-[var(--mk-ink-3)]')}>
                    {unratedKind ? '—' : formatMinor(kind.totalMinor!, currency)}
                  </span>
                </div>
                {open &&
                  kind.items.map((item) => {
                    const rowKey = itemKey(item.accountId);
                    const on = peekKey === rowKey;
                    const owner = ownerOf(item.accountId);
                    const Glyph = kindIcon(kind, item);
                    const to = destinationOf(item.accountId);
                    const figure =
                      item.minor === null && owner?.native ? formatMinor(owner.native.minor, owner.native.currency) : item.minor === null ? '—' : `${item.approx ? '≈ ' : ''}${formatMinor(item.minor, currency)}`;
                    const name = owner?.received ? `${owner.name}'s ${item.name}, ${figure}` : `${item.name}, ${figure}`;
                    return (
                      <div
                        key={item.accountId}
                        data-networth-row
                        data-peek-row={rowKey}
                        data-testid={`sheet-row-${item.accountId}`}
                        aria-selected={on}
                        onClick={onRow(rowKey)}
                        onDoubleClick={() => onOpen(rowKey)}
                        className={cx(
                          'flex cursor-default scroll-mt-[64px] scroll-mb-[16px] items-center gap-[9px] rounded-[9px] py-[5px] pr-[8px] pl-[8px] text-[14px]',
                          on ? 'bg-[var(--mk-blue)] text-white' : 'text-[var(--mk-ink)] hover:bg-[var(--mk-pill)]',
                        )}
                      >
                        <RowIcon size={20} ring={owner?.ring ?? undefined} mark={together(item.accountId)}>
                          <Glyph size={11} aria-hidden />
                        </RowIcon>
                        <span className="flex min-w-0 flex-1 items-baseline gap-[6px]">
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
                          {macV2 && item.kind.label !== kind.label && (
                            <span className={cx('hidden min-w-0 shrink-[100] truncate text-[12px] @min-[560px]:inline', on ? 'text-white/80' : 'text-[var(--mk-ink-2)]')}>{item.kind.label}</span>
                          )}
                        </span>
                        <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums">{figure}</span>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
      {debt && debtShare !== null && debtShare !== undefined && data.kinds.length > 0 && (
        <div className="mx-[20px] mt-[12px]" data-testid="debts-against-assets">
          <p className={cx(GROUP_HEAD, 'flex items-baseline justify-between text-[var(--mk-ink-3)]')}>
            Debts against assets
            <span className="tracking-normal tabular-nums">{debtShare}%</span>
          </p>
          <Track share={debtShare / 100} colour="var(--mk-c-red)" className="mt-[8px]" />
        </div>
      )}
      {macV2 && debt && data.kinds.some((kind) => kind.key === 'credit_card' || kind.items.some((item) => item.kind.key === 'credit_card')) && (
        <p data-testid="debts-card-note" className="mx-[20px] mt-[12px] text-[12px] text-[var(--mk-ink-2)]">
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
    <div ref={ref} role="group" aria-label={side === 'debt' ? 'Debts by kind' : 'Assets by kind'} data-testid={`${side}-treemap`} className="relative mx-[20px] mb-[6px] overflow-hidden rounded-[12px]" style={{ height: TREEMAP_HEIGHT }}>
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
                boxShadow: selected ? 'inset 0 0 0 2px var(--mk-blue)' : 'inset 0 0 0 1.5px var(--mk-card)',
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
