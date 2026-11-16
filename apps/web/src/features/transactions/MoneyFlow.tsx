import { formatMinor, isoDate, parsePeriod, periodLabel, periodMonthOf } from '@expanses/core';
import { useMonthStart } from '../workspaces/queries';
import { listTransactionsIn } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useAccounts } from '../../lib/queries';
import { Empty } from '../../ui';
import { Panel, PushedTitle, SCREEN } from '../../ui/native';
import { useCategoryMarkColour } from '../categories/CategoryIcon';
import { OTHER_COLOUR } from './category-colours';
import { compactMinor, type FlowNode, type MoneyFlow, moneyFlow, OTHERS_KEY, SAVED_KEY } from './money-flow';

/** How many spending categories stand on their own in the box: the phone's three columns are tight, the ring shows eight. */
const TOP_ON_PHONE = 6;
const TOP_ON_WIDE = 8;

/**
 * The period's flows, read from the period's own transactions — the same rows the list under the chart is made of,
 * so the two never disagree about what the month came to. Every category is folded into its top-level parent, as
 * the ring folds it, and a tap on a bar opens that parent with everything under it.
 */
export function useMoneyFlow(month: string, topCategories: number): { flow: MoneyFlow | null; currency: string } {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const monthStart = useMonthStart();
  const period = parsePeriod(month, monthStart);
  const range = period?.from ? { from: period.from, to: period.to! } : {};
  const list = useQuery({
    queryKey: ['money-flow', ws.workspaceId, ws.bookId ?? null, month, monthStart],
    enabled: period !== null,
    queryFn: () => listTransactionsIn(database, ws, range),
  });
  const roots: Record<string, { id: string; name: string }> = {};
  for (const account of accounts) {
    if (account.kind !== 'expense' && account.kind !== 'income') continue;
    let top = account;
    for (let depth = 0; top.parentId && depth < 8; depth += 1) top = accounts.find((a) => a.id === top.parentId) ?? top;
    if (top.id !== account.id) roots[account.id] = { id: top.id, name: top.name };
  }
  return {
    flow: list.data ? moneyFlow(list.data.transactions, month, { topCategories, roots, monthStart }) : null,
    currency: list.data?.currency ?? ws.baseCurrency,
  };
}

/** A bar once it has been placed: where it is, and how far down each side the bands have reached. */
interface Placed {
  node: FlowNode;
  x: number;
  y: number;
  h: number;
  colour: string;
  /** How much of its left and right sides the bands drawn so far have taken, so the next one starts under them. */
  left: number;
  right: number;
}

/** Cuts a name to what fits beside a bar, with an ellipsis where it ran out. */
const fit = (name: string, chars: number) => (name.length > chars ? `${name.slice(0, Math.max(1, chars - 1)).trimEnd()}…` : name);

/**
 * The chart: three columns of bars with the bands between them, as wide as it is given and as tall as it needs.
 *
 * Plain SVG, as every chart in the app is. A band is one filled shape — a cubic out, a straight edge, a cubic back
 * — rather than a thick stroke, so its two ends are exactly the heights of the bars it joins. Colours are each
 * category's own: income in the tint, a card in the alarm colour, an ordinary account in grey, so the middle column
 * reads at a glance as the money's resting places rather than as more categories.
 *
 * `full` is the whole-screen drawing: wider label columns, every figure written, and nothing hidden for want of room.
 */
export function FlowChart({
  flow,
  currency,
  width,
  height,
  full = false,
  onCategory,
}: {
  flow: MoneyFlow;
  currency: string;
  width: number;
  /** Given, the drawing fills it; left out, it takes the height its bars want. */
  height?: number;
  full?: boolean;
  /** A tap on a category's bar or band, on either side. Others and Saved are nobody's category. */
  onCategory?: (categoryId: string) => void;
}) {
  const colourFor = useCategoryMarkColour();
  const font = full ? 12 : 11;
  const bar = full ? 10 : 8;
  const gap = full ? 8 : 5;
  const pad = 4;
  // Room for the names: enough for "Transport" on a phone, for most names in full.
  const leftRoom = full ? Math.min(130, width * 0.2) : 72;
  const rightRoom = full ? Math.min(150, width * 0.22) : 88;
  const perChar = font * 0.56;
  const columns = [flow.sources, flow.accounts, flow.targets];
  const most = Math.max(...columns.map((nodes) => nodes.length));
  const h = height ?? Math.max(260, most * 30 + pad * 2);
  // One scale for all three columns, set by whichever is fullest once its gaps are taken out.
  const scale = Math.min(
    ...columns.map((nodes) => {
      const total = nodes.reduce((sum, node) => sum + node.amountMinor, 0);
      return total > 0 ? (h - pad * 2 - (nodes.length - 1) * gap) / total : Number.POSITIVE_INFINITY;
    }),
  );
  if (!Number.isFinite(scale)) return null;

  const xs = [leftRoom, (width - bar) / 2, width - rightRoom - bar];
  const colourOf = (column: number, node: FlowNode): string => {
    if (column === 0 || node.key === SAVED_KEY) return 'var(--ph-up)';
    if (column === 1) return flow.accounts.find((account) => account.key === node.key)?.card ? 'var(--ph-alarm)' : 'var(--ph-ink-3)';
    if (node.key === OTHERS_KEY) return OTHER_COLOUR;
    return colourFor(node.key);
  };
  const placed = new Map<string, Placed>();
  const order = new Map<string, number>();
  columns.forEach((nodes, column) => {
    let y = pad;
    nodes.forEach((node, index) => {
      placed.set(node.key, { node, x: xs[column]!, y, h: node.amountMinor * scale, colour: colourOf(column, node), left: 0, right: 0 });
      order.set(node.key, index);
      y += node.amountMinor * scale + gap;
    });
  });

  /*
   * The bands, laid down each side of a bar in the order of the bars they reach, so none crosses another needlessly:
   * a band leaving the top of the bank goes to the top of the right-hand column.
   */
  const bands = [...flow.links]
    .sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0) || (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0))
    .flatMap((link) => {
      const from = placed.get(link.source);
      const to = placed.get(link.target);
      if (!from || !to) return [];
      const thick = link.amountMinor * scale;
      const y0 = from.y + from.right;
      const y1 = to.y + to.left;
      from.right += thick;
      to.left += thick;
      const x0 = from.x + bar;
      const x1 = to.x;
      const mid = (x0 + x1) / 2;
      const d = `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} L${x1},${y1 + thick} C${mid},${y1 + thick} ${mid},${y0 + thick} ${x0},${y0 + thick} Z`;
      // A band into the right-hand column is coloured by where it goes; one out of the left by where it came from.
      const spending = flow.targets.some((node) => node.key === link.target);
      const category = spending && link.target !== OTHERS_KEY && link.target !== SAVED_KEY ? link.target : null;
      return [{ key: `${link.source}|${link.target}`, d, colour: spending ? to.colour : from.colour, category, label: `${from.node.name} to ${to.node.name}: ${formatMinor(link.amountMinor, currency)}` }];
    });

  const press = (categoryId: string | null) => {
    if (!categoryId || !onCategory) return {};
    return {
      role: 'button' as const,
      tabIndex: 0,
      className: 'cursor-pointer',
      onClick: () => onCategory(categoryId),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onCategory(categoryId);
        }
      },
    };
  };
  /** A bar's name and, when the bar is tall enough for a second line, its figure. */
  const label = (p: Placed, x: number, anchor: 'start' | 'end', room: number) => {
    // Two lines where there is room for them; the whole-screen drawing writes the figure on anything but a sliver.
    const two = p.h >= 26 || (full && p.h >= 14);
    const centre = p.y + p.h / 2;
    const chars = Math.floor(room / perChar);
    return (
      <text x={x} y={two ? centre - 2 : centre + font * 0.35} textAnchor={anchor} fontSize={font} fill="var(--ph-ink-3)">
        {fit(p.node.name, chars)}
        {two && (
          <tspan x={x} dy={font + 2} className="tabular">
            {compactMinor(p.node.amountMinor, currency)}
          </tspan>
        )}
      </text>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${h}`}
      width={width}
      height={h}
      className="block"
      role="img"
      aria-label={`Money flow: ${formatMinor(flow.incomeMinor, currency)} in, ${formatMinor(flow.spentMinor, currency)} out`}
      data-testid="flow-chart"
    >
      {bands.map((band) => (
        <path key={band.key} d={band.d} fill={band.colour} fillOpacity={0.4} aria-label={band.label} data-testid={`flow-band-${band.key}`} {...press(band.category)} />
      ))}
      {flow.sources.map((node) => {
        const p = placed.get(node.key)!;
        return (
          <g key={node.key} data-testid={`flow-source-${node.key}`} aria-label={`${node.name}: ${formatMinor(node.amountMinor, currency)}`} {...press(node.key)}>
            <rect x={p.x} y={p.y} width={bar} height={Math.max(2, p.h)} rx={2} fill={p.colour} />
            {label(p, p.x - 6, 'end', leftRoom - 8)}
          </g>
        );
      })}
      {flow.accounts.map((node) => {
        const p = placed.get(node.key)!;
        return (
          <g key={node.key} data-testid={`flow-account-${node.key}`} aria-label={`${node.name}: ${formatMinor(node.amountMinor, currency)}`}>
            <rect x={p.x} y={p.y} width={bar} height={Math.max(2, p.h)} rx={2} fill={p.colour} />
            {/* The name sits over the bands to its right, haloed in the surface so it reads through them; a thin bar keeps quiet. */}
            {(p.h >= 24 || (full && p.h >= 12)) && (
              <text
                x={p.x + bar + 4}
                y={p.y + p.h / 2 + font * 0.35}
                fontSize={font - 1}
                fill="var(--ph-ink-2)"
                stroke="var(--ph-surface)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {fit(node.name, full ? 24 : 10)}
              </text>
            )}
          </g>
        );
      })}
      {flow.targets.map((node) => {
        const p = placed.get(node.key)!;
        const category = node.key === OTHERS_KEY || node.key === SAVED_KEY ? null : node.key;
        return (
          <g key={node.key} data-testid={`flow-target-${node.key}`} aria-label={`${node.name}: ${formatMinor(node.amountMinor, currency)}`} {...press(category)}>
            <rect x={p.x} y={p.y} width={bar} height={Math.max(2, p.h)} rx={2} fill={p.colour} />
            {label(p, p.x + bar + 6, 'start', rightRoom - 8)}
          </g>
        );
      })}
    </svg>
  );
}

/** The size an element is laid out at, and where its top is, kept current as they change; null until measured. */
function useShownSize(element: HTMLElement | null): { width: number; height: number; top: number } | null {
  const [size, setSize] = useState<{ width: number; height: number; top: number } | null>(null);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      if (box.width > 0) setSize({ width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.top + window.scrollY) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/**
 * The Money flow box on the Cashflow page: where the period's money came from, what it passed through and where it
 * went, under the chart. The › in its header opens the same drawing on a screen of its own; a tap on a category
 * opens the list filtered to it, as a tap on the ring's rows does.
 *
 * A period with nothing coming in or going out draws no box: there is no flow to show.
 */
export function MoneyFlowBox({ month, onPick }: { month: string; onPick?: (categoryId: string) => void }) {
  const phone = usePhone();
  const { flow, currency } = useMoneyFlow(month, phone ? TOP_ON_PHONE : TOP_ON_WIDE);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const size = useShownSize(frame);
  if (!flow || (flow.sources.length === 0 && flow.targets.length === 0)) return null;
  return (
    <Panel
      header="Money flow"
      trailing={
        <Link
          to="/transactions/flow"
          search={{ month }}
          aria-label="Money flow, full screen"
          className="ph-focus ph-tap -my-[4px] flex h-[22px] w-[22px] items-center justify-center rounded-full text-[var(--ph-ink-3)]"
          data-testid="money-flow-open"
        >
          <ChevronRight size={16} aria-hidden />
        </Link>
      }
      testId="money-flow"
    >
      <div ref={setFrame} className="w-full">
        {size && <FlowChart flow={flow} currency={currency} width={size.width} onCategory={onPick} />}
      </div>
      {/* The three figures under the drawing, a cell each, as the trend's comparisons are laid out. */}
      <div className="mt-2 grid auto-cols-fr grid-flow-col border-t border-slate-100 pt-2.5" data-testid="money-flow-figures">
        {[
          ['In', flow.incomeMinor, 'text-[var(--ph-ink)]'],
          ['Out', flow.spentMinor, 'text-[var(--ph-ink)]'],
          ...(flow.incomeMinor > flow.spentMinor ? [['Saved', flow.incomeMinor - flow.spentMinor, 'text-[var(--ph-up)]'] as const] : []),
        ].map(([label, minor, tone]) => (
          <div key={label} className="min-w-0 px-1 text-center [&+*]:border-l [&+*]:border-slate-100">
            <span className={`tabular block truncate text-[13px] font-semibold ${tone}`}>{formatMinor(minor as number, currency)}</span>
            <span className="block text-[11px] text-[var(--ph-ink-3)]">{label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export interface MoneyFlowSearch {
  month?: string;
}

/** The screen's search: the period, when it is one the picker could have made. */
export const moneyFlowSearch = (search: Record<string, unknown>): MoneyFlowSearch =>
  typeof search.month === 'string' && parsePeriod(search.month) ? { month: search.month } : {};

/**
 * The flow on a screen of its own, drawn sideways: a phone is held upright and the chart is turned so it reads along
 * the longer edge, with every category named and nothing folded into Others. A wide screen has the width already
 * and draws it the right way up.
 */
export function MoneyFlowPage() {
  const search = useSearch({ strict: false }) as MoneyFlowSearch;
  const monthStart = useMonthStart();
  const month = search.month ?? periodMonthOf(isoDate(), monthStart);
  const phone = usePhone();
  const navigate = useNavigate();
  const { flow, currency } = useMoneyFlow(month, Number.POSITIVE_INFINITY);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const size = useShownSize(frame);
  const empty = flow !== null && flow.sources.length === 0 && flow.targets.length === 0;
  // The frame takes what is left of the screen under its own top edge, stopping short of the phone's tab bar.
  const frameHeight = Math.max(360, (typeof window === 'undefined' ? 0 : window.innerHeight) - (size?.top ?? 0) - (phone ? 112 : 32));
  const onCategory = (categoryId: string) => void navigate({ to: '/transactions', search: { account: categoryId, month } });
  // Sideways on a phone: the chart is as wide as the frame is tall, and turned a quarter to lie along it.
  const chartWidth = size ? (phone ? size.height : size.width) : 0;
  const chartHeight = size ? (phone ? size.width : size.height) : 0;
  return (
    <div className={SCREEN}>
      <PushedTitle title="Money flow" back="Cashflow" backTo="/transactions" backSearch={{ month }} actions={[]} />
      <p className="mb-3 px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{periodLabel(month)}</p>
      {empty ? (
        <Empty>Nothing came in or went out in {periodLabel(month)}.</Empty>
      ) : (
        <div ref={setFrame} className="relative w-full overflow-hidden rounded-[14px] bg-[var(--ph-surface)]" style={{ height: frameHeight }} data-testid="money-flow-page">
          {flow && size && (
            <div
              className="absolute left-0 top-0 p-2"
              style={
                phone
                  ? { width: chartWidth, height: chartHeight, transformOrigin: 'top left', transform: 'rotate(90deg) translateY(-100%)' }
                  : { width: chartWidth, height: chartHeight }
              }
            >
              <FlowChart flow={flow} currency={currency} width={chartWidth - 16} height={chartHeight - 16} full onCategory={onCategory} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
