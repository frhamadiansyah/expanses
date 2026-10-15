import { formatMinor, type EventPlanItemView, parseMajor } from '@expanses/core';
import type { SharedEventView, SharedItemInput } from '@expanses/db';

/*
 * An item of the shared plan, opened (D7, I10): its name and price put right, and the tick — the expense that bought
 * it, and the item's part of that expense in the event currency. Pure, so a test holds what each change writes.
 */

export type SharedPlanItem = EventPlanItemView;

/** The expenses an item can be ticked against: the ones not deleted, by what they were and what they came to. */
export function tickChoices(view: Pick<SharedEventView, 'expenses' | 'currency'>): { expenseId: string; label: string; eventAmountMinor: number }[] {
  return view.expenses
    .filter((e) => !e.voided)
    .map((e) => ({ expenseId: e.expenseId, label: `${e.note ?? e.categoryName ?? 'Shared spending'} · ${formatMinor(e.eventAmountMinor, view.currency)}`, eventAmountMinor: e.eventAmountMinor }));
}

/**
 * The item's part of an expense, offered when it is first ticked: what the item was meant to cost, never more than the
 * expense itself (`linkSharedItem` refuses more).
 */
export function defaultPart(item: Pick<SharedPlanItem, 'estimateMinor'>, eventAmountMinor: number): number {
  return Math.max(1, Math.min(item.estimateMinor, eventAmountMinor));
}

export interface ItemDraft {
  name: string;
  /** Price each, as typed, in the event currency. */
  price: string;
  /** The expense it was bought with, or '' for not bought. */
  expenseId: string;
  /** Its part of that expense, as typed. */
  part: string;
}

/**
 * What saving an opened item writes: the item itself when its name or price changed (everything else kept), and the
 * tick when it changed — `null` takes it off, `undefined` leaves it alone.
 */
export function itemChanges(
  item: SharedPlanItem,
  draft: ItemDraft,
  currency: string,
): { save: SharedItemInput | null; link: { expenseId: string; shareMinor: number } | null | undefined } {
  const unitPriceMinor = parseMajor(draft.price, currency);
  const name = draft.name.trim();
  const save =
    name !== item.name || unitPriceMinor !== item.unitPriceMinor
      ? { id: item.id, name, quantity: item.quantity, unitPriceMinor, categoryId: item.categoryId, link: item.link, note: item.note }
      : null;
  const was = item.purchase;
  if (!draft.expenseId) return { save, link: was ? null : undefined };
  const shareMinor = parseMajor(draft.part, currency);
  const link = was && was.transactionId === draft.expenseId && was.shareMinor === shareMinor ? undefined : { expenseId: draft.expenseId, shareMinor };
  return { save, link };
}
