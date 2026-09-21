import { dayMonth, type EventPlanItemView, formatMinor, minorToMajorString, parseMajor } from '@expanses/core';
import { setPurchaseCover } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import {
  InsetGroup,
  InsetRow,
  LargeTitle,
  ROW_PAD_X,
  ROW_PAD_Y,
  rowHeight,
  toneClass,
  type CornerAction,
  type GroupChild,
  type Tone,
} from '../../ui/native';
import { answeredElsewhere, coverTotals, differenceWords } from './plan-view';
import { useEventHistory, useEventPlan, useEvents, usePurchaseCover } from './queries';

/** Half-typed digits are not an error, only a figure that is not there yet: nought until the whole of it parses. */
function minorOf(typed: string, currency: string): number {
  try {
    return parseMajor(typed, currency);
  } catch {
    return 0;
  }
}

/** The kit's tones for what a difference is. The words themselves are `differenceWords`'. */
const HERE: Record<'over' | 'under' | 'exact', Tone> = { over: 'alarm', under: 'tint', exact: 'ink-3' };

/**
 * A row with a tick on one side and a typed share on the other.
 *
 * There is no primitive for this and there should not be: `InsetRow` is one tap target on purpose, and this row is
 * two controls by its nature — the tick says the receipt answered this item, and the field says how much of it did.
 * So the row is drawn to the kit's own measurements and with the kit's own separator, rather than by bending a
 * primitive that exists to forbid exactly this shape.
 */
function CoverRow({
  position,
  ticked,
  onTick,
  name,
  subtitle,
  elsewhere,
  share,
  onShare,
  difference,
  id,
}: GroupChild & {
  ticked: boolean;
  onTick: (on: boolean) => void;
  name: string;
  subtitle: string;
  elsewhere: string | null;
  share: string;
  onShare: (typed: string) => void;
  difference: { text: string; tone: 'over' | 'under' | 'exact' };
  id: string;
}) {
  return (
    <div className="relative">
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X }} />
      )}
      <div className="flex flex-wrap items-center gap-3" style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <input
          id={id}
          type="checkbox"
          checked={ticked}
          onChange={(e) => onTick(e.target.checked)}
          className="ph-focus h-5 w-5 shrink-0 rounded accent-[var(--ph-tint)]"
        />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{name}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{subtitle}</span>
          {/* An item another receipt already answers is re-pointed by ticking it here, and its money goes with it.
              That is often what is meant — the wrong receipt was picked, or one was corrected — but it happened in
              silence, with nothing on the row saying where the money currently is. */}
          {elsewhere && <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{elsewhere}</span>}
        </label>
        {ticked ? (
          <span className="flex shrink-0 items-center gap-2">
            <input
              aria-label={`Share for ${name}`}
              inputMode="decimal"
              value={share}
              onChange={(e) => onShare(e.target.value)}
              className="ph-focus tabular w-32 rounded bg-transparent text-right text-[16px] leading-[20px] text-[var(--ph-ink)] md:text-[15px]"
            />
            <span className={cx('w-24 shrink-0 text-right text-[11.5px] font-semibold', toneClass(HERE[difference.tone]))}>{difference.text}</span>
          </span>
        ) : (
          <span className="shrink-0 text-[15px] text-[var(--ph-ink-3)]">—</span>
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
  const accounts = useAccounts().data ?? [];
  const rowId = useId();

  // itemId → the share as it is typed. A key that is present is a tick; absent is unticked.
  const [shares, setShares] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const items = (plan.data?.lines ?? []).flatMap((line) => line.items);
  const totalMinor = cover.data?.totalMinor ?? 0;
  const currency = ws.baseCurrency;

  /*
   * Seeded once, from what this receipt already answers: the stored shares are the truth about it, read owner-wide,
   * so a workspace tab can never make one look unspoken for. The item carried in `?item=` joins them at whatever is
   * still free, up to its own estimate — and when nothing is free it starts at its estimate instead, so the figures
   * below say in red that something else has to give it up rather than seeding a nought the repository must refuse.
   */
  useEffect(() => {
    if (seeded || !cover.data || !plan.data) return;
    const next: Record<string, string> = {};
    for (const row of cover.data.covers) next[row.itemId] = minorToMajorString(row.shareMinor, currency);
    const named = item ? (items.find((row) => row.id === item) ?? null) : null;
    if (named && next[named.id] === undefined) {
      const left = cover.data.totalMinor - cover.data.covers.reduce((total, row) => total + row.shareMinor, 0);
      next[named.id] = minorToMajorString(left > 0 ? Math.min(named.estimateMinor, left) : named.estimateMinor, currency);
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
      return { ...was, [row.id]: minorToMajorString(left > 0 ? Math.min(row.estimateMinor, left) : row.estimateMinor, currency) };
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
  const nameOf = (id: string | null) => (id === null ? null : (accounts.find((account) => account.id === id)?.name ?? id));
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

  /** The left-hand side of the last total: the words, and — while there is money over — what that money is. */
  const leftLabel: ReactNode = (
    <span className="inline-flex items-center gap-2">
      <span>Left on this receipt</span>
      {totals.leftMinor > 0 && <span className="text-[12.5px] font-semibold text-[var(--ph-warn)]">not planned</span>}
    </span>
  );

  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">
        <LargeTitle title="What it covers" back="Cancel" backTo={cancelTo.to} backParams={cancelTo.params} backSearch={cancelTo.search} actions={[saveAction]} />
        <ErrorBox error={error ?? events.error ?? plan.error ?? cover.error} />

        <InsetGroup header="The receipt">
          <InsetRow
            title={cover.data?.description ?? receipt?.description ?? 'This payment'}
            subtitle={[cover.data?.occurredOn ? dayMonth(cover.data.occurredOn) : null, paidWith].filter(Boolean).join(' · ')}
            value={formatMinor(totalMinor, currency)}
            valueTone="ink"
          />
        </InsetGroup>

        {/* No share box before the stored shares are seeded: a share typed first would be overwritten as they land. */}
        {!seeded ? (
          <p className="text-sm text-[var(--ph-ink-3)]">Loading…</p>
        ) : items.length === 0 ? (
          <Empty>This event has nothing on its plan yet, so there is nothing for the receipt to answer.</Empty>
        ) : (
          <InsetGroup header="What it paid for" footer="Tick everything this receipt paid for and give each its share. One receipt can settle many items.">
            {items.map((row) => (
              <CoverRow
                key={row.id}
                id={`${rowId}-${row.id}`}
                ticked={shares[row.id] !== undefined}
                onTick={(on) => toggle(row, on)}
                name={row.name}
                subtitle={`estimate ${formatMinor(row.estimateMinor, currency)}${row.categoryId ? ` · ${nameOf(row.categoryId)}` : ''}`}
                elsewhere={answeredElsewhere(row, transactionId)}
                share={shares[row.id] ?? ''}
                onShare={(typed) => setShares((was) => ({ ...was, [row.id]: typed }))}
                difference={differenceWords(typedMinor(row.id) - row.estimateMinor, currency)}
              />
            ))}
          </InsetGroup>
        )}

        <div data-testid="cover-totals">
          <InsetGroup header="Against the receipt">
            <InsetRow title="Receipt" value={formatMinor(totals.totalMinor, currency)} valueTone="ink" />
            <InsetRow title="Given to items" value={formatMinor(totals.givenMinor, currency)} valueTone="ink" />
            <InsetRow
              title={leftLabel}
              value={totals.over ? 'that is more than the receipt' : formatMinor(totals.leftMinor, currency)}
              valueTone={totals.over ? 'alarm' : 'ink'}
            />
          </InsetGroup>
        </div>

        <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Shares start at each item’s estimate; change them to what the receipt really says. Anything left over stays as spending in its category, marked “not
          planned”. The receipt itself is never split — your statement and points are untouched.
        </p>
      </div>
    </div>
  );
}
