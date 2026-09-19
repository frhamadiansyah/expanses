import { formatMinor, minorToMajorString, parseMajor } from '@expanses/core';
import { listEventItems, saveEventItem } from '@expanses/db';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { useCategorySetMembership, useSetCategories } from '../categories/set-queries';
import { useCategoryWorkspaces } from '../workspaces/queries';
import { afterSaving, itemFormGate } from './plan-view';
import { useEventItemsReady, useEventPlan, useEvents } from './queries';

/** The way back off a screen whose subject has gone, styled as the back link every other plan screen carries. */
const BACK = '-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800';

export function NewItemRoute() {
  const { eventId } = useParams({ from: '/events/$eventId/plan/new' });
  const { ws } = useSearch({ from: '/events/$eventId/plan/new' });
  return <ItemFormPage key={`new-${eventId}`} eventId={eventId} tab={ws} />;
}

export function EditItemRoute() {
  const { eventId, itemId } = useParams({ from: '/events/$eventId/plan/$itemId/edit' });
  const { ws } = useSearch({ from: '/events/$eventId/plan/$itemId/edit' });
  return <ItemFormPage key={itemId} eventId={eventId} tab={ws} itemId={itemId} />;
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
 * How many is a whole count, so anything else reads as none yet rather than as a fraction of a thing.
 *
 * Nought is what the screen shows for `0`, `2.5` or `abc`, and nought is what is sent to be saved — the repository
 * refuses it as `QUANTITY_RANGE` and says so. Substituting 1 here instead showed an estimate of Rp 0 and wrote
 * 1 × the price, which is the one thing a form may never do: give the user a figure other than the one it showed.
 */
const wholeOf = (typed: string) => (/^\d+$/.test(typed.trim()) ? Number(typed.trim()) : 0);

/**
 * The form that makes one thing to buy, and the same form that edits it.
 *
 * There is no estimate field. The estimate is how many × price each, shown read-only beside them as they are typed —
 * a figure someone could type would be a third number free to disagree with the two that make it.
 *
 * An edit carries the item's id through to `saveEventItem`, which updates that row in place. Leaving the id out
 * appends a second item instead, which is exactly how the interim card this screen replaces silently doubled a
 * category's planned figure. Here the whole list sits on the screen behind this form, so a duplicate could not hide —
 * but the id is passed all the same, because being visible is not the same as being right.
 */
export function ItemFormPage({ eventId, tab, itemId }: { eventId: string; tab?: string; itemId?: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  const plan = useEventPlan(eventId, tab ?? null);
  const ready = useEventItemsReady();
  const accounts = useAccounts().data ?? [];
  const setCategories = useSetCategories(event?.setId ?? null).data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const workspaceOf = useCategoryWorkspaces();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);

  const existing = itemId ? ((plan.data?.lines ?? []).flatMap((line) => line.items).find((row) => row.id === itemId) ?? null) : null;

  // Filled once the item being edited has arrived; not kept in sync after, so typing is never clobbered.
  useEffect(() => {
    if (!itemId || loaded || !existing) return;
    setName(existing.name);
    setQuantity(String(existing.quantity));
    // Written the way save parses it back, so a two-decimal currency reads 15.00 and saves as 15.00.
    setPrice(minorToMajorString(existing.unitPriceMinor, ws.baseCurrency));
    setCategoryId(existing.categoryId ?? '');
    setLink(existing.link ?? '');
    setNote(existing.note ?? '');
    setLoaded(true);
  }, [itemId, loaded, existing, ws.baseCurrency]);

  /*
   * An event plans against its own set when it has one, so a renovation is planned in renovation terms. Without one it
   * plans against the monthly tree, which leaves other sets out, or the list would offer two Flights. Two workspaces
   * can hold a category of the same name, so each option says which workspace it belongs to and the choice is real.
   */
  const monthly = accounts.filter((account) => account.kind === 'expense' && account.subtype === 'category' && membership[account.id] === undefined);
  const planCategories = event?.setId ? setCategories : monthly;
  const planName = (id: string, plain: string) => {
    const workspace = workspaceOf(id);
    return workspace ? `${plain} · ${workspace}` : plain;
  };

  const estimateMinor = wholeOf(quantity) * minorOf(price, ws.baseCurrency);
  const after = plan.data ? afterSaving(plan.data, { estimateMinor, replacing: itemId }) : null;
  const search = { ws: tab };
  const backTo = itemId
    ? ({ to: '/events/$eventId/plan/$itemId', params: { eventId, itemId }, search } as const)
    : ({ to: '/events/$eventId/plan', params: { eventId }, search } as const);
  // The warning waits for a No; Save waits for the answer. `itemFormGate` holds the reasoning and is tested there.
  const { blocked, saveOff } = itemFormGate(ready);

  async function save(submitted: FormEvent) {
    submitted.preventDefault();
    setError(null);
    try {
      const id = await saveEventItem(database, ws, eventId, {
        id: itemId,
        name,
        quantity: wholeOf(quantity),
        unitPriceMinor: parseMajor(price, ws.baseCurrency),
        categoryAccountId: categoryId || null,
        link,
        note,
      });
      /*
       * The write is a deliberate no-op on a database from before migration 0049, and it still hands back an id. So
       * the item is read straight back rather than the id trusted: a save that could not happen must never look like
       * it worked, and the alternative is an item that appears on screen and is gone on the next refresh.
       */
      const saved = await listEventItems(database, ws, eventId);
      if (!saved.some((row) => row.id === id)) {
        throw new Error('Nothing was saved: this copy of your data is from before a plan was a list of things to buy. Open it once on a finished version, then try again.');
      }
      await invalidate();
      await navigate(backTo);
    } catch (e) {
      setError(e);
    }
  }

  /** A dead end is not an answer: whatever went missing, there is a way out that is not the browser's back button. */
  const gone = (said: string, out: ReactNode) => (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title={itemId ? 'Edit item' : 'New item'} />
      {out}
      <Empty>{said}</Empty>
    </div>
  );

  if (events.isSuccess && !event)
    return gone(
      'That event is no longer here.',
      <Link to="/events" className={BACK}>
        <ChevronLeft size={16} aria-hidden />
        All events
      </Link>,
    );
  if (itemId && plan.isSuccess && !existing)
    return gone(
      'That item is no longer on this plan.',
      <Link to="/events/$eventId/plan" params={{ eventId }} search={search} className={BACK}>
        <ChevronLeft size={16} aria-hidden />
        Back to the plan
      </Link>,
    );

  const saveButton = (
    <Button type="submit" form="item-form" disabled={saveOff}>
      Save
    </Button>
  );

  return (
    <div className="mx-auto max-w-lg space-y-3">
      {/* The Save button lives in the header so a phone never has to scroll to it; `form` is what still submits. */}
      <PageHeader title={itemId ? 'Edit item' : 'New item'} controls={saveButton} action={saveButton} />
      <Link {...backTo} className="-mt-2 block min-h-11 py-3 text-sm font-medium text-slate-600 hover:text-slate-900">
        Cancel
      </Link>
      <ErrorBox error={error ?? plan.error} />
      {blocked && (
        <Card className="text-sm text-amber-900 ring-amber-200">
          This copy of your data is from before a plan was a list of things to buy, so nothing here can be saved yet. Open it once on a version that has finished
          updating, and the plan will be here.
        </Card>
      )}

      <form id="item-form" onSubmit={save} className="grid gap-3 md:grid-cols-2">
        <Field label="What" className="md:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stroller" />
        </Field>
        <Field label="How many">
          <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" placeholder="1" />
        </Field>
        <Field label="Price each">
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="500000" />
        </Field>
        {/* Read-only, and not part of what is saved: the estimate is the product of the two fields above it. */}
        <Field label="Estimate">
          <Input value={formatMinor(estimateMinor, ws.baseCurrency)} readOnly tabIndex={-1} className="bg-slate-50 text-slate-600" />
        </Field>
        <Field label="Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Not in a category</option>
            {planCategories.map((account) => (
              <option key={account.id} value={account.id}>
                {planName(account.id, account.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Link" className="md:col-span-2">
          <Input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="tokopedia.com/…" />
        </Field>
        <Field label="Note" className="md:col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Second-hand ok" />
        </Field>
      </form>
      <p className="px-1 text-xs text-slate-500">No date. How many × price each makes the estimate; one of something is the ordinary case.</p>

      {after && event && (
        <Card className="space-y-1">
          <h2 className="text-sm font-semibold">After saving</h2>
          {/* Not clamped again here: `afterSaving` clamps, so that the four screens do not each remember to. */}
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-500">{event.name}, planned</span>
            <Money minor={after.plannedMinor} currency={ws.baseCurrency} className="font-semibold" />
          </p>
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-500">Still to buy</span>
            <Money minor={after.toBuyMinor} currency={ws.baseCurrency} className="font-semibold" />
          </p>
          {after.notPlannedMinor > 0 && (
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-500">Not planned</span>
              <Money minor={after.notPlannedMinor} currency={ws.baseCurrency} className="font-semibold" />
            </p>
          )}
          {/* Money that came back answers no item, so saving one cannot move it — but leaving it out would under-state
              the event by exactly the refund, with nothing on the card to say where it went. */}
          {after.moneyBackMinor > 0 && (
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-500">Money back</span>
              <Money minor={after.moneyBackMinor} currency={ws.baseCurrency} className="font-semibold text-emerald-700" />
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
