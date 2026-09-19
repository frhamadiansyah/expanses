import { dayMonth, formatMinor } from '@expanses/core';
import { removeEventItem, unlinkEventItem } from '@expanses/db';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Pencil } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Money, PageHeader, Row, RowGroup, RowHint } from '../../ui';
import { differenceWords } from './plan-view';
import { useEventPlan } from './queries';

const TONE = { over: 'text-red-700', under: 'text-emerald-700', exact: 'text-slate-500' } as const;

/** A read-only row's value, so "—" for nothing said reads the same everywhere. */
const said = (value: ReactNode | null) => value ?? '—';

/**
 * One thing the event means to buy: what it is, what it is expected to cost, and what actually bought it.
 *
 * The item is found in the plan already on screen rather than fetched again — it is the same reading, so the two
 * can never disagree, and a tab that puts the purchase out of scope puts this item back on the list of things to buy
 * here too. A link is a plain anchor opened in a new tab: nothing in this app ever fetches one.
 */
export function ItemPage() {
  const { eventId, itemId } = useParams({ from: '/events/$eventId/plan/$itemId' });
  const { ws: tab } = useSearch({ from: '/events/$eventId/plan/$itemId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const plan = useEventPlan(eventId, tab ?? null);
  const accounts = useAccounts().data ?? [];
  const [error, setError] = useState<unknown>(null);

  const item = (plan.data?.lines ?? []).flatMap((line) => line.items).find((row) => row.id === itemId) ?? null;
  const search = { ws: tab };
  const nameOf = (id: string | null) => (id === null ? null : (accounts.find((account) => account.id === id)?.name ?? id));

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const back = (
    <Link
      to="/events/$eventId/plan"
      params={{ eventId }}
      search={search}
      aria-label="Back to the plan"
      className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800"
    >
      <ChevronLeft size={16} aria-hidden />
      Back to the plan
    </Link>
  );

  if (plan.isSuccess && !item) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="Item" />
        {back}
        <Empty>That item is no longer on this plan.</Empty>
      </div>
    );
  }

  const difference = item?.bought ? differenceWords(item.differenceMinor!, ws.baseCurrency) : null;
  const boughtElsewhere = item?.bought && item.boughtInCategoryId !== null && item.boughtInCategoryId !== item.categoryId;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={item?.name ?? 'Item'}
        controls={
          <Link
            to="/events/$eventId/plan/$itemId/edit"
            params={{ eventId, itemId }}
            search={search}
            aria-label="Edit"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70"
          >
            <Pencil size={20} aria-hidden />
          </Link>
        }
        action={
          <Link
            to="/events/$eventId/plan/$itemId/edit"
            params={{ eventId, itemId }}
            search={search}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Edit
          </Link>
        }
      />
      {back}
      <ErrorBox error={error ?? plan.error} />

      {item && (
        <>
          <Card>
            <div className="flex flex-col items-center gap-1 py-2 text-center">
              <Money
                minor={item.bought ? item.actualMinor! : item.estimateMinor}
                currency={ws.baseCurrency}
                className={cx('text-3xl font-semibold', !item.bought && 'text-slate-400')}
              />
              <span className="text-sm text-slate-500">
                <b className="font-semibold text-slate-700">{item.name}</b>
                {item.bought ? ` · ${item.description} · ${dayMonth(item.occurredOn!)}` : ' · estimate'}
              </span>
              {difference && <span className={cx('text-sm font-semibold', TONE[difference.tone])}>{difference.text}</span>}
              {boughtElsewhere && <span className="text-xs text-slate-500">bought in {nameOf(item.boughtInCategoryId)}</span>}
              {item.categoryId && !item.bought && (
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">{nameOf(item.categoryId)}</span>
              )}
            </div>
          </Card>

          <RowGroup>
            <Row label="How many" value={String(item.quantity)} />
            <Row label="Price each" value={formatMinor(item.unitPriceMinor, ws.baseCurrency)} />
            {/* Derived, never typed: there is no estimate field anywhere in this feature. */}
            <Row label="Estimate" value={formatMinor(item.estimateMinor, ws.baseCurrency)} />
            <Row label="Category" value={said(nameOf(item.categoryId) ?? 'Not in a category')} />
            <Row
              label="Link"
              value={
                item.link ? (
                  <a href={item.link} target="_blank" rel="noreferrer noopener" className="truncate text-sm text-blue-700 underline">
                    {item.link}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            <Row label="Note" value={said(item.note)} />
          </RowGroup>
          <RowHint>
            <b className="font-semibold">Name</b> is what the thing is. <b className="font-semibold">Note</b> is anything you want to remember about it.{' '}
            <b className="font-semibold">Estimate</b> is how many × price each, so 6 check-ups × Rp500.000 reads as Rp3.000.000.
          </RowHint>

          {item.bought ? (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">What bought it</h2>
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {item.description} · {dayMonth(item.occurredOn!)}
                </span>
                <Money minor={item.actualMinor!} currency={ws.baseCurrency} className="font-semibold" />
              </p>
              <Button variant="secondary" onClick={() => void run(() => unlinkEventItem(database, ws, item.id))}>
                Remove the link
              </Button>
              <p className="text-xs text-slate-500">The purchase stays on the event; it simply stops answering this item.</p>
            </Card>
          ) : (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">Already bought it?</h2>
              <p className="text-xs text-slate-500">
                Tick it off on the plan when the receipt is this item, or say what one receipt covers when it answers several. Both come from the event.
              </p>
            </Card>
          )}

          <div className="pt-1">
            <Button
              variant="danger"
              className="w-full"
              onClick={() =>
                void run(async () => {
                  await removeEventItem(database, ws, item.id);
                  await navigate({ to: '/events/$eventId/plan', params: { eventId }, search });
                })
              }
            >
              Remove this item
            </Button>
            <p className="mt-1 px-1 text-xs text-slate-500">Removing an item leaves any purchase alone — it becomes “not planned”.</p>
          </div>
        </>
      )}
    </div>
  );
}
