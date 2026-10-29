import { CURRENCIES, dayMonth, type EventPlanItemView, formatMinor, groupTypedAmount, minorToMajorString, parseMajor } from '@expanses/core';
import { setPurchaseCover } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import {
  InsetGroup,
  InsetRow,
  LargeTitle,
  ROW_PAD_X,
  type CornerAction,
  type GroupChild,
} from '../../ui/native';
import { answeredElsewhere, coverTotals } from './plan-view';
import { useEventHistory, useEventPlan, useEvents, usePurchaseCover } from './queries';

/** A figure as the share field shows it: grouped in id-ID, the decimal comma where the currency has cents. */
function typedOf(minor: number, currency: string): string {
  return groupTypedAmount(minorToMajorString(minor, currency).replace('.', ','), currency);
}

/** Half-typed digits are not an error, only a figure that is not there yet: nought until the whole of it parses. */
function minorOf(typed: string, currency: string): number {
  try {
    return parseMajor(typed, currency);
  } catch {
    return 0;
  }
}

/**
 * One cost of the checklist, drawn as the plan draws its rows: the 28 px circle at the left (green with a tick when the
 * receipt answers it, a grey ring when not), the name at 14 px medium, and the figure at the right.
 *
 * The tick is a real checkbox laid invisibly over the circle, so it is named by the cost and keyboard-reachable; the
 * name beside it is a label for the same box. The typed share is a second control by its nature, which is why this is
 * not an `InsetRow`.
 */
function CoverRow({
  position,
  ticked,
  onTick,
  name,
  elsewhere,
  share,
  onShare,
  estimate,
  symbol,
  id,
}: GroupChild & {
  ticked: boolean;
  onTick: (on: boolean) => void;
  name: string;
  elsewhere: string | null;
  share: string;
  onShare: (typed: string) => void;
  estimate: string;
  symbol: string;
  id: string;
}) {
  return (
    <div className="relative flex items-center pl-[6px]">
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X }} />
      )}
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          aria-label={name}
          checked={ticked}
          onChange={(e) => onTick(e.target.checked)}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className={cx(
            'flex h-7 w-7 items-center justify-center rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--ph-tint)]',
            ticked ? 'bg-[var(--ph-up-panel)] text-[var(--ph-up)]' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset',
          )}
        >
          {ticked && <Check size={15} strokeWidth={3} />}
        </span>
      </span>
      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pr-[14px] pl-1">
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-sm font-medium text-[var(--ph-ink)]">{name}</span>
          {elsewhere && <span className="block text-xs text-[var(--ph-ink-3)]">{elsewhere}</span>}
        </label>
        {ticked ? (
          <span className="tabular flex shrink-0 flex-col items-end text-sm font-semibold whitespace-nowrap text-[var(--ph-ink)]">
            <span className="flex items-baseline gap-1">
              <span aria-hidden>{symbol}</span>
              {/* The field is as wide as what is typed: a hidden copy of the text sets the width. */}
              <span className="inline-grid">
                <span aria-hidden className="invisible col-start-1 row-start-1 min-w-[2ch] whitespace-pre text-right">
                  {share || ' '}
                </span>
                <input
                  aria-label={`Share for ${name}`}
                  inputMode="decimal"
                  value={share}
                  onChange={(e) => onShare(e.target.value)}
                  className="ph-focus tabular col-start-1 row-start-1 w-0 min-w-full rounded bg-transparent p-0 text-right text-sm font-semibold text-[var(--ph-ink)]"
                />
              </span>
            </span>
            <span className="block text-[11.5px] leading-[14px] font-normal text-[var(--ph-ink-3)]">of {estimate}</span>
          </span>
        ) : (
          <span className="tabular shrink-0 text-sm whitespace-nowrap text-[var(--ph-ink-3)]">{estimate}</span>
        )}
      </div>
    </div>
  );
}

/**
 * What one receipt covers: tick the items it paid for, and say how much of it each one is.
 *
 * **The transaction is never touched.** A share is a reading of a purchase, not an edit of one — nothing on this
 * screen posts, moves, divides or rewrites an entry, so the statement, the points, the card cycle and the tax report
 * all read exactly as they did before. What changes is only which items say "this receipt answered me, and this much
 * of it was mine".
 *
 * This is the screen the second tick belongs on. Ticking an item off the plan claims what is *left* of its receipt —
 * the whole of it when it is the first tick — so a receipt that bought three things is spoken for by the first, and
 * the second has nothing to claim. That is the ordinary shape of one trip to the shop, and the answer to it is here,
 * where every share is typed together and checked against the one payment before a single row is written.
 *
 * The shares are never recomputed here: `setPurchaseCover` checks them against the receipt in BigInt inside one
 * database transaction and refuses the lot if they come to more than it. Save is turned off while they do, because a
 * button that cannot work is a better answer than a button that explains itself afterwards.
 */
export function CoverPage() {
  const { eventId, transactionId } = useParams({ from: '/events/$eventId/plan/link/$transactionId' });
  // `ws` here is the workspace tab the plan is read in; `ws` from useApp below is the workspace context.
  const { ws: tab, item } = useSearch({ from: '/events/$eventId/plan/link/$transactionId' });
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  /*
   * The whole plan, whatever tab the event is being read in.
   *
   * The shares this screen seeds itself from are read owner-wide, because what a receipt already answers is a fact
   * about the receipt. Reading the *items* through a workspace tab as well left the two disagreeing: an item filed
   * in another workspace's category is dropped by `eventPlanFor`, so its share counted in "Given to items" with no
   * row on the page to show it or to hand it back — totals describing money the user could neither see nor free.
   */
  const plan = useEventPlan(eventId, null);
  const cover = usePurchaseCover(transactionId);
  const history = useEventHistory(eventId, tab ?? null);
  const rowId = useId();

  // itemId → the share as it is typed. A key that is present is a tick; absent is unticked.
  const [shares, setShares] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const items = (plan.data?.lines ?? []).flatMap((line) => line.items);
  // A settled cost is closed to more receipts: it is listed only while this receipt already covers it, so it can still be unticked.
  const covered = new Set((cover.data?.covers ?? []).map((row) => row.itemId));
  const listed = items.filter((row) => !row.done || covered.has(row.id) || shares[row.id] !== undefined);
  const totalMinor = cover.data?.totalMinor ?? 0;
  const currency = ws.baseCurrency;
  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;

  /*
   * Seeded once, from what this receipt already answers: the stored shares are the truth about it, read owner-wide,
   * so a workspace tab can never make one look unspoken for. The item carried in `?item=` joins them at whatever is
   * still free, up to its own estimate — and when nothing is free it starts at its estimate instead, so the figures
   * above say it is over and something else has to give it up rather than seeding a nought the repository must refuse.
   */
  useEffect(() => {
    if (seeded || !cover.data || !plan.data) return;
    const next: Record<string, string> = {};
    for (const row of cover.data.covers) next[row.itemId] = typedOf(row.shareMinor, currency);
    const named = item ? (items.find((row) => row.id === item) ?? null) : null;
    if (named && next[named.id] === undefined) {
      const left = cover.data.totalMinor - cover.data.covers.reduce((total, row) => total + row.shareMinor, 0);
      next[named.id] = typedOf(left > 0 ? Math.min(named.estimateMinor, left) : named.estimateMinor, currency);
    }
    setShares(next);
    setSeeded(true);
  }, [seeded, cover.data, plan.data, item, items, currency]);

  const typedMinor = (id: string) => minorOf(shares[id] ?? '', currency);
  const ticked = Object.keys(shares);
  const totals = coverTotals(totalMinor, ticked.map(typedMinor));

  function toggle(row: EventPlanItemView, on: boolean) {
    setShares((was) => {
      if (!on) {
        const { [row.id]: _gone, ...rest } = was;
        return rest;
      }
      const given = Object.entries(was).reduce((total, [, typed]) => total + minorOf(typed, currency), 0);
      const left = totalMinor - given;
      return { ...was, [row.id]: typedOf(left > 0 ? Math.min(row.estimateMinor, left) : row.estimateMinor, currency) };
    });
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await setPurchaseCover(
        database,
        ws,
        transactionId,
        ticked.map((id) => ({ itemId: id, shareMinor: typedMinor(id) })),
      );
      await invalidate();
      await navigate({ to: '/events/$eventId/plan', params: { eventId }, search: { ws: tab } });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  if (events.isSuccess && !event) return <Empty>That event is no longer here.</Empty>;

  const receipt = (history.data ?? []).find((tx) => tx.id === transactionId) ?? null;
  const paidWith = receipt?.entries.find((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability')?.accountName ?? null;
    // A share of nothing is not a share but the absence of one, and the repository says so; the button says so first.
  const unsaveable = totals.over || ticked.some((id) => typedMinor(id) <= 0);

  const cancelTo = item
    ? ({ to: '/events/$eventId/plan/$itemId', params: { eventId, itemId: item }, search: { ws: tab } } as const)
    : ({ to: '/events/$eventId/plan', params: { eventId }, search: { ws: tab } } as const);

  const saveAction: CornerAction = {
    key: 'save',
    label: 'Save',
    glyph: <Check size={22} aria-hidden />,
    run: () => void save(),
    disabled: unsaveable || saving || !cover.isSuccess,
  };

  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">
        <LargeTitle title="Link to costs" back="Cancel" backTo={cancelTo.to} backParams={cancelTo.params} backSearch={cancelTo.search} actions={[saveAction]} />
        <ErrorBox error={error ?? events.error ?? plan.error ?? cover.error} />

        <div data-testid="cover-totals">
          <InsetGroup>
            <InsetRow
              plain
              title={cover.data?.description ?? receipt?.description ?? 'This payment'}
              subtitle={[cover.data?.occurredOn ? dayMonth(cover.data.occurredOn) : null, paidWith].filter(Boolean).join(' · ')}
              value={formatMinor(totalMinor, currency)}
              valueTone="ink"
            />
            <InsetRow plain title="Linked to costs" value={formatMinor(totals.givenMinor, currency)} valueTone="ink" />
            <InsetRow
              plain
              title={totals.over ? 'Over this receipt' : 'Left on this receipt'}
              value={formatMinor(Math.abs(totals.leftMinor), currency)}
              valueTone="ink"
            />
          </InsetGroup>
        </div>

        {/* No share box before the stored shares are seeded: a share typed first would be overwritten as they land. */}
        {!seeded ? (
          <p className="text-sm text-[var(--ph-ink-3)]">Loading…</p>
        ) : listed.length === 0 ? (
          <Empty>There is nothing on the plan left for this receipt to answer.</Empty>
        ) : (
          <InsetGroup>
            {listed.map((row) => (
              <CoverRow
                key={row.id}
                id={`${rowId}-${row.id}`}
                ticked={shares[row.id] !== undefined}
                onTick={(on) => toggle(row, on)}
                name={row.name}
                elsewhere={answeredElsewhere(row, transactionId)}
                share={shares[row.id] ?? ''}
                onShare={(typed) => setShares((was) => ({ ...was, [row.id]: groupTypedAmount(typed, currency) }))}
                estimate={formatMinor(row.estimateMinor, currency)}
                symbol={symbol}
              />
            ))}
          </InsetGroup>
        )}
      </div>
    </div>
  );
}
