import { formatMinor, minorToMajorString } from '@expanses/core';
import { addSharedItemPurchase, ownerScope, removeSharedItem, removeSharedItemPurchase, saveSharedItem, setSharedItemDone, type SharedEventView } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { defaultPart, itemChanges, type SharedPlanItem, tickChoices } from './shared-plan';

/**
 * One item of the shared plan, opened (D7, I10): its name and price, the payments towards it (each an expense already
 * recorded, and its part of it), a payment to add, Buy it now and Done buying while it is open, Reopen once done, and
 * Remove. An item may be paid for several times — souvenirs from three shops — and stays open until marked done. Every
 * change is the event's, so it reaches every phone.
 */
export function SharedItemSheet({ view, item, onBuy, onClose }: { view: SharedEventView; item: SharedPlanItem; onBuy: () => void; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const choices = tickChoices(view);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(minorToMajorString(item.unitPriceMinor, view.currency));
  const [expenseId, setExpenseId] = useState('');
  const [part, setPart] = useState('');
  // Removing asks twice, in place: the first tap arms the row, and closing the sheet disarms it with the sheet.
  const [armed, setArmed] = useState(false);
  // The same for one payment: the first tap on it arms it, the second takes it off the item.
  const [armedPayment, setArmedPayment] = useState<string | null>(null);
  const labelOf = (id: string) => choices.find((c) => c.expenseId === id)?.label ?? 'A deleted expense';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  function pickExpense(id: string) {
    setExpenseId(id);
    const chosen = choices.find((c) => c.expenseId === id);
    setPart(chosen ? minorToMajorString(defaultPart(item, chosen.eventAmountMinor), view.currency) : '');
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const { save: input, add } = itemChanges(item, { name, price, expenseId, part }, view.currency);
      if (input) await saveSharedItem(database, ownerScope(ws), view.eventId, input);
      if (add) await addSharedItemPurchase(database, ownerScope(ws), view.eventId, item.id, add);
    });
  }

  return (
    <Sheet grouped title={item.name} onClose={onClose}>
      <form aria-label={`Change ${item.name}`} onSubmit={save} data-testid="shared-item-sheet">
        <ErrorBox error={error} />
        <InsetGroup>
          <TextRow label="Thing to buy" value={name} onChange={(e) => setName(e.target.value)} />
          <TextRow label={`${item.quantity > 1 ? 'Price each' : 'Price'} (${view.currency})`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </InsetGroup>
        <InsetGroup
          header={item.purchases.length > 0 ? 'Add another payment' : undefined}
          footer="A payment towards it from an expense already recorded. Its part is what the item came to of it."
        >
          <SelectRow label="Bought with" value={expenseId} onChange={(e) => pickExpense(e.target.value)}>
            <option value="">{item.purchases.length > 0 ? 'No other payment' : 'Not bought yet'}</option>
            {choices.map((c) => (
              <option key={c.expenseId} value={c.expenseId}>
                {c.label}
              </option>
            ))}
          </SelectRow>
          {expenseId ? <TextRow label={`Its part (${view.currency})`} inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value)} /> : null}
        </InsetGroup>
        <InsetGroup>
          <SubmitRow label={busy ? 'Saving…' : 'Save'} disabled={busy || !name.trim() || !price.trim() || (expenseId !== '' && !part.trim())} />
        </InsetGroup>
      </form>
      {item.purchases.length > 0 && (
        <InsetGroup header="Payments" footer="Tap a payment twice to take it off this item. The expense stays on the event.">
          {item.purchases.map((purchase) => (
            <InsetRow
              key={purchase.transactionId}
              title={armedPayment === purchase.transactionId ? 'Tap again to take it off' : labelOf(purchase.transactionId)}
              value={formatMinor(purchase.shareMinor, view.currency)}
              valueTone="ink"
              chevron={false}
              testId="shared-item-payment"
              onClick={() =>
                armedPayment === purchase.transactionId
                  ? void run(() => removeSharedItemPurchase(database, ownerScope(ws), view.eventId, item.id, purchase.transactionId))
                  : setArmedPayment(purchase.transactionId)
              }
            />
          ))}
        </InsetGroup>
      )}
      <InsetGroup>
        {item.done ? null : <InsetRow title={`Buy ${item.name} now`} onClick={onBuy} testId="shared-item-buy" />}
        {/* Done is its own mark: an item paid for in parts stays on the list until nothing more is to be bought. */}
        <InsetRow
          title={item.done ? 'Reopen' : 'Done buying'}
          chevron={false}
          onClick={() => void run(() => setSharedItemDone(database, ownerScope(ws), view.eventId, item.id, !item.done))}
        />
      </InsetGroup>
      <InsetGroup>
        <DestructiveRow
          label={armed ? `Tap again to remove ${item.name}` : 'Remove from the plan'}
          onClick={() => (armed ? void run(() => removeSharedItem(database, ownerScope(ws), view.eventId, item.id)) : setArmed(true))}
        />
      </InsetGroup>
    </Sheet>
  );
}
