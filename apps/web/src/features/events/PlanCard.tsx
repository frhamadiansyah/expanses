import type { EventPlan } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Plus } from 'lucide-react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Card, Money } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCategoryWorkspaces } from '../workspaces/queries';
import { planCardRows } from './plan-view';

/** A row that is a way on: the same height and the same reach whether it is tapped or tabbed to. */
const ROW = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ring-slate-200 hover:bg-slate-50';

/**
 * What the event means to buy, under the chart that says what it has bought so far.
 *
 * The card holds only what was *planned*: a category is on it because it has items, never because money landed in
 * it. An event that planned the tickets and not the taxis therefore shows one row here and every category on the
 * chart above — which is the whole point, since the plan is per category and an unplanned category has no figure
 * for anything to be over.
 *
 * Every figure comes from `planCardRows`; nothing is added up on this screen.
 */
export function PlanCard({ eventId, plan, bookId }: { eventId: string; plan: EventPlan; bookId: string | null }) {
  const { ws } = useApp();
  const accounts = useAccounts().data ?? [];
  // Two workspaces can hold copies of one category — the same word twice — so a row says which one it belongs to.
  const workspaceOf = useCategoryWorkspaces();
  const currency = ws.baseCurrency;
  // The tab the event is being read in travels with the link, so the plan screens open in the same reading.
  const search = { ws: bookId ?? undefined };
  const rows = planCardRows(plan);

  return (
    <div data-testid="event-plan-card">
      <Card className="space-y-2">
        {plan.hasPlan ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Plan</h2>
              {/* The two figures of the ring's own page, so the card and the chart cannot say different things. */}
              <span className="text-xs text-slate-500">
                <Money minor={Math.max(0, plan.plannedSpentMinor)} currency={currency} className="font-semibold text-slate-900" /> of{' '}
                <Money minor={plan.plannedMinor} currency={currency} />
              </span>
            </div>
            {rows.map((row) => (
              <div key={row.categoryId ?? 'none'} className="flex items-center gap-3">
                <CategoryIcon categoryId={row.categoryId} accounts={accounts} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {row.categoryId === null ? row.name : (workspaceOf(row.categoryId) ? `${row.name} · ${workspaceOf(row.categoryId)}` : row.name)}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{row.subline}</span>
                </span>
                <span className="shrink-0 text-right">
                  <Money minor={row.plannedMinor} currency={currency} className="block text-sm font-semibold" />
                  <span className="block text-[11.5px] text-slate-500">planned</span>
                </span>
              </div>
            ))}
            <Link to="/events/$eventId/plan" params={{ eventId }} search={search} data-testid="open-plan" className={ROW}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">See the whole plan</span>
                <span className="block text-xs text-slate-500">tick things off, add items</span>
              </span>
              <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
            </Link>
            <Link to="/events/$eventId/plan/new" params={{ eventId }} search={search} className={ROW}>
              <Plus size={16} aria-hidden className="shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Add an item</span>
                <span className="block text-xs text-slate-500">plan another thing, in any category</span>
              </span>
            </Link>
          </>
        ) : (
          <>
            <Link to="/events/$eventId/plan" params={{ eventId }} search={search} data-testid="open-plan" className={ROW}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Plan what to buy</span>
                <span className="block text-xs text-slate-500">turn this into a list with estimates</span>
              </span>
              <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
            </Link>
            {/* Said plainly, because the chart above is a complete answer on its own: an event may simply be tagged. */}
            <p className="text-xs text-slate-500">An event needs no plan. Without one it simply adds up what was tagged to it.</p>
          </>
        )}
      </Card>
    </div>
  );
}
