import { minorToMajorString } from '@expanses/core';
import { linkSharedItem, ownerScope, removeSharedItem, saveSharedItem, type SharedEventView } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { defaultPart, itemChanges, type SharedPlanItem, tickChoices } from './shared-plan';

/**
 * One item of the shared plan, opened (D7, I10): its name and price, what bought it (the tick, against an expense
 * already recorded — one recorded without Buy it now), Buy it now while it is not bought, and Remove. Every change is
 * the event's, so it reaches every phone.
 */
export function SharedItemSheet({ view, item, onBuy, onClose }: { view: SharedEventView; item: SharedPlanItem; onBuy: () => void; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const choices = tickChoices(view);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(minorToMajorString(item.unitPriceMinor, view.currency));
  const [expenseId, setExpenseId] = useState(item.purchase?.transactionId ?? '');
  const [part, setPart] = useState(item.purchase ? minorToMajorString(item.purchase.shareMinor, view.currency) : '');
  // Removing asks twice, in place: the first tap arms the row, and closing the sheet disarms it with the sheet.
  const [armed, setArmed] = useState(false);
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
      const { save: input, link } = itemChanges(item, { name, price, expenseId, part }, view.currency);
      if (input) await saveSharedItem(database, ownerScope(ws), view.eventId, input);
      if (link !== undefined) await linkSharedItem(database, ownerScope(ws), view.eventId, item.id, link);
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
        <InsetGroup footer="Ticks it against an expense already recorded. Its part is what the item came to of it.">
          <SelectRow label="Bought with" value={expenseId} onChange={(e) => pickExpense(e.target.value)}>
            <option value="">Not bought yet</option>
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
      {item.purchase ? null : (
        <InsetGroup>
          <InsetRow title={`Buy ${item.name} now`} onClick={onBuy} testId="shared-item-buy" />
        </InsetGroup>
      )}
      <InsetGroup>
        <DestructiveRow
          label={armed ? `Tap again to remove ${item.name}` : 'Remove from the plan'}
          onClick={() => (armed ? void run(() => removeSharedItem(database, ownerScope(ws), view.eventId, item.id)) : setArmed(true))}
        />
      </InsetGroup>
    </Sheet>
  );
}
