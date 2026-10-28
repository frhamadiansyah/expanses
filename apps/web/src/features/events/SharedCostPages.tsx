import { CURRENCIES, dayMonth, formatMinor, groupTypedAmount, minorToMajorString, parseMajor } from '@expanses/core';
import { linkSharedItem, ownerScope, removeSharedItem, saveSharedItem, setSharedItemDone, addSharedItemPurchase, type SharedEventView } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check, CircleEllipsis, Pencil } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { DestructiveRow, GROUP_RADIUS, InsetGroup, InsetRow, PushedTitle, ReadOnlyRow, SwitchRow, TextRow, type CornerAction } from '../../ui/native';
import { CategoryIcon, ICONS, MarkChip } from '../categories/CategoryIcon';
import { chartColour } from '../transactions/category-colours';
import { spacedMinor } from './amount-text';
import { buyTarget } from './buy-item';
import { CategoryPickRow, CategorySheet, EstimateRow, minorOf, wholeOf } from './ItemFormPage';
import { itemFigure } from './plan-view';
import { defaultPart, itemChanges, type SharedPlanItem, tickChoices } from './shared-plan';
import { useSharedEventPlan, useSharedEventView } from './shared-queries';
import { pageLocks } from './shared-view';

/*
 * The shared trip's cost, drawn as the private plan's cost is: a page for the cost, a form that makes and edits it, and
 * a chooser for the payment already on the trip that paid it. Every write is `saveSharedItem` and its neighbours — the
 * event's own sync — so a change reaches every phone exactly as the old sheet's did.
 */

type SharedCategories = SharedEventView['categories'];

/** A shared trip's category mark: its own icon in the colour the spending ring draws it in; the unknown mark when none. */
export function SharedCategoryMark({ categoryId, categories, size = 'row' }: { categoryId: string | null; categories: SharedCategories; size?: 'row' | 'tile' }) {
  const category = categoryId ? categories.find((c) => c.categoryId === categoryId) : undefined;
  if (!category) return <CategoryIcon categoryId={null} accounts={[]} size={size} />;
  return <MarkChip Glyph={ICONS[category.icon ?? 'circle-ellipsis'] ?? CircleEllipsis} colour={chartColour(category.categoryId)} size={size} />;
}

/** Where the ways out of these pages land: the trip, on its Plan card. */
const toPlan = (eventId: string) => ({ to: '/events/$eventId' as const, params: { eventId }, search: { card: 'plan' as const } });

function screen(children: ReactNode) {
  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );
}

/** One column of the price strip: a small grey label over the figure, both from the column's left edge. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 border-l-[0.5px] border-[var(--ph-hair)] px-[14px] py-3 first:border-l-0">
      <span className="block text-[12px] leading-[16px] text-[var(--ph-ink-3)]">{label}</span>
      <span className="tabular mt-[3px] block break-words text-[16px] leading-[20px] font-semibold text-[var(--ph-ink)]">{value}</span>
    </div>
  );
}

/** The trip and one of its costs, read from the same two queries the trip page reads. */
function useSharedCost(eventId: string, itemId: string | undefined) {
  const view = useSharedEventView(eventId);
  const plan = useSharedEventPlan(eventId);
  const item = itemId ? ((plan.data?.lines ?? []).flatMap((line) => line.items).find((row) => row.id === itemId) ?? null) : null;
  return { view, plan, item };
}

/** A page whose trip or cost has gone still owes a way back that is not the browser's. */
function gone(eventId: string, title: string, what: string) {
  return screen(
    <>
      <PushedTitle title={title} back="Back to the plan" backTo="/events/$eventId" backParams={{ eventId }} backSearch={{ card: 'plan' }} />
      <Empty>{what}</Empty>
    </>,
  );
}

/**
 * One cost of the shared trip: the private cost page's design on the trip's own data. An identity block (the category's
 * mark, the name, one grey line), the price strip, Details (link and remarks, only those that exist), the Paid group (only
 * once something is), the two ways to pay and the Settled switch. A payment is an expense of the trip, so its row is plain: there is no
 * shared "Link to costs" to open from it. No sentence explains any of it; Delete is at the foot of the edit form.
 */
export function SharedCostPage() {
  const { eventId, itemId } = useParams({ from: '/events/$eventId/shared-plan/$itemId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const { view, plan, item } = useSharedCost(eventId, itemId);
  const [error, setError] = useState<unknown>(null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const back = { back: 'Back to the plan', backTo: '/events/$eventId', backParams: { eventId }, backSearch: { card: 'plan' } } as const;
  if (view.isSuccess && !view.data) return gone(eventId, 'Cost', 'That event is no longer here.');
  if (!view.data || !plan.data) return screen(<><PushedTitle title="" {...back} /><ErrorBox error={view.error ?? plan.error} /></>);
  if (!item) return gone(eventId, 'Cost', 'That cost is no longer on this plan.');

  const trip = view.data;
  const currency = trip.currency;
  const { locked } = pageLocks(trip);
  const category = trip.categories.find((c) => c.categoryId === item.categoryId)?.name ?? null;
  const total = formatMinor(item.estimateMinor, currency);
  const paid = item.purchases.length > 0;
  const status = item.done ? 'Settled' : item.purchaseCount > 0 ? `${itemFigure(item, currency, currency)} of ${total} paid` : 'Unpaid';
  const edit: CornerAction = {
    key: 'edit',
    label: 'Edit',
    glyph: <Pencil size={18} aria-hidden />,
    to: '/events/$eventId/shared-plan/$itemId/edit',
    params: { eventId, itemId },
  };

  return screen(
    <>
      {/* No title in the bar: the name is the identity block's. */}
      <PushedTitle title="" {...back} actions={locked ? [] : [edit]} />
      <ErrorBox error={error ?? plan.error} />

      <section
        className="mb-3 flex flex-col items-center bg-[var(--ph-surface)] px-[14px] pt-4 pb-[14px] text-center"
        style={{ borderRadius: GROUP_RADIUS }}
        data-testid="item-identity"
      >
        <SharedCategoryMark categoryId={item.categoryId} categories={trip.categories} size="tile" />
        <h2 className="mt-2 max-w-full break-words text-[20px] leading-[26px] font-bold text-[var(--ph-ink)]">{item.name}</h2>
        <p data-testid="item-status" className="mt-1 text-[14px] leading-[18px] text-[var(--ph-ink-3)]">
          {[status, category].filter(Boolean).join(' · ')}
        </p>
      </section>

      <div className="mb-3 flex bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }} data-testid="item-figures">
        <Figure label="Price each" value={formatMinor(item.unitPriceMinor, currency)} />
        <Figure label="How many" value={String(item.quantity)} />
        <Figure label="Total" value={total} />
      </div>

      {(item.link || item.note) && (
        <InsetGroup header="Details">
          {item.link ? (
            <InsetRow
              title="Purchase link"
              plain
              value={
                <a href={item.link} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[55vw] items-center md:max-w-[26rem]">
                  <span className="truncate">{item.link}</span>
                  <span aria-hidden className="ml-1 shrink-0">↗</span>
                </a>
              }
            />
          ) : null}
          {item.note ? <ReadOnlyRow label="Remarks" value={item.note} /> : null}
        </InsetGroup>
      )}

      {paid && (
        <InsetGroup header="Paid">
          {item.purchases.map((purchase) => {
            const expense = trip.expenses.find((e) => e.expenseId === purchase.transactionId);
            return (
              <InsetRow
                key={purchase.transactionId}
                testId="item-payment"
                plain
                title={expense ? `${dayMonth(expense.occurredOn)} · ${expense.note ?? expense.categoryName ?? 'Shared spending'}` : 'Another payment'}
                value={formatMinor(purchase.shareMinor, currency)}
                valueTone="ink"
              />
            );
          })}
          {locked ? null : (
            <InsetRow
              title={item.purchases.length === 1 ? 'Unlink payment' : 'Unlink every payment'}
              // Every payment off puts the cost back on the list: nothing is left to say it was paid.
              onClick={() => void run(() => linkSharedItem(database, ownerScope(ws), eventId, item.id, null))}
              action
            />
          )}
        </InsetGroup>
      )}

      {!item.bought && !locked && (
        <InsetGroup>
          <InsetRow title={paid ? 'Add payment' : 'Pay now'} onClick={() => void navigate(buyTarget(eventId, item.id))} action />
          <InsetRow title="Link a payment" to="/events/$eventId/shared-plan/$itemId/link" params={{ eventId, itemId }} action />
        </InsetGroup>
      )}

      {/* The mark itself, not the reading: a cost marked settled stays so with no payment on it. */}
      {(paid || item.done) && !locked && (
        <InsetGroup>
          <SwitchRow
            label="Settled"
            checked={item.done}
            onChange={(on) => void run(() => setSharedItemDone(database, ownerScope(ws), eventId, item.id, on))}
            testId="item-settled"
          />
        </InsetGroup>
      )}
    </>,
  );
}

export function NewSharedCostRoute() {
  const { eventId } = useParams({ from: '/events/$eventId/shared-plan/new' });
  return <SharedCostFormPage key={`new-${eventId}`} eventId={eventId} />;
}

export function EditSharedCostRoute() {
  const { eventId, itemId } = useParams({ from: '/events/$eventId/shared-plan/$itemId/edit' });
  return <SharedCostFormPage key={itemId} eventId={eventId} itemId={itemId} />;
}

/**
 * The form that makes one cost of the shared trip, and the same form that edits it: What, How many, Price each (in the
 * trip's one currency), the estimate they come to, the category from the trip's own grid, Purchase link and Remarks.
 * An edit carries the cost's id so the row is updated in place; Delete is the last row, and asks only when payments
 * are on the cost.
 */
export function SharedCostFormPage({ eventId, itemId }: { eventId: string; itemId?: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const { view, plan, item: existing } = useSharedCost(eventId, itemId);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [pickingCategory, setPickingCategory] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const currency = view.data?.currency ?? ws.baseCurrency;

  // Filled once the cost being edited has arrived; not kept in sync after, so typing is never clobbered.
  useEffect(() => {
    if (!itemId || loaded || !existing || !view.data) return;
    setName(existing.name);
    setQuantity(String(existing.quantity));
    setPrice(groupTypedAmount(minorToMajorString(existing.unitPriceMinor, view.data.currency).replace('.', ','), view.data.currency));
    setCategoryId(existing.categoryId ?? '');
    setLink(existing.link ?? '');
    setNote(existing.note ?? '');
    setLoaded(true);
  }, [itemId, loaded, existing, view.data]);

  const title = itemId ? 'Edit cost' : 'New cost';
  const back = itemId
    ? ({ to: '/events/$eventId/shared-plan/$itemId', params: { eventId, itemId }, search: {} } as const)
    : ({ to: '/events/$eventId', params: { eventId }, search: { card: 'plan' } } as const);

  if (view.isSuccess && !view.data) return gone(eventId, title, 'That event is no longer here.');
  if (!view.data || !plan.data) return screen(<><PushedTitle title={title} back="Cancel" backTo="/events/$eventId" backParams={{ eventId }} backSearch={{ card: 'plan' }} /><ErrorBox error={view.error ?? plan.error} /></>);
  if (itemId && !existing) return gone(eventId, title, 'That cost is no longer on this plan.');
  if (itemId && !loaded) return screen(<><PushedTitle title={title} back="Cancel" backTo="/events/$eventId" backParams={{ eventId }} backSearch={{ card: 'plan' }} /><p className="text-sm text-[var(--ph-ink-3)]">Loading…</p></>);

  const trip = view.data;
  // A category archived since still names the cost that holds it, so it stays in the grid while chosen.
  const options = trip.categories
    .filter((c) => !c.archived || c.categoryId === categoryId)
    .map((c) => ({ id: c.categoryId, name: c.name, mark: <SharedCategoryMark categoryId={c.categoryId} categories={trip.categories} size="tile" /> }));
  const chosen = trip.categories.find((c) => c.categoryId === categoryId);
  const estimateMinor = wholeOf(quantity) * minorOf(price, currency);

  async function save() {
    setError(null);
    try {
      const id = await saveSharedItem(database, ownerScope(ws), eventId, {
        id: itemId,
        name,
        quantity: wholeOf(quantity),
        unitPriceMinor: parseMajor(price, currency),
        categoryId: categoryId || null,
        link: link.trim() || null,
        note: note.trim() || null,
      });
      await invalidate();
      await navigate(itemId ? { to: '/events/$eventId/shared-plan/$itemId', params: { eventId, itemId: id }, search: {}, replace: true } : { ...toPlan(eventId), replace: true });
    } catch (e) {
      setError(e);
    }
  }

  /** Payments stay on the trip as expenses; with any linked, the user is asked first. */
  async function remove(row: SharedPlanItem) {
    if (row.purchases.length > 0 && !window.confirm(`Delete ${row.name}? Its payments stay in the event.`)) return;
    setError(null);
    try {
      await removeSharedItem(database, ownerScope(ws), eventId, row.id);
      await invalidate();
      await navigate({ ...toPlan(eventId), replace: true });
    } catch (e) {
      setError(e);
    }
  }

  const saveAction: CornerAction = { key: 'save', label: 'Save', glyph: <Check size={22} aria-hidden />, run: () => void save() };

  return screen(
    <>
      {/* Back off a form is Cancel: the one word that says what leaving it does to what has been typed. */}
      <PushedTitle title={title} back="Cancel" backTo={back.to} backParams={back.params} backSearch={back.search} actions={[saveAction]} />
      <ErrorBox error={error} />
      <form
        id="item-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <InsetGroup>
          <TextRow label="What" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cost name" />
          <TextRow label="How many" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" placeholder="Quantity" />
          <TextRow
            label="Price each"
            value={price}
            onChange={(e) => setPrice(groupTypedAmount(e.target.value, currency))}
            inputMode="decimal"
            placeholder="Amount"
            prefix={CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency}
          />
          <EstimateRow value={spacedMinor(estimateMinor, currency)} />
        </InsetGroup>
        <InsetGroup>
          <CategoryPickRow
            mark={<SharedCategoryMark categoryId={categoryId || null} categories={trip.categories} />}
            name={chosen?.name ?? null}
            onOpen={() => setPickingCategory(true)}
          />
          <TextRow label="Purchase link" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="Web address" />
          <TextRow label="Remarks" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
        </InsetGroup>
      </form>
      {existing && (
        <InsetGroup>
          <DestructiveRow label="Delete" onClick={() => void remove(existing)} />
        </InsetGroup>
      )}
      {pickingCategory && <CategorySheet options={options} current={categoryId} onPick={setCategoryId} onClose={() => setPickingCategory(false)} />}
    </>,
  );
}

/**
 * Which payment of the trip paid this cost: its expenses not already part of it, each tapped to be chosen, then its
 * part of the expense — offered as the cost's estimate, never more than the expense — and the corner ✓ writes it.
 */
export function SharedCostLinkPage() {
  const { eventId, itemId } = useParams({ from: '/events/$eventId/shared-plan/$itemId/link' });
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const { view, plan, item } = useSharedCost(eventId, itemId);
  const [expenseId, setExpenseId] = useState('');
  const [part, setPart] = useState('');
  const [error, setError] = useState<unknown>(null);

  const back = { back: 'Back to the cost', backTo: '/events/$eventId/shared-plan/$itemId', backParams: { eventId, itemId }, backSearch: {} } as const;
  if (view.isSuccess && !view.data) return gone(eventId, 'Link a payment', 'That event is no longer here.');
  if (!view.data || !plan.data) return screen(<><PushedTitle title="Link a payment" {...back} /><ErrorBox error={view.error ?? plan.error} /></>);
  if (!item) return gone(eventId, 'Link a payment', 'That cost is no longer on this plan.');

  const trip = view.data;
  const currency = trip.currency;
  const choices = tickChoices(trip).filter((c) => !item.purchases.some((p) => p.transactionId === c.expenseId));

  function choose(id: string) {
    const picked = choices.find((c) => c.expenseId === id);
    setExpenseId(id);
    setPart(picked && item ? minorToMajorString(defaultPart(item, picked.eventAmountMinor), currency) : '');
  }

  async function save() {
    if (!item) return;
    setError(null);
    try {
      const { add } = itemChanges(item, { name: item.name, price: minorToMajorString(item.unitPriceMinor, currency), expenseId, part }, currency);
      if (add) await addSharedItemPurchase(database, ownerScope(ws), eventId, item.id, add);
      await invalidate();
      await navigate({ to: '/events/$eventId/shared-plan/$itemId', params: { eventId, itemId }, search: {}, replace: true });
    } catch (e) {
      setError(e);
    }
  }

  const saveAction: CornerAction = { key: 'save', label: 'Save', glyph: <Check size={22} aria-hidden />, run: () => void save(), disabled: !expenseId || !part.trim() };

  return screen(
    <>
      <PushedTitle title="Link a payment" {...back} actions={[saveAction]} />
      <ErrorBox error={error} />
      {choices.length === 0 ? (
        <Empty>No payment on this trip is left to link.</Empty>
      ) : (
        <InsetGroup header="Paid on this trip">
          {choices.map((c) => (
            <InsetRow
              key={c.expenseId}
              testId="link-choice"
              plain
              title={c.label}
              label={c.label}
              onClick={() => choose(c.expenseId)}
              value={expenseId === c.expenseId ? <Check size={18} aria-label="Chosen" /> : undefined}
              valueTone="ink"
            />
          ))}
        </InsetGroup>
      )}
      {expenseId ? (
        <InsetGroup>
          <TextRow label="Its part" value={part} onChange={(e) => setPart(e.target.value)} inputMode="decimal" placeholder="Amount" prefix={currency} />
        </InsetGroup>
      ) : null}
    </>,
  );
}
