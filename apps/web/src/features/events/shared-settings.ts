import { formatMinor } from '@expanses/core';
import type { SharedEventView } from '@expanses/db';
import { DELETE_COPY_LABEL } from './delete-copy';
import { finishRow } from './event-settings';
import { pageLocks, possessive, signedBalance } from './shared-view';

/*
 * A shared trip's Settings page (owner, 14 Nov 2026), what the ⚙ on its page opens: the Split costs and Plan switches,
 * People and Categories, Mark as done (or Reopen), and Leave last. A line that cannot be taken yet stays, greyed, saying
 * why. There is no Currency line: the currency is chosen when the event is shared and fixed from then on.
 *
 * An event this phone's person is no longer in keeps People, to read, and Delete this copy (this phone alone); one
 * waiting for an invite keeps People alone (I5, review minor 2). Every line names a person and none says "you".
 */

export const SPLIT_COSTS_FOOTER = 'Split costs off: one pot, no shares or settling up.';

export interface SharedSettings {
  /** The Split costs and Plan switches: shown while this person is in the event; greyed while it is Done. */
  switches: { shown: boolean; disabled: boolean };
  /** Categories, offered while this person is in the event. */
  categories: boolean;
  /** Mark as done, or Reopen; null on a copy this person is no longer in. */
  done: { label: 'Mark as done' | 'Reopen'; footer: string; finished: boolean } | null;
  /** Leave, at a zero balance only (D9); null on a read-only copy. */
  leave: { label: string; disabled: boolean; footer: string | null } | null;
  /** Delete this copy, on a copy this person is no longer in, at a zero balance only (review I1). */
  deleteCopy: { label: string; disabled: boolean; footer: string | null } | null;
}

/** The page's lines for `view`, on `today` (the private Settings' Mark as done words, `finishRow`). */
export function sharedSettings(view: SharedEventView, today: string): SharedSettings {
  const { readOnly, locked } = pageLocks(view);
  const balance = view.people.find((p) => p.isMe)?.balanceMinor ?? 0;
  const owes = balance !== 0;
  if (readOnly) {
    // Waiting for an invite, the person is still in the event: the copy comes back to life with one (review minor 2).
    const deleteCopy =
      view.state === 'needs_invite' ? null : { label: DELETE_COPY_LABEL, disabled: owes, footer: owes ? `${possessive(view.myName)} balance is ${signedBalance(balance, view.currency)}` : null };
    return { switches: { shown: false, disabled: true }, categories: false, done: null, leave: null, deleteCopy };
  }
  const finished = view.finishedAt !== null;
  return {
    switches: { shown: true, disabled: locked },
    categories: true,
    done: { ...(finishRow(view, today) as { label: 'Mark as done' | 'Reopen'; footer: string }), finished },
    leave: {
      label: `Leave ${view.name}`,
      disabled: owes,
      // In one pot the balance is hidden: the way to see it, and settle it, is said with it.
      footer: owes ? `${possessive(view.myName)} balance is not zero yet.${view.splitCosts ? '' : ' Split costs on shows it.'}` : null,
    },
    deleteCopy: null,
  };
}

/** Whether turning Split costs off asks first: someone owes something on the trip now. */
export const askBeforeOnePot = (view: Pick<SharedEventView, 'people'>): boolean => view.people.some((p) => p.balanceMinor !== 0);

/**
 * What the "Stop splitting costs?" alert says: who owes whom now, as the suggested payments read, and what happens to it.
 */
export function stopSplittingText(view: Pick<SharedEventView, 'payments' | 'currency'>): string {
  const owed = view.payments.map((p) => `${p.fromName} owes ${p.toName} ${formatMinor(p.amountMinor, view.currency)}`);
  const now = owed.length === 0 ? '' : `${owed.length === 1 ? owed[0] : `${owed.slice(0, -1).join(', ')} and ${owed[owed.length - 1]}`} now. `;
  return `${now}With splitting off, nobody owes anything on this trip. The splits are kept; switching back on brings them back.`;
}

/** The People row's value: everyone still in the event, by name, this phone's person first. */
export const peopleValue = (view: Pick<SharedEventView, 'people'>): string =>
  view.people
    .filter((p) => !p.removed)
    .sort((a, b) => Number(b.isMe) - Number(a.isMe))
    .map((p) => p.name)
    .join(', ');

/** The Categories row's value: how many the trip has open. */
export const categoriesValue = (view: Pick<SharedEventView, 'categories'>): string => {
  const open = view.categories.filter((c) => !c.archived).length;
  return open === 0 ? 'None yet' : `${open}`;
};
