import { balanceSheet, isoDate, lastNMonths, monthOf, type SheetGroup, type SheetRow } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { BellRing, Gauge } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Drawer, Hero, InsetGroup, InsetRow, LargeTitle, Panel, PanelHeader, PHONE_WIDTH, SCREEN, SegmentedControl } from '../../ui/native';
import { useAttention } from './attention';
import { NetWorthChart } from './NetWorthChart';
import { ShareBar, ShareLegend, type ShareSegment } from './ShareBar';
import { sheetDrawers, rowKindOf } from './sheet-drawers';
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

/** What each section of the assets side is drawn in. One colour a family of things, as the catalogue's picker has. */
const GROUP_COLORS: Record<string, string> = {
  liquid: 'bg-cyan-600',
  invest: 'bg-emerald-600',
  use: 'bg-slate-400',
  other: 'bg-amber-500',
};

/**
 * What each kind of debt is drawn in, so a bar of what you owe says what the money is owed *on*.
 *
 * One family in three sizes, because these three are amounts of the same thing — the assets beside them are where the
 * colours have to tell different things apart.
 */
const LIABILITY_COLORS: Record<string, string> = {
  credit_card: 'bg-rose-500',
  loan: 'bg-rose-800',
  payable: 'bg-rose-300',
};

/**
 * One side of the balance sheet: its share bar and legend on a panel, then a section per section of the statement.
 *
 * Each section's label is its own header, outside and above its rows, rather than a heading line inside one long card.
 * A section whose rows are of more than one kind folds them into a drawer a kind — current accounts with current
 * accounts, listed shares with listed shares — because a list of everything you own is as long as the accounts you have
 * opened, and the answer to what you have is a handful of kinds. A section of one kind is drawn plainly: one drawer is
 * no division at all, and a drawer over a single account hides one figure to save one line.
 *
 * The two columns stay two columns on a desktop.
 */
function SheetColumn({
  title,
  groups,
  bar,
  totalMinor,
  currency,
  subtypes,
  open,
  onToggle,
}: {
  title: string;
  groups: SheetGroup[];
  /**
   * What the bar divides into: the groups themselves where each group is one kind of thing, and the kinds themselves
   * where one group holds several. The bar and the columns beside it answer the same question, so a side whose groups
   * are a schedule rather than a kind says so with its bar.
   */
  bar: ShareSegment[];
  totalMinor: number;
  currency: string;
  /** What kind of account each row is, which is what the drawers fold by. */
  subtypes: ReadonlyMap<string, AccountSubtype>;
  /** The drawers that are open, by `group:kind`. Shut to begin with. */
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    // `min-w-0`: a column in a grid is as wide as its widest row unless it is told it may be narrower, and a row whose
    // title truncates is still as wide as the whole title — which is what pushed this page sideways.
    <div className="min-w-0">
      <PanelHeader title={title} trailing={<Money minor={totalMinor} currency={currency} />} />
      <Panel wide className="space-y-2">
        <ShareBar segments={bar} totalMinor={totalMinor} />
        <ShareLegend segments={bar} totalMinor={totalMinor} />
      </Panel>
      {groups.map((group) =>
        group.rows.length === 0 ? (
          <PanelHeader key={group.key} title={group.label} trailing={<Money minor={group.totalMinor} currency={currency} />} />
        ) : (
          /* Marked by its own key, so a spec can say which section a row was drawn in. */
          <div key={group.key} data-testid={`sheet-section-${group.key}`}>
            <InsetGroup wide header={group.label} trailing={<Money minor={group.totalMinor} currency={currency} />}>
              {fold(group, subtypes, open, onToggle, currency)}
            </InsetGroup>
          </div>
        ),
      )}
    </div>
  );
}

/** One account's line in the sheet: its name, and what it is worth or what it owes. */
function sheetLine(row: SheetRow, currency: string) {
  return <InsetRow key={row.accountId} title={row.name} subtitle={row.note ?? undefined} value={<Money minor={row.amountMinor} currency={currency} />} valueTone="ink" chevron={false} />;
}

/** A group's rows, folded by kind where there is more than one kind to tell apart. */
function fold(group: SheetGroup, subtypes: ReadonlyMap<string, AccountSubtype>, open: ReadonlySet<string>, onToggle: (key: string) => void, currency: string) {
  const drawers = sheetDrawers(group.rows, (row) => rowKindOf(group.key, row, (accountId) => subtypes.get(accountId)));
  // One kind is no division at all: a drawer over it would hide every row it has to name one type.
  if (drawers.length <= 1) return group.rows.map((row) => sheetLine(row, currency));
  return drawers.flatMap((drawer, index) => {
    const key = `${group.key}:${drawer.key}`;
    const shown = open.has(key);
    return [
      <Drawer
        key={key}
        label={drawer.label}
        /* A count, because a drawer is only drawn where there are two kinds: "2 accounts" says what is inside it. */
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
    { key: 'debts', label: 'Debts', to: '/net-worth/loans' },
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
  const [openDrawers, setOpenDrawers] = useState<ReadonlySet<string>>(new Set());
  const toggleDrawer = (key: string) =>
    setOpenDrawers((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /*
   * What you owe, as one group: a debt is read by what it *is* — a card, a loan, money owed to a person — and not by
   * when it falls due. "Due within a year" and "long-term" are a schedule, and beside a column of asset types the two
   * of them read as the answer to a different question.
   *
   * `sheet.debts` and not the two schedule groups side by side: the sheet names a debt with a schedule in *both* of
   * them, each holding its own part of the money, so listing the two together named a mortgage twice.
   */
  const owed = sheet.debts;
  // The bar divides into the kinds the column's drawers hold: the same arithmetic, from the same fold.
  const owedBar: ShareSegment[] = sheetDrawers(owed.rows, (row) => rowKindOf('debts', row, (accountId) => subtypes.get(accountId))).map((drawer) => ({
    key: drawer.key,
    label: drawer.label,
    minor: drawer.totalMinor,
    className: LIABILITY_COLORS[drawer.key] ?? 'bg-rose-500',
  }));
  const assetBar: ShareSegment[] = sheet.assetGroups.map((group) => ({
    key: group.key,
    label: group.label,
    minor: group.totalMinor,
    className: GROUP_COLORS[group.key] ?? 'bg-slate-400',
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
      <section className="-mx-4 mb-[18px] bg-[var(--ph-surface)] pt-[2px] pb-[10px] md:mx-0">
        <div className="px-4 md:px-0">
          <div data-testid="net-worth">
            {sheetMissing.length > 0 ? (
              <p className="py-6 text-center text-[15px] leading-[20px] text-[var(--ph-warn)]">No {sheetMissing.join(', ')} rate yet, so net worth cannot be added up.</p>
            ) : (
              <Hero minor={sheet.netWorthMinor} currency={ws.baseCurrency} change={rangeChange(shown)} caption={covered} />
            )}
          </div>
        </div>
        <NetWorthChart values={shown.map((point) => point.netWorthMinor)} labels={shown.map((point) => monthLabel(point.month))} currency={ws.baseCurrency} />
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

      <section className="mb-[18px]">
        <PanelHeader title="Balance sheet" />
        <p className="px-[4px] pb-[10px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">At today's value · debts at what you still owe</p>
        {/* A row with no rate reads 0 here, so its totals would be short: the missing rate is named instead. */}
        {sheetMissing.length > 0 ? (
          <Panel wide>
            <p data-testid="balance-sheet-missing" className="text-[15px] leading-[20px] text-[var(--ph-warn)]">No {sheetMissing.join(', ')} rate yet, so the balance sheet cannot be added up.</p>
          </Panel>
        ) : (
        <>
        <div className="grid gap-6 md:grid-cols-2">
          <SheetColumn
            title="Assets"
            groups={sheet.assetGroups}
            bar={assetBar}
            totalMinor={sheet.assetsTotalMinor}
            currency={ws.baseCurrency}
            subtypes={subtypes}
            open={openDrawers}
            onToggle={toggleDrawer}
          />
          <SheetColumn
            title="Liabilities"
            groups={owed.rows.length > 0 ? [owed] : []}
            bar={owedBar}
            totalMinor={sheet.liabilitiesTotalMinor}
            currency={ws.baseCurrency}
            subtypes={subtypes}
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
