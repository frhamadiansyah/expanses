import { balanceSheet, formatMinor, isoDate, lastNMonths, monthOf, type SheetGroup, type SheetRow, type SheetSectionKey } from '@expanses/core';
import type { AccountSubtype, LiabilityKind } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { BellRing, ChartColumn, ChartLine, Gauge } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox, Money, cx } from '../../ui';
import { type CornerAction, Drawer, Hero, InsetGroup, InsetRow, LargeTitle, Panel, PanelHeader, PHONE_WIDTH, SCREEN, SegmentedControl, useDrawers } from '../../ui/native';
import { useAttention } from './attention';
import type { BarMonth } from './bar-chart';
import { NetWorthBars } from './NetWorthBars';
import { NetWorthChart } from './NetWorthChart';
import { debtKind, rowKindOf, type RowKind, sheetDrawers } from './sheet-drawers';
import { ASSET_STACK_KEYS, DEBT_STACK_KEYS, STACK_KEYS } from './stack-keys';
import { RANGES, rangeChange, SPAN_MONTHS, type Span, spanSlice } from './span';
import { useNetWorthSeries, useSheet } from './queries';
import { isMoneyAccount, useAccounts } from '../../lib/queries';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });

/**
 * A month as the chart's reading names it: the month and the year, because the reading is asked for one month at a time
 * and "Apr" on its own could be any of five.
 */
const monthLabel = (month: string) => `${MONTH_LABEL(month)} ${month.slice(0, 4)}`;

/**
 * The months a range covers, told once: "Apr – Sept 2026", and the year at both ends when they are not the same year,
 * because "Aug – Sept 2026" is a sentence about two months that does not say which August.
 */
const rangeLabel = (from: string, to: string) => {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${MONTH_LABEL(from)}${sameYear ? '' : ` ${from.slice(0, 4)}`} – ${MONTH_LABEL(to)} ${to.slice(0, 4)}`;
};

/**
 * The two ways the year is drawn: the figure as a line, or as the stacks it is made of.
 *
 * The line is what the page opens on, because it is the answer to the question the page asks — where the figure is
 * going — and the stacks answer the next one, what it is made of. Both are remembered, so a reader who reads the parts
 * every time opens on the parts.
 */
type ChartView = 'line' | 'bars';
const CHART_VIEWS = [
  { key: 'line', label: 'Line', Icon: ChartLine },
  { key: 'bars', label: 'Bars', Icon: ChartColumn },
] as const satisfies readonly { key: ChartView; label: string; Icon: typeof ChartLine }[];
const CHART_VIEW_KEY = 'expanses.networth.chart';

/**
 * How tall the chart's box is, whichever drawing is in it.
 *
 * One height for both, because the box is a place on the page: a switch that made the balance sheet jump up and down
 * would be a switch that moved everything below it to save a drawing some room. The key under the stacks is drawn
 * inside the drawing, so the bars are shorter by exactly what it took and the two views come out as tall as each
 * other at every width.
 */
const CHART_HEIGHT = 230;

/** Which drawing was chosen last, on this browser. A convenience only: losing it opens the line. */
function rememberedChartView(): ChartView {
  try {
    return localStorage.getItem(CHART_VIEW_KEY) === 'bars' ? 'bars' : 'line';
  } catch {
    return 'line';
  }
}

/**
 * One side of the balance sheet: a heading naming the side, then the sections of the statement inside one box.
 *
 * The heading carries no figure. The side's total is stated twice already — once in the pair above the sheet, where the
 * two sides are read together, and once in each section's own drawer — and a third telling of it in the heading was the
 * one line on the page that said nothing the two others did not.
 *
 * The sections are drawers of their own — Cash & equivalents, Receivables, Investments and the rest — and the kinds a
 * section holds are drawers inside it, so the sheet folds twice: a side reads as its sections, a section reads as its
 * kinds, and only the names themselves are a tap away. Six boxes stacked down the page said what is owned six times
 * over; one box says it once, and the sections are read as what they are, parts of one figure.
 *
 * A side with one section — what is owed is one group of debts — would gain a level that says nothing, so it keeps its
 * kind drawers alone and reads exactly as it always did.
 *
 * Every section folds its rows into a drawer a kind — current accounts with current accounts, listed shares with listed
 * shares — because a list of everything you own is as long as the accounts you have opened, and the answer to what you
 * have is a handful of kinds. A section of one kind folds all the same: "Intangible and other" holding nothing but gold
 * must still say that what is inside it is gold, or the one section that cannot name its kind is the one whose rows are
 * hardest to read at a glance.
 *
 * No share bar: what a side is *made of* is the sub page's subject, where the list it divides is — the bars sit at the
 * top of Assets and Liabilities, and the side here is read for its own figure and its sections.
 *
 * The two columns stay two columns on a desktop.
 */
function SheetColumn({
  title,
  groups,
  currency,
  kindOf,
  oneGroupOnly = false,
  nested = false,
  open,
  onToggle,
}: {
  title: string;
  groups: SheetGroup[];
  currency: string;
  /** What kind each row is, which is what the drawers fold by. Read off the row, so a debt is read as a mortgage. */
  kindOf: (groupKey: string, row: SheetRow) => RowKind;
  /**
   * Whether a group's own header is left out. True on the liabilities side, which holds one group: the column is
   * already headed by that side's name and total, and a second line saying the same thing swallowed a row of the page.
   */
  oneGroupOnly?: boolean;
  /**
   * Whether the sections are drawers of their own. True for what is owned, which is read in the statement's six
   * sections: the box holds a drawer a section, and a section holds a drawer a kind. False for what is owed, which is
   * one group of debts — a section drawer over a single section would be a tap that says nothing.
   */
  nested?: boolean;
  /** The drawers that are open, by `group:kind`. Shut to begin with. */
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    // `min-w-0`: a column in a grid is as wide as its widest row unless it is told it may be narrower, and a row whose
    // title truncates is still as wide as the whole title — which is what pushed this page sideways.
    <div className="min-w-0">
      <PanelHeader title={title} />
      {nested && groups.length > 0 ? (
        /* The side's sections, each a drawer, all of them in one box — and each section's kinds folded inside it. */
        <InsetGroup wide>
          {groups.flatMap((group, index) => {
            const key = `section:${group.key}`;
            const shown = open.has(key);
            const held = group.rows.length;
            return [
              <Drawer
                key={key}
                label={group.label}
                /* What is inside, counted — the accounts the section is made of. Which *kinds* they are is what
                   opening it says, so that is not repeated in the count. */
                under={`${held} ${held === 1 ? 'account' : 'accounts'}`}
                figure={<Money minor={group.totalMinor} currency={currency} />}
                open={shown}
                /* A hairline above every section but the box's first: with the section headers inside the box, the
                   line is what tells one section from the next. */
                separator={index > 0}
                testId={`type-drawer-section-${group.key}`}
                onToggle={() => onToggle(key)}
              />,
              /* Marked by its own key, so a spec can say which section a row was drawn in. */
              ...(shown ? [<div key={`${key}:rows`} data-testid={`sheet-section-${group.key}`}>{fold(group, kindOf, open, onToggle, currency)}</div>] : []),
            ];
          })}
        </InsetGroup>
      ) : (
        groups.map((group) =>
          group.rows.length === 0 ? (
            !oneGroupOnly && <PanelHeader key={group.key} title={group.label} trailing={<Money minor={group.totalMinor} currency={currency} />} />
          ) : (
            /* Marked by its own key, so a spec can say which section a row was drawn in. */
            <div key={group.key} data-testid={`sheet-section-${group.key}`}>
              <InsetGroup wide header={oneGroupOnly ? undefined : group.label} trailing={oneGroupOnly ? undefined : <Money minor={group.totalMinor} currency={currency} />}>
                {fold(group, kindOf, open, onToggle, currency)}
              </InsetGroup>
            </div>
          ),
        )
      )}
    </div>
  );
}

/** One account's line in the sheet: its name, and what it is worth or what it owes. */
function sheetLine(row: SheetRow, currency: string) {
  return <InsetRow key={row.accountId} title={row.name} subtitle={row.note ?? undefined} value={<Money minor={row.amountMinor} currency={currency} />} valueTone="ink" chevron={false} />;
}

/** A group's rows, folded by kind: every section says which kinds it holds, even where it holds only one. */
function fold(group: SheetGroup, kindOf: (groupKey: string, row: SheetRow) => RowKind, open: ReadonlySet<string>, onToggle: (key: string) => void, currency: string) {
  const drawers = sheetDrawers(group.rows, (row) => kindOf(group.key, row));
  return drawers.flatMap((drawer, index) => {
    const key = `${group.key}:${drawer.key}`;
    const shown = open.has(key);
    return [
      <Drawer
        key={key}
        label={drawer.label}
        /* A count, because the drawer is what says how many accounts a kind is made of. */
        under={`${drawer.rows.length} ${drawer.rows.length === 1 ? 'account' : 'accounts'}`}
        figure={<Money minor={drawer.totalMinor} currency={currency} />}
        open={shown}
        separator={index > 0}
        testId={`type-drawer-${key}`}
        onToggle={() => onToggle(key)}
      />,
      ...(shown ? drawer.rows.map((row) => sheetLine(row, currency)) : []),
    ];
  });
}

export function OverviewPage() {
  const { ws } = useApp();
  const today = isoDate();
  /*
   * The range is chosen first because it decides how much is read: a snapshot a month, so six months are six of them
   * and five years are sixty. The page opens on the shortest and cheapest, and each range that has been read once is
   * kept, so going back to it is instant.
   */
  const [span, setSpan] = useState<Span>('6m');
  /*
   * Which drawing the year is read in. Kept on the device rather than in the workspace, exactly as the transactions
   * list's own view is: it is a way of looking at the money and not a fact about it.
   */
  const [view, setView] = useState<ChartView>(rememberedChartView);
  const chooseView = (next: ChartView) => {
    setView(next);
    try {
      localStorage.setItem(CHART_VIEW_KEY, next);
    } catch {
      // Private windows can refuse storage; the view still switches for this visit.
    }
  };
  const months = lastNMonths(monthOf(today), SPAN_MONTHS[span]);
  const series = useNetWorthSeries(months);
  const sheetInputs = useSheet();
  const waiting = useAttention(today);

  const points = series.data ?? [];
  // The range the line is drawn over, out of the same snapshots the figure is: what is drawn is what is summed.
  const shown = spanSlice(points, span);
  const from = shown[0];
  const to = shown[shown.length - 1];
  const covered = from && to ? rangeLabel(from.month, to.month) : undefined;
  // The hero is today's figure, so only today's missing rates hide it; an earlier month's hides that month's point.
  const sheetMissing = sheetInputs.data?.missing ?? [];
  const unchartable = [...new Set(points.flatMap((point) => point.missing))].sort();
  const sheet = balanceSheet(sheetInputs.data?.assets ?? [], sheetInputs.data?.liabilities ?? []);

  const waitingCount = waiting.items.length + waiting.warnings.length;
  /*
   * The corners, in the order the page is about them: what is waiting, then how the figure is doing, then the
   * journeys. Three of them on a phone, which is one more than the kit's own two — and the two of them are the two
   * questions the figure raises, so the third is a `…` rather than a fourth thing.
   */
  const actions: CornerAction[] = [
    /*
     * It was the right-hand column of this page, which on a phone is under the balance sheet: a thing to do, below the
     * answer to what you have. The dot is what the move keeps — a corner that opens a screen of warnings must not look
     * like a corner that opens nothing — and the name carries the count for a screen reader.
     */
    {
      key: 'attention',
      label: waitingCount > 0 ? `Needs attention, ${waitingCount} waiting` : 'Needs attention',
      glyph: (
        <span className="relative flex items-center justify-center">
          <BellRing size={18} aria-hidden />
          {waitingCount > 0 && <span aria-hidden className="absolute top-[-2px] right-[-2px] h-[7px] w-[7px] rounded-full bg-[var(--ph-alarm)]" />}
        </span>
      ),
      to: '/net-worth/attention',
    },
    /*
     * The ratios are a screen of their own too: a question of how you are doing rather than what you have, and the
     * period they are read over belongs to that screen with them.
     */
    { key: 'health', label: 'Financial health', glyph: <Gauge size={18} aria-hidden />, to: '/net-worth/health' },
    /*
     * The three sections this page used to tab between are sub-pages now, and the rows in the `…` are their door:
     * the screens worth a corner of their own have one, and the rest are one tap further. A section row at the top of
     * every one of the four screens was four names for four pages, and the row took the room the figure wanted.
     */
    { key: 'assets', label: 'Assets', to: '/net-worth/assets' },
    { key: 'trades', label: 'Buy & sell', to: '/net-worth/trades' },
    { key: 'debts', label: 'Liabilities', to: '/net-worth/loans' },
  ];

  const nothingYet = series.isSuccess && sheetInputs.isSuccess && sheetMissing.length === 0 && sheet.assetsTotalMinor === 0 && sheet.liabilitiesTotalMinor === 0;

  // The two things the empty state reads: whether there is any money account to add up at all.
  const accounts = useAccounts();
  const money = (accounts.data ?? []).filter(isMoneyAccount);
  /*
   * What kind of account each row of the balance sheet is. The sheet does not carry it — a row is a name and a figure,
   * which is all the total needs — and the account list is already read on this page, so the drawers cost no second
   * read of anything.
   */
  const subtypes = new Map<string, AccountSubtype>((accounts.data ?? []).map((account) => [account.id, account.subtype]));
  /*
   * Which drawers are open, by `group:kind`, and shut to begin with: the point of folding a page of account names away
   * is that what you have reads as a handful of types, and a drawer that opens itself is that answer hidden again.
   */
  const drawers = useDrawers();
  const openDrawers = drawers.open;
  const toggleDrawer = drawers.toggle;
  /*
   * What you owe, as one group: a debt is read by what it *is* — a card, a loan, money owed to a person — and not by
   * when it falls due. "Due within a year" and "long-term" are a schedule, and beside a column of asset types the two
   * of them read as the answer to a different question.
   *
   * `sheet.debts` and not the two schedule groups side by side: the sheet names a debt with a schedule in *both* of
   * them, each holding its own part of the money, so listing the two together named a mortgage twice.
   */
  const owed = sheet.debts;
  /*
   * What kind of debt each row is, which the sheet now carries: the item the picker opened it as, and — where nobody
   * said — what the money went on. A mortgage folds with the mortgages on this page and on the Debts list, not as a
   * plain "Loan" here and a home mortgage there.
   */
  const debts = new Map((sheetInputs.data?.liabilities ?? []).map((row) => [row.accountId, row]));
  /*
   * What kind of thing a row is, which is what its drawer is called. An asset is read off the catalogue code it was
   * opened under and the kind of account it sits in; a debt off its own facts, which is where its kind is kept — so a
   * mortgage folds with the mortgages here and on the Debts list, rather than as a plain "Loan" on one page and a
   * home mortgage on the other.
   */
  const assetKind = (groupKey: string, row: SheetRow): RowKind => rowKindOf(groupKey, row, (accountId) => subtypes.get(accountId));
  const debtRowKind = (row: SheetRow): RowKind => {
    const facts = debts.get(row.accountId);
    return facts?.icon ? debtKind(facts.item ?? null, facts.icon) : assetKind('debts', row);
  };
  /*
   * The same months the line is drawn from, handed to the bars as what each one is made of: the families the assets are
   * held in, out from nothing, and the kinds of debt under them. A month the series could not add up — a rate missing —
   * has no stack, and is handed over empty so nothing is drawn where there is nothing to say.
   */
  const barMonths: BarMonth[] = shown.map((point) => ({
    label: monthLabel(point.month),
    netWorthMinor: point.netWorthMinor,
    assets: point.stack === null ? [] : ASSET_STACK_KEYS.map((key) => ({ key: key.key, minor: point.stack?.assets[key.key as SheetSectionKey] ?? 0 })),
    liabilities: point.stack === null ? [] : DEBT_STACK_KEYS.map((key) => ({ key: key.key, minor: point.stack?.liabilities[key.key as LiabilityKind] ?? 0 })),
  }));

  /*
   * With no money accounts and nothing on the sheet there is nothing to add up, so the screen asks for the two things
   * it reads rather than drawing a page of zeroes. Assets on their own still get the page below.
   */
  if (accounts.isSuccess && money.length === 0 && nothingYet) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Net worth" actions={actions} max={3} />
        <Panel wide>
          <Empty>
            Start by adding your bank accounts and credit cards on the{' '}
            <Link to="/accounts" className="font-medium underline">
              Accounts
            </Link>{' '}
            page.
          </Empty>
        </Panel>
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Net worth" actions={actions} max={3} />
      <ErrorBox error={series.error ?? sheetInputs.error ?? waiting.error} />

      {nothingYet && (
        <Empty>
          Nothing to show yet. Add your accounts on{' '}
          <Link to="/accounts" className="font-medium underline">
            Accounts
          </Link>{' '}
          or an asset on the{' '}
          <Link to="/net-worth/assets" className="font-medium underline">
            Assets
          </Link>{' '}
          tab.
        </Empty>
      )}

      {/*
       * Apple Health's metric: the figure, the months drawn across the whole screen, and the range they are read over
       * beneath them. A full-bleed white band rather than a card the drawing sits inside — the screen's own gutter is
       * not a box, and the line runs to both edges so the months read as a shape.
       *
       * And one column now, with nothing beside it: what waited on the right is a screen of its own behind the corner,
       * and the two-column grid that held it was the reason the band stopped short of the right-hand gutter — a line
       * that runs under a second column is not full-bleed, it is in the way.
       */}
      {/* The box the chart lives in: its own height, marked so a spec can say the two views leave it the same. */}
      <section data-testid="chart-box" className="relative -mx-4 mb-[18px] bg-[var(--ph-surface)] pt-[14px] pb-[14px] md:mx-0">
        {/*
         * The switch sits in the box's own top corner, on the figure's line but out of its way — it is a preference
         * about the drawing below, so it lives beside the drawing rather than in a row of its own under the figure.
         * Glyphs rather than words: "Line" and "Bars" at a corner of a phone would be half the width of the figure.
         */}
        <div role="group" aria-label="Chart view" className="absolute right-4 top-[14px] flex gap-0.5 rounded-lg bg-[var(--ph-track)] p-0.5 md:right-0">
          {CHART_VIEWS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              aria-label={label}
              onClick={() => chooseView(key)}
              className={cx(
                'ph-focus-inset ph-tap flex h-7 w-7 items-center justify-center rounded-md',
                view === key ? 'bg-[var(--ph-selected)] text-[var(--ph-ink)] shadow-[0_1px_3px_rgb(0_0_0/0.14)]' : 'text-[var(--ph-ink-2)]',
              )}
            >
              <Icon size={15} aria-hidden />
            </button>
          ))}
        </div>
        <div className="px-4 md:px-0">
          <div data-testid="net-worth">
            {sheetMissing.length > 0 ? (
              <p className="py-6 text-center text-[15px] leading-[20px] text-[var(--ph-warn)]">No {sheetMissing.join(', ')} rate yet, so net worth cannot be added up.</p>
            ) : (
              <Hero minor={sheet.netWorthMinor} currency={ws.baseCurrency} change={rangeChange(shown)} caption={covered} />
            )}
          </div>
        </div>
        {/*
         * One height for both drawings, so the box never changes size: the line is given the whole of it, and the
         * bars are given it less the room the key under them needs.
         */}
        {view === 'line' ? (
          <NetWorthChart
            values={shown.map((point) => point.netWorthMinor)}
            labels={shown.map((point) => monthLabel(point.month))}
            currency={ws.baseCurrency}
            height={CHART_HEIGHT}
          />
        ) : (
          <NetWorthBars months={barMonths} keys={STACK_KEYS} currency={ws.baseCurrency} height={CHART_HEIGHT} />
        )}
        {sheetMissing.length === 0 && unchartable.length > 0 && (
          <p data-testid="chart-missing" className="px-4 pt-[8px] text-[13px] leading-[17px] text-[var(--ph-warn)] md:px-0">
            No {unchartable.join(', ')} rate for an earlier month, so the line breaks there.
          </p>
        )}
        {/*
         * The range sits under the drawing it governs, as it does in Health: the figure and its line are read first,
         * and the control under them says how far back they were read.
         */}
        <div className="px-4 pt-[14px] md:px-0">
          <SegmentedControl
            width={PHONE_WIDTH - 32}
            label="Range"
            segments={RANGES}
            value={span}
            onChange={(key) => setSpan(key as Span)}
            max={RANGES.length}
          />
        </div>
      </section>

      {/*
       * What you own and what you owe, side by side, before the detail: the two figures the page is read for, so the
       * answer arrives before the page of accounts does. A card a side, as the kit draws a panel, and both figures in
       * the page's own ink: what is owed is a figure like the other one, not a warning.
       *
       * The figure is 17 px rather than the hero's 32: half of 390 px is 174, and a rupiah total at 21 px ran out of the
       * box it was in. Nothing else is in the card — no sentence under the figure saying which side it is — because the
       * label above it already says it, and the room the sentence took is room the figure needed.
       *
       * Not drawn while a rate is missing: a pair of figures built from rows that read 0 would be two more things to
       * read past, and the sheet below says which rate it is waiting on.
       */}
      {sheetMissing.length === 0 && (
        <section data-testid="sheet-totals" className="mb-[18px] grid grid-cols-2 gap-2.5">
          <div className="rounded-[14px] bg-[var(--ph-surface)] px-3 py-[11px]">
            <p className="text-[11px] leading-[13px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">Assets</p>
            <p data-testid="sheet-total-assets" className="tabular mt-[4px] text-[17px] leading-[22px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">{formatMinor(sheet.assetsTotalMinor, ws.baseCurrency)}</p>
          </div>
          <div className="rounded-[14px] bg-[var(--ph-surface)] px-3 py-[11px]">
            <p className="text-[11px] leading-[13px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">Liabilities</p>
            <p data-testid="sheet-total-liabilities" className="tabular mt-[4px] text-[17px] leading-[22px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">{formatMinor(sheet.liabilitiesTotalMinor, ws.baseCurrency)}</p>
          </div>
        </section>
      )}

      {/*
       * No heading over the sheet and no line under it saying how it was valued: each side is already headed by its own
       * name, and "Assets at today's value · debts at what you still owe" sat above two columns whose captions said the
       * same thing in the language of the thing itself.
       *
       * The two sides are 18 px apart — the same distance the pair above them sits from the sheet, and the distance
       * every other box on this page sits from the next. The grid's own 24 px was the one gutter on the page that
       * answered to nothing else, and between two boxes of the same kind it read as a space rather than a seam.
       */}
      <section className="mb-[18px]">
        {/* A row with no rate reads 0 here, so its totals would be short: the missing rate is named instead. */}
        {sheetMissing.length > 0 ? (
          <Panel wide>
            <p data-testid="balance-sheet-missing" className="text-[15px] leading-[20px] text-[var(--ph-warn)]">No {sheetMissing.join(', ')} rate yet, so the balance sheet cannot be added up.</p>
          </Panel>
        ) : (
        <>
        {/*
         * A column gap and no row gap: stacked on a phone, the two sides are told apart by the group's own 18 px
         * margin — the same breathing room every other seam on this page has — and a grid row gap on top of it made
         * the line between what is owned and what is owed 36 px, twice everything else. Side by side, that same 18 px
         * is the two columns' separation.
         */}
        <div className="grid gap-x-[18px] md:grid-cols-2">
          <SheetColumn
            title="Assets"
            groups={sheet.assetGroups}
            currency={ws.baseCurrency}
            kindOf={assetKind}
            nested
            open={openDrawers}
            onToggle={toggleDrawer}
          />
          <SheetColumn
            title="Liabilities"
            groups={owed.rows.length > 0 ? [owed] : []}
            currency={ws.baseCurrency}
            kindOf={(_groupKey, row) => debtRowKind(row)}
            oneGroupOnly
            open={openDrawers}
            onToggle={toggleDrawer}
          />
        </div>
        </>
        )}
      </section>
    </div>
  );
}
