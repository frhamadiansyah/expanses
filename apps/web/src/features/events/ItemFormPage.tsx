import { CURRENCIES, eventCurrency, formatMinor, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { type AccountRow, listEventItems, removeEventItem, saveEventItem } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { cx } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, LargeTitle, TextRow, type CornerAction, type GroupChild, PushedTitle } from '../../ui/native';
import { Sheet } from '../../app/Sheet';
import { CategoryIcon } from '../categories/CategoryIcon';
import { CurrencySheet } from '../transactions/CurrencySheet';
import { useCategorySetMembership, useSetCategories } from '../categories/set-queries';
import { useCategoryWorkspaces } from '../workspaces/queries';
import { itemFormGate } from './plan-view';
import { useEventItemsReady, useEventPlan, useEvents, usePlanConverter } from './queries';

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
 * The estimate, as a total rather than a field: a heavier hairline above it, its label small and quiet, its figure in the same regular weight as the fields above.
 * It is still an input — read-only, out of the tab order — so it keeps the label it is found by and a figure a test can
 * read off the form, but nothing about it invites typing.
 */
function EstimateRow({ value }: GroupChild & { value: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--ph-hair)] px-[13px]" style={{ minHeight: 44 }}>
      <label htmlFor="item-estimate" className="shrink-0 text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
        Estimate
      </label>
      <input
        id="item-estimate"
        value={value}
        readOnly
        tabIndex={-1}
        className="tabular min-w-0 flex-1 cursor-default border-0 bg-transparent p-0 text-right text-[17px] leading-[22px] font-normal text-[var(--ph-ink)] outline-none"
      />
    </div>
  );
}

/**
 * The category row: the category's mark and name at the right, "Not in a category" in grey when empty. A tap opens a
 * sheet holding the plan's categories as a grid of marks; one tap picks and closes.
 */
function CategoryPickRow({
  categoryId,
  name,
  accounts,
  onOpen,
  position,
}: GroupChild & { categoryId: string; name: string | null; accounts: readonly AccountRow[]; onOpen: () => void }) {
  return (
    <InsetRow
      position={position}
      title="Category"
      plain
      label={`Category, ${name ?? 'Not in a category'}`}
      onClick={onOpen}
      value={
        name ? (
          <span className="inline-flex items-center gap-2">
            <CategoryIcon categoryId={categoryId} accounts={accounts} size="row" />
            {name}
          </span>
        ) : (
          'Not in a category'
        )
      }
      valueTone={name ? 'ink' : 'ink-3'}
    />
  );
}

function CategorySheet({
  options,
  current,
  accounts,
  onPick,
  onClose,
}: {
  options: readonly { id: string; name: string }[];
  current: string;
  accounts: readonly AccountRow[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  // Tapping the category already chosen clears it: the only way back to none, so the grid has no tile for it.
  const choose = (id: string) => {
    onPick(id);
    onClose();
  };
  const tile = 'ph-focus flex flex-col items-center gap-[5px] rounded-xl px-1 py-[6px] active:bg-[var(--ph-fill)]';
  return (
    <Sheet title="Category" grouped onClose={onClose}>
      <div className="grid max-h-[55vh] grid-cols-4 gap-x-[6px] gap-y-[10px] overflow-y-auto px-1 pb-2">
        {options.map((option) => (
          <button key={option.id} type="button" aria-label={option.name} aria-current={option.id === current} onClick={() => choose(option.id === current ? '' : option.id)} className={cx(tile, option.id === current && 'bg-[var(--ph-fill)]')}>
            <CategoryIcon categoryId={option.id} accounts={accounts} size="tile" />
            <span className="line-clamp-2 text-center text-[11.5px] leading-[14px] break-words text-[var(--ph-ink-2)]">{option.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * The form that makes one thing to pay, and the same form that edits it.
 *
 * There is no estimate field. The estimate is how many × price each, shown read-only beside them as they are typed —
 * a figure someone could type would be a third number free to disagree with the two that make it.
 *
 * The price is in a currency of its own, starting at the event's. An item typed in another currency than the event's
 * shows its estimate at the day's rate with ≈ (where a rate is stored); one with no rate shows its own figure.
 *
 * An edit carries the item's id through to `saveEventItem`, which updates that row in place. Leaving the id out
 * appends a second item instead, which is exactly how the interim card this screen replaces silently doubled a
 * category's planned figure. Here the whole list sits on the screen behind this form, so a duplicate could not hide —
 * but the id is passed all the same, because being visible is not the same as being right.
 *
 * Drawn with the native kit: every field is a line in a group, label left and answer right, and Save is the
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
  const home = eventCurrency(event?.currency, ws.baseCurrency);
  const ready = useEventItemsReady();
  const accounts = useAccounts().data ?? [];
  const setCategories = useSetCategories(event?.setId ?? null).data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const workspaceOf = useCategoryWorkspaces();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  // The item's own currency; the event's until the item says otherwise. An item being edited loads its own.
  const [picked, setPicked] = useState<string | null>(null);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);
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
    setPicked(existing.currency ?? ws.baseCurrency);
    setPrice(minorToMajorString(existing.unitPriceMinor, existing.currency ?? ws.baseCurrency));
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

  const currency = picked ?? home;
  const estimateMinor = wholeOf(quantity) * minorOf(price, currency);
  // At the day's rate where one is stored: the estimate on this form is read before anything is saved.
  const converter = usePlanConverter(currency === home ? [] : [currency, home]).data;
  const inHome = currency === home ? estimateMinor : (converter?.convert(estimateMinor, currency, home, isoDate()) ?? null);
  const estimateText = currency === home ? formatMinor(estimateMinor, currency) : inHome === null ? formatMinor(estimateMinor, currency) : `≈ ${formatMinor(inHome, home)}`;
  const chosen = planCategories.find((account) => account.id === categoryId);
  const chosenName = chosen ? planName(chosen.id, chosen.name) : null;
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
        unitPriceMinor: parseMajor(price, currency),
        // Nothing is stored for the base currency: an item with no currency of its own reads as the base.
        currency: currency === ws.baseCurrency ? null : currency,
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
        throw new Error('Nothing was saved: this copy of the data is from before a plan was a list of things to pay. Open it once on a finished version, then try again.');
      }
      await invalidate();
      await navigate(backTo);
    } catch (e) {
      setError(e);
    }
  }

  /** Payments stay on the event as not planned; with any linked, the user is asked first. */
  async function remove(row: { id: string; name: string; purchases: readonly unknown[] }) {
    if (row.purchases.length > 0 && !window.confirm(`Delete ${row.name}? Its payments stay in the event as not planned.`)) return;
    setError(null);
    try {
      await removeEventItem(database, ws, row.id);
      await invalidate();
      await navigate({ to: '/events/$eventId/plan', params: { eventId }, search });
    } catch (e) {
      setError(e);
    }
  }

  const title = itemId ? 'Edit cost' : 'New cost';
  const screen = (children: ReactNode) => (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );

  /** A dead end is not an answer: whatever went missing, there is a way out that is not the browser's back button. */
  if (events.isSuccess && !event)
    return screen(
      <>
        <PushedTitle title={title} back="All events" backTo="/events" />
        <Empty>That event is no longer here.</Empty>
      </>,
    );
  if (itemId && plan.isSuccess && !existing)
    return screen(
      <>
        <PushedTitle title={title} back="Back to the plan" backTo="/events/$eventId/plan" backParams={{ eventId }} backSearch={search} />
        <Empty>That cost is no longer on this plan.</Empty>
      </>,
    );

  // Until the item being edited has loaded there is nothing to type into: a price typed in first would be overwritten
  // as the item lands, and a Save would write the blank form over it.
  if (itemId && !loaded)
    return screen(
      <>
        <PushedTitle title={title} back="Back to the plan" backTo="/events/$eventId/plan" backParams={{ eventId }} backSearch={search} />
        <p className="text-sm text-[var(--ph-ink-3)]">Loading…</p>
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
          This copy of the data is from before a plan was a list of things to pay, so nothing here can be saved yet. Open it once on a version that has finished
          updating, and the plan will be here.
        </p>
      )}

      <form id="item-form" onSubmit={save}>
        <InsetGroup>
          <TextRow label="What" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cost name" />
          <TextRow label="How many" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" placeholder="Quantity" />
          <TextRow
            label="Price each"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            prefix={CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency}
            onPrefix={() => setPickingCurrency(true)}
            prefixLabel={`Currency: ${currency}`}
          />
          {/*
           * Read-only, and not part of what is saved: the estimate is the product of the two fields above it. It stays
           * an input rather than a static row so that it keeps the label it is found by.
           */}
          <EstimateRow value={estimateText} />
        </InsetGroup>
        <InsetGroup>
          <CategoryPickRow categoryId={categoryId} name={chosenName} accounts={accounts} onOpen={() => setPickingCategory(true)} />
          <TextRow label="Link" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="Web address" />
          <TextRow label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remarks" />
        </InsetGroup>
      </form>
      {/* Only on an edit, and a group of its own at the foot: the air round it is the only undo a finger gets. */}
      {existing && (
        <InsetGroup>
          <DestructiveRow label="Delete" onClick={() => void remove(existing)} />
        </InsetGroup>
      )}
      {pickingCurrency && <CurrencySheet value={currency} accountCurrency={home} baseCurrency={ws.baseCurrency} onPick={setPicked} onClose={() => setPickingCurrency(false)} />}
      {pickingCategory && (
        <CategorySheet
          options={planCategories.map((account) => ({ id: account.id, name: planName(account.id, account.name) }))}
          current={categoryId}
          accounts={accounts}
          onPick={setCategoryId}
          onClose={() => setPickingCategory(false)}
        />
      )}
    </>,
  );
}
