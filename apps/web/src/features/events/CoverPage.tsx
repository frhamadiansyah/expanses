import { dayMonth, type EventPlanItemView, formatMinor, minorToMajorString, parseMajor } from '@expanses/core';
import { setPurchaseCover } from '@expanses/db';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Input, Money, PageHeader } from '../../ui';
import { coverTotals, differenceWords } from './plan-view';
import { useEventHistory, useEventPlan, useEvents, usePurchaseCover } from './queries';

const TONE = { over: 'text-red-700', under: 'text-emerald-700', exact: 'text-slate-500' } as const;

/** Half-typed digits are not an error, only a figure that is not there yet: nought until the whole of it parses. */
function minorOf(typed: string, currency: string): number {
  try {
    return parseMajor(typed, currency);
  } catch {
    return 0;
  }
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
  const plan = useEventPlan(eventId, tab ?? null);
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

  const saveButton = (
    <Button onClick={() => void save()} disabled={unsaveable || saving || !cover.isSuccess}>
      Save
    </Button>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="What it covers" controls={saveButton} action={saveButton} />
      <Link {...cancelTo} className="-mt-2 block min-h-11 py-3 text-sm font-medium text-slate-600 hover:text-slate-900">
        Cancel
      </Link>
      <ErrorBox error={error ?? events.error ?? plan.error ?? cover.error} />

      <Card>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{cover.data?.description ?? receipt?.description ?? 'This payment'}</span>
            <span className="block truncate text-xs text-slate-500">
              {cover.data?.occurredOn ? dayMonth(cover.data.occurredOn) : ''}
              {paidWith && ` · ${paidWith}`}
            </span>
          </span>
          <Money minor={totalMinor} currency={currency} className="shrink-0 text-base font-semibold" />
        </div>
      </Card>

      <p className="px-1 text-sm text-slate-500">Tick everything this receipt paid for and give each its share. One receipt can settle many items.</p>

      {items.length === 0 ? (
        <Empty>This event has nothing on its plan yet, so there is nothing for the receipt to answer.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {items.map((row) => {
              const on = shares[row.id] !== undefined;
              const difference = differenceWords(typedMinor(row.id) - row.estimateMinor, currency);
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <input
                    id={`${rowId}-${row.id}`}
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(row, e.target.checked)}
                    className="h-5 w-5 shrink-0 rounded border-slate-300 accent-slate-900"
                  />
                  <label htmlFor={`${rowId}-${row.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      estimate {formatMinor(row.estimateMinor, currency)}
                      {row.categoryId && ` · ${nameOf(row.categoryId)}`}
                    </span>
                  </label>
                  {on ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <Input
                        aria-label={`Share for ${row.name}`}
                        inputMode="decimal"
                        value={shares[row.id] ?? ''}
                        onChange={(e) => setShares((was) => ({ ...was, [row.id]: e.target.value }))}
                        className="w-36 text-right"
                      />
                      <span className={cx('w-24 shrink-0 text-right text-[11.5px] font-semibold', TONE[difference.tone])}>{difference.text}</span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm text-slate-400">—</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div data-testid="cover-totals">
        <Card className="space-y-1">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-500">Receipt</span>
            <Money minor={totals.totalMinor} currency={currency} className="font-semibold" />
          </p>
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-500">Given to items</span>
            <Money minor={totals.givenMinor} currency={currency} className="font-semibold" />
          </p>
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-slate-500">
              Left on this receipt
              {/* The amber pill the plan uses for the same money: what the receipt bought that no item planned for. */}
              {totals.leftMinor > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">not planned</span>
              )}
            </span>
            {totals.over ? (
              <span className="text-sm font-semibold text-red-700">that is more than the receipt</span>
            ) : (
              <Money minor={totals.leftMinor} currency={currency} className="font-semibold" />
            )}
          </p>
        </Card>
      </div>

      <p className="px-1 text-xs text-slate-500">
        Shares start at each item’s estimate; change them to what the receipt really says. Anything left over stays as spending in its category, marked “not
        planned”. The receipt itself is never split — your statement and points are untouched.
      </p>
    </div>
  );
}
