import { type EventPlan, formatMinor } from '@expanses/core';
import type { SharedEventView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { itemFigure, itemPaidAgainst, itemSubtitle } from './plan-view';
import { PlanCategoryCard, PlanHeroBody } from './PlanPage';
import { SharedCategoryMark } from './SharedCostPages';
import { sharedPlanHero, type SharedPlanItem } from './shared-plan';
import { pageLocks } from './shared-view';

/**
 * The Plan card of the shared trip's hero: the private plan's ring card, fed from the shared items in the one currency
 * of the trip (so no base equivalents). With no items it says so; a cost is added from the ＋ in the bar.
 */
export function SharedPlanHero({ view, plan }: { view: SharedEventView; plan: EventPlan | null | undefined }) {
  const card = 'flex flex-1 flex-col justify-center rounded-[11px] bg-[var(--ph-surface)]';
  if (!plan || plan.itemCount === 0) {
    return (
      <div className={card} data-testid="plan-totals">
        <p className="px-[14px] py-[14px] text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing planned yet. Add what is planned to pay and roughly what it costs.</p>
      </div>
    );
  }
  return (
    <div className={card} data-testid="plan-totals">
      <PlanHeroBody {...sharedPlanHero(plan, view.currency)} />
    </div>
  );
}

/** One thing on the shared plan, drawn as the private plan's checklist line is; the whole row opens the cost's page. */
function SharedPlanRow({ item, currency, onOpen }: { item: SharedPlanItem; currency: string; onOpen: (() => void) | null }) {
  const against = itemPaidAgainst(item, currency, currency);
  const subtitle = itemSubtitle(item, currency, currency);
  const content = (
    <>
      <span
        aria-hidden
        className={cx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          item.done ? 'bg-[var(--ph-up-panel)] text-[var(--ph-up)]' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset',
        )}
      >
        {item.done && <Check size={15} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--ph-ink)]">{item.name}</span>
        {subtitle && <span className="block truncate text-xs text-[var(--ph-ink-3)]">{subtitle}</span>}
      </span>
      <span className="tabular shrink-0 text-right text-sm font-semibold whitespace-nowrap text-[var(--ph-ink)]">
        {against?.arrow && (
          <span
            role="img"
            aria-label={against.arrow === 'under' ? 'Under the estimate' : 'Over the estimate'}
            className={cx('mr-[5px] text-[10px]', against.arrow === 'under' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-alarm)]')}
          >
            <span aria-hidden>{against.arrow === 'under' ? '▼' : '▲'}</span>
          </span>
        )}
        {itemFigure(item, currency, currency)}
        {against && <span className="block text-[11.5px] leading-[14px] font-normal text-[var(--ph-ink-3)]">{against.of}</span>}
      </span>
    </>
  );
  const line = 'flex min-h-12 w-full items-center gap-3 px-[14px] py-2 text-left';
  return onOpen ? (
    <button type="button" onClick={onOpen} aria-label={item.name} data-testid="shared-plan-item" className={cx(line, 'ph-focus-inset')}>
      {content}
    </button>
  ) : (
    <div className={line} role="group" aria-label={item.name} data-testid="shared-plan-item">
      {content}
    </div>
  );
}

/**
 * The shared plan (D7) under the hero: what the trip means to buy, in the event currency, a card per category as the
 * private plan lists them — the category's mark and name, how many of its costs are paid, then its costs, still to pay
 * first. A tap on a cost opens its page (I10: a mistyped price, or a cost paid without Pay now, is put right there on
 * every phone); the ＋ in the bar, on the Plan card, adds one.
 */
export function SharedPlanTab({ view, plan, error: planError = null }: { view: SharedEventView; plan: EventPlan | null | undefined; error?: unknown }) {
  const navigate = useNavigate();
  const { locked } = pageLocks(view);
  const rp = (minor: number) => formatMinor(minor, view.currency);
  const lines = (plan?.lines ?? []).filter((line) => line.items.length > 0);

  return (
    <>
      <ErrorBox error={planError} />
      {plan && plan.itemCount === 0 && !locked ? (
        <>
          <Empty>Nothing planned yet. Add what is planned to pay and roughly what it costs.</Empty>
          <InsetGroup>
            <InsetRow title="Add the first cost" to="/events/$eventId/shared-plan/new" params={{ eventId: view.eventId }} />
          </InsetGroup>
        </>
      ) : null}
      {lines.map((line) => {
        const paid = line.items.reduce((total, item) => total + (item.paidEventMinor ?? 0), 0);
        const ordered = [...line.items.filter((item) => !item.bought), ...line.items.filter((item) => item.bought)];
        return (
          <PlanCategoryCard
            key={line.categoryId ?? 'none'}
            mark={<SharedCategoryMark categoryId={line.categoryId} categories={view.categories} />}
            name={line.name}
            itemCount={line.items.length}
            boughtCount={line.items.filter((item) => item.bought).length}
            paid={rp(paid)}
            planned={rp(line.plannedEventMinor)}
          >
            {ordered.map((item) => (
              <SharedPlanRow
                key={item.id}
                item={item}
                currency={view.currency}
                onOpen={locked ? null : () => void navigate({ to: '/events/$eventId/shared-plan/$itemId', params: { eventId: view.eventId, itemId: item.id }, search: {} })}
              />
            ))}
          </PlanCategoryCard>
        );
      })}
    </>
  );
}
