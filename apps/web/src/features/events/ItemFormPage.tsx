import { formatMinor, minorToMajorString, parseMajor } from '@expanses/core';
import { listEventItems, saveEventItem } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, LargeTitle, ReadOnlyRow, SelectRow, TextRow, type CornerAction } from '../../ui/native';
import { useCategorySetMembership, useSetCategories } from '../categories/set-queries';
import { useCategoryWorkspaces } from '../workspaces/queries';
import { afterSaving, itemFormGate } from './plan-view';
import { useEventItemsReady, useEventPlan, useEvents } from './queries';

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
 *
 * Drawn with the native kit: every field is a line in one group, label left and answer right, and Save is the
 * corner button — not a label stacked over an outlined box under a dark rectangle. The `<form>` is still the thing
 * that submits, so Enter in any field saves exactly as it did.
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

  async function save(submitted?: FormEvent) {
    submitted?.preventDefault();
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

  const title = itemId ? 'Edit item' : 'New item';
  const screen = (children: ReactNode) => (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );

  /** A dead end is not an answer: whatever went missing, there is a way out that is not the browser's back button. */
  if (events.isSuccess && !event)
    return screen(
      <>
        <LargeTitle title={title} back="All events" backTo="/events" />
        <Empty>That event is no longer here.</Empty>
      </>,
    );
  if (itemId && plan.isSuccess && !existing)
    return screen(
      <>
        <LargeTitle title={title} back="Back to the plan" backTo="/events/$eventId/plan" backParams={{ eventId }} backSearch={search} />
        <Empty>That item is no longer on this plan.</Empty>
      </>,
    );

  // The Save action lives in the corner, so a phone never has to scroll to it; the `<form>` is what still submits.
  const saveAction: CornerAction = {
    key: 'save',
    label: 'Save',
    glyph: <Check size={22} aria-hidden />,
    run: () => void save(),
    disabled: saveOff,
  };

  return screen(
    <>
      {/* Back off a form is Cancel: the one word that says what leaving it does to what has been typed. */}
      <LargeTitle title={title} back="Cancel" backTo={backTo.to} backParams={backTo.params} backSearch={backTo.search} actions={[saveAction]} />
      <ErrorBox error={error ?? plan.error} />
      {blocked && (
        <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-warn)]">
          This copy of your data is from before a plan was a list of things to buy, so nothing here can be saved yet. Open it once on a version that has finished
          updating, and the plan will be here.
        </p>
      )}

      <form id="item-form" onSubmit={save}>
        <InsetGroup header="The item" footer="No date. How many × price each makes the estimate; one of something is the ordinary case.">
          <TextRow label="What" value={name} onChange={(e) => setName(e.target.value)} placeholder="Stroller" />
          <TextRow label="How many" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" placeholder="1" />
          <TextRow label="Price each" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="500000" />
          {/*
           * Read-only, and not part of what is saved: the estimate is the product of the two fields above it. It
           * stays an input rather than becoming a static row so that it keeps the label it is found by, and so the
           * figure it shows is the figure a test can read off the form.
           */}
          <TextRow label="Estimate" value={formatMinor(estimateMinor, ws.baseCurrency)} readOnly tabIndex={-1} className="tabular text-[var(--ph-ink-3)]" />
          <SelectRow label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Not in a category</option>
            {planCategories.map((account) => (
              <option key={account.id} value={account.id}>
                {planName(account.id, account.name)}
              </option>
            ))}
          </SelectRow>
          <TextRow label="Link" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="tokopedia.com/…" />
          <TextRow label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Second-hand ok" />
        </InsetGroup>
      </form>

      {after && event && (
        <InsetGroup header="After saving">
          {/* Not clamped again here: `afterSaving` clamps, so that the four screens do not each remember to. */}
          <ReadOnlyRow label={`${event.name}, planned`} value={formatMinor(after.plannedMinor, ws.baseCurrency)} />
          <ReadOnlyRow label="Still to buy" value={formatMinor(after.toBuyMinor, ws.baseCurrency)} />
          {after.notPlannedMinor > 0 && <ReadOnlyRow label="Not planned" value={formatMinor(after.notPlannedMinor, ws.baseCurrency)} />}
          {/* Money that came back answers no item, so saving one cannot move it — but leaving it out would under-state
              the event by exactly the refund, with nothing on the card to say where it went. */}
          {after.moneyBackMinor > 0 && <ReadOnlyRow label="Money back" value={formatMinor(after.moneyBackMinor, ws.baseCurrency)} />}
        </InsetGroup>
      )}
    </>,
  );
}
