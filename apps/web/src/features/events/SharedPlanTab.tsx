import { type EventPlan, parseMajor } from '@expanses/core';
import { ownerScope, saveSharedItem, type SharedEventView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, Panel, SubmitRow, TextRow } from '../../ui/native';
import { buyTarget } from './buy-item';
import { itemFigure, itemPaidAgainst, itemSubtitle } from './plan-view';
import { PlanHeroBody } from './PlanPage';
import { SharedItemSheet } from './SharedItemSheet';
import { sharedPlanHero, type SharedPlanItem } from './shared-plan';
import { pageLocks } from './shared-view';

/**
 * The Plan card of the shared trip's hero: the private plan's ring card, fed from the shared items in the one currency
 * of the trip (so no base equivalents). With no items it says so; the form to add one is under the hero.
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

/** One thing on the shared plan, drawn as the private plan's checklist line is; the whole row opens the item. */
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
 * The shared plan (D7) under the hero: what the trip means to buy, in the event currency, as a flat To pay list. A tap on an
 * item opens it — its name and price, what bought it (the tick), Buy it now, and Remove — so a mistyped price or an item
 * bought without Buy it now is put right on every phone (I10).
 */
export function SharedPlanTab({ view, plan, error: planError = null }: { view: SharedEventView; plan: EventPlan | null | undefined; error?: unknown }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [opened, setOpened] = useState<SharedPlanItem | null>(null);
  const all = (plan?.lines ?? []).flatMap((line) => line.items);
  // Still to pay first, paid after, as the private plan lists them.
  const items = [...all.filter((item) => !item.done), ...all.filter((item) => item.done)];
  const { locked } = pageLocks(view);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await saveSharedItem(database, ownerScope(ws), view.eventId, { name, quantity: 1, unitPriceMinor: parseMajor(price, view.currency), categoryId: null, link: null, note: null });
      setName('');
      setPrice('');
      await invalidate();
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <>
      <ErrorBox error={planError} />
      {items.length > 0 ? (
        <Panel header="To pay" pad={false}>
          <div className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
            {items.map((item) => (
              <SharedPlanRow key={item.id} item={item} currency={view.currency} onOpen={locked ? null : () => setOpened(item)} />
            ))}
          </div>
        </Panel>
      ) : null}
      {locked ? null : (
        <form aria-label="Add to the plan" onSubmit={(event) => void add(event)}>
          <InsetGroup>
            <TextRow label="What to pay" value={name} onChange={(e) => setName(e.target.value)} />
            <TextRow label={`Price (${view.currency})`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </InsetGroup>
          <InsetGroup>
            <SubmitRow label="Add to the plan" disabled={!name.trim() || !price.trim()} />
          </InsetGroup>
          <ErrorBox error={error} />
        </form>
      )}
      {opened ? (
        <SharedItemSheet
          view={view}
          item={opened}
          onBuy={() => {
            setOpened(null);
            void navigate(buyTarget(view.eventId, opened.id));
          }}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </>
  );
}
