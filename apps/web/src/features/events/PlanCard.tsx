import { formatMinor, type EventPlan } from '@expanses/core';
import { useApp } from '../../app/context';
import { InsetGroup, InsetRow, type GroupChild, type InsetRowProps } from '../../ui/native';
import { useCategoryWorkspaces } from '../workspaces/queries';
import { planCardRows, planTotals } from './plan-view';

/** The way into the plan, wrapped so the test id rides on it and the group can still hand it its separator. */
function WayIn({ position, ...row }: GroupChild & InsetRowProps) {
  return (
    <div data-testid="open-plan">
      <InsetRow {...row} position={position} />
    </div>
  );
}

/**
 * What the event means to buy, under the chart that says what it has bought so far.
 *
 * The group holds only what was *planned*: a category is on it because it has items, never because money landed in
 * it. An event that planned the tickets and not the taxis therefore shows one row here and every category on the
 * chart above — which is the whole point, since the plan is per category and an unplanned category has no figure
 * for anything to be over.
 *
 * Every figure comes from `planCardRows` or `planTotals`; nothing is added up or clamped on this screen.
 */
export function PlanCard({ eventId, plan, bookId }: { eventId: string; plan: EventPlan; bookId: string | null }) {
  const { ws } = useApp();
  // Two workspaces can hold copies of one category — the same word twice — so a row says which one it belongs to.
  const workspaceOf = useCategoryWorkspaces();
  const currency = ws.baseCurrency;
  // The tab the event is being read in travels with the link, so the plan screens open in the same reading.
  const search = { ws: bookId ?? undefined };
  const rows = planCardRows(plan);
  // The header's two figures, from the one place that says what they are: clamping here for itself is how this
  // card came to print Rp0 beside a ring drawing −Rp1.000.000 of the very same quantity.
  const totals = planTotals(plan);
  const rp = (minor: number) => formatMinor(minor, currency);

  return (
    <div data-testid="event-plan-card">
      {plan.hasPlan ? (
        <InsetGroup
          header="Plan"
          /* The two figures of the ring's own page, so the group and the chart cannot say different things. */
          trailing={`${rp(totals.plannedSpentMinor)} of ${rp(totals.plannedMinor)}`}
        >
          {rows.map((row) => (
            <InsetRow
              key={row.categoryId ?? 'none'}
              title={row.categoryId === null ? row.name : workspaceOf(row.categoryId) ? `${row.name} · ${workspaceOf(row.categoryId)}` : row.name}
              subtitle={row.subline}
              value={
                <span className="block text-right">
                  <span className="block">{rp(row.plannedMinor)}</span>
                  <span className="block text-[11.5px] leading-[14px] font-semibold text-[var(--ph-ink-3)]">planned</span>
                </span>
              }
              valueTone="ink"
            />
          ))}
          <WayIn
            title="See the whole plan"
            subtitle="tick things off, add items"
            to="/events/$eventId/plan"
            params={{ eventId }}
            search={search}
          />
          <InsetRow title="Add an item" subtitle="plan another thing, in any category" to="/events/$eventId/plan/new" params={{ eventId }} search={search} />
        </InsetGroup>
      ) : (
        /* Said plainly, because the chart above is a complete answer on its own: an event may simply be tagged. */
        <InsetGroup footer="An event needs no plan. Without one it simply adds up what was tagged to it.">
          <WayIn title="Plan what to buy" subtitle="turn this into a list with estimates" to="/events/$eventId/plan" params={{ eventId }} search={search} />
        </InsetGroup>
      )}
    </div>
  );
}
