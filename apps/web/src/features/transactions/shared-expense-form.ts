import { evaluateExact, formatMinor, isRateString, minorToMajorString, parseMajor, parseRate, rateString, sharesOf } from '@expanses/core';
import type { AccountRow, SharedEventView, SharedExpenseInput, SharedExpensePatch, SharedExpenseView } from '@expanses/db';
import { moneyAccounts } from '../events/shared-view';

/*
 * The Add screen in a shared event (shared events §6), as data: what the card holds, what it offers, and what it
 * sends. Every refusal is in words that name people and never say "you".
 */

export interface SharedExpenseDraft {
  occurredOn: string;
  note: string;
  /** Typed, in `currency`, as the Add screen's amount row and its keypad write it. */
  amount: string;
  currency: string;
  /** Units of the event currency per one `currency`, as typed; '1' in the event currency. */
  rate: string;
  /** The payer's person id. */
  payer: string;
  /** This person's own account, when this person paid. */
  accountId: string;
  /** The card on that account, when a card paid: Paid with offers cards as the Add screen does. */
  cardId: string;
  /** What that account was charged, in its own currency, when it is not `currency`. */
  charged: string;
  splitMode: 'equal' | 'amounts';
  ticked: string[];
  amounts: Record<string, string>;
  categoryId: string;
}

const live = (view: SharedEventView) => view.people.filter((p) => !p.removed);

export function emptySharedDraft(view: SharedEventView, today: string): SharedExpenseDraft {
  return {
    occurredOn: today,
    note: '',
    amount: '',
    currency: view.currency,
    rate: '1',
    payer: view.me,
    accountId: '',
    cardId: '',
    charged: '',
    splitMode: 'equal',
    ticked: live(view).map((p) => p.personId),
    amounts: {},
    categoryId: '',
  };
}

/**
 * An expense, opened to be changed. This person's own payment opens on the account it was paid from and what that
 * account was really charged (R5), so the charged row reads what the bank took rather than a fresh estimate.
 */
export function draftFromExpense(view: SharedEventView, e: SharedExpenseView): SharedExpenseDraft {
  const own = e.posting?.accountCurrency ?? null;
  const charged = e.posting?.accountAmountMinor ?? null;
  return {
    occurredOn: e.occurredOn,
    note: e.note ?? '',
    amount: minorToMajorString(e.amountMinor, e.currency),
    currency: e.currency,
    rate: e.rateToEvent,
    payer: e.payerPersonId,
    accountId: e.posting?.accountId ?? '',
    cardId: '',
    charged: own && charged !== null ? minorToMajorString(charged, own) : '',
    splitMode: e.split.mode,
    ticked: e.split.mode === 'equal' ? [...e.split.people] : e.split.shares.map((s) => s.personId),
    amounts: e.split.mode === 'amounts' ? Object.fromEntries(e.split.shares.map((s) => [s.personId, minorToMajorString(s.minor, e.currency)])) : {},
    categoryId: e.categoryId ?? '',
  };
}

/** R13: this person, with one of their own accounts, or a person without the app. */
export function payerChoices(view: SharedEventView): { personId: string; label: string }[] {
  return live(view)
    .filter((p) => p.isMe || !p.hasApp)
    .map((p) => ({ personId: p.personId, label: p.isMe ? `${p.name} (this phone)` : p.name }));
}

export function splitSummary(draft: SharedExpenseDraft): string {
  const count = draft.splitMode === 'equal' ? draft.ticked.length : Object.values(draft.amounts).filter((v) => v.trim()).length;
  return `${draft.splitMode === 'equal' ? 'Equal' : 'By amount'} · ${count} ${count === 1 ? 'person' : 'people'}`;
}

/**
 * What the Split sheet shows beside each person, in the expense's own currency: an equal split's shares as `sharesOf`
 * will record them (the leftover unit to the payer), and what is still to be typed on a split by amount. Null while
 * the amount cannot be read, so the sheet shows no figure rather than a wrong one.
 */
export function splitPreview(draft: SharedExpenseDraft): { shares: Record<string, number>; leftMinor: number } | null {
  let amountMinor: number;
  try {
    amountMinor = figure(draft.amount, draft.currency, 'Amount', true);
  } catch {
    return null;
  }
  if (draft.splitMode === 'equal') {
    if (draft.ticked.length === 0) return { shares: {}, leftMinor: amountMinor };
    const shares = sharesOf({ amountMinor, payerPersonId: draft.payer, split: { mode: 'equal', people: draft.ticked } });
    return { shares: Object.fromEntries(shares.map((s) => [s.personId, s.minor])), leftMinor: 0 };
  }
  const shares: Record<string, number> = {};
  for (const [personId, typed] of Object.entries(draft.amounts)) {
    if (!typed.trim()) continue;
    try {
      shares[personId] = figure(typed, draft.currency, 'A share', false);
    } catch {
      // A share still being typed counts for nothing until it reads.
    }
  }
  return { shares, leftMinor: amountMinor - Object.values(shares).reduce((sum, minor) => sum + minor, 0) };
}

/** The rate to suggest: the day's rates to the base currency, divided; '1' in the event currency; null without both. */
export function suggestedRate(currency: string, eventCurrency: string, base: string, ratesToBase: Record<string, number>): string | null {
  if (currency === eventCurrency) return '1';
  const from = currency === base ? 1 : ratesToBase[currency];
  const to = eventCurrency === base ? 1 : ratesToBase[eventCurrency];
  return from && to ? rateString(from / to) : null;
}

/**
 * A figure as the Add screen's amount row reads it: through the kit's one reader (`evaluateExact`), so `90000+5000`
 * typed on the keypad is what is recorded. Cents typed on a whole-unit currency — the keypad's "," key — are rounded
 * up, as an expense's are on the Add screen (B2): a record carries whole units. A figure typed anywhere else (a share
 * by amount) keeps its currency's own rules.
 */
function figure(typed: string, currency: string, label: string, cents: boolean): number {
  if (!typed.trim()) throw new Error(`${label} is empty — type a figure`);
  const read = evaluateExact(typed, currency, cents ? { fractional: 'up' } : {});
  if (read !== null && read.minor > 0) return read.minor;
  // `parseMajor` has the words for a figure that cannot be read ("IDR allows 0 decimal places"); a readable one was nought.
  if (read === null) parseMajor(typed, currency);
  throw new Error(`${label} must be greater than zero`);
}

function rateOf(draft: SharedExpenseDraft, view: SharedEventView): string {
  if (draft.currency === view.currency) return '1';
  const typed = draft.rate.trim();
  if (!typed) throw new Error(`Enter the rate: ${view.currency} per 1 ${draft.currency}`);
  // A rate typed with a comma ("31,5") is read by `parseRate` and written back the way a record carries it.
  return isRateString(typed) ? typed : rateString(parseRate(typed));
}

function splitOf(draft: SharedExpenseDraft, amountMinor: number): SharedExpenseInput['split'] {
  if (draft.splitMode === 'equal') {
    if (draft.ticked.length === 0) throw new Error('Tick at least one person to share it');
    return { mode: 'equal', people: [...draft.ticked] };
  }
  const shares = Object.entries(draft.amounts)
    .filter(([, typed]) => typed.trim())
    .map(([personId, typed]) => ({ personId, minor: figure(typed, draft.currency, 'A share', false) }));
  const sum = shares.reduce((total, s) => total + s.minor, 0);
  if (sum !== amountMinor) throw new Error(`The amounts add up to ${formatMinor(sum, draft.currency)}, not ${formatMinor(amountMinor, draft.currency)}`);
  return { mode: 'amounts', shares };
}

export function sharedDraftToInput(draft: SharedExpenseDraft, view: SharedEventView, accounts: readonly AccountRow[]): SharedExpenseInput {
  if (!draft.amount.trim()) throw new Error('Enter an amount');
  const amountMinor = figure(draft.amount, draft.currency, 'Amount', true);
  const mine = draft.payer === view.me;
  let paidFrom: SharedExpenseInput['paidFrom'] = null;
  if (mine) {
    const account = moneyAccounts(accounts).find((a) => a.id === draft.accountId);
    if (!account) throw new Error(`Choose the account ${view.myName} paid from`);
    const foreign = account.currency !== draft.currency;
    if (foreign && !draft.charged.trim()) throw new Error(`Enter what ${account.name} was charged in ${account.currency}`);
    paidFrom = {
      accountId: account.id,
      chargedMinor: foreign ? figure(draft.charged, account.currency!, `Charged in ${account.currency}`, true) : null,
      ...(draft.cardId ? { cardId: draft.cardId } : {}),
    };
  }
  return {
    occurredOn: draft.occurredOn,
    amountMinor,
    currency: draft.currency,
    rateToEvent: rateOf(draft, view),
    payerPersonId: draft.payer,
    paidFrom,
    split: splitOf(draft, amountMinor),
    categoryId: draft.categoryId || null,
    note: draft.note.trim() || null,
  };
}

/** What an edit changed, and nothing else: an edit that does not touch the money never asks for its payer. */
export function sharedDraftToPatch(draft: SharedExpenseDraft, view: SharedEventView, expenseId: string): SharedExpensePatch {
  const original = view.expenses.find((e) => e.expenseId === expenseId);
  if (!original) throw new Error('That expense was deleted');
  const amountMinor = figure(draft.amount, draft.currency, 'Amount', true);
  const split = splitOf(draft, amountMinor);
  const patch: SharedExpensePatch = {};
  if (draft.occurredOn !== original.occurredOn) patch.occurredOn = draft.occurredOn;
  if (amountMinor !== original.amountMinor) patch.amountMinor = amountMinor;
  if (draft.currency !== original.currency) patch.currency = draft.currency;
  const rate = rateOf(draft, view);
  if (rate !== original.rateToEvent) patch.rateToEvent = rate;
  if (JSON.stringify(split) !== JSON.stringify(original.split)) patch.split = split;
  if ((draft.categoryId || null) !== original.categoryId) patch.categoryId = draft.categoryId || null;
  if ((draft.note.trim() || null) !== original.note) patch.note = draft.note.trim() || null;
  // What this person's own account was charged, in its currency, when that is not the expense's (R5): sent only when
  // it says something new, so a note changed on a card purchase never re-writes what the bank took.
  const own = original.posting?.accountCurrency ?? null;
  if (draft.charged.trim() && own && own !== draft.currency) {
    const charged = figure(draft.charged, own, `Charged in ${own}`, true);
    if (charged !== (original.posting?.accountAmountMinor ?? null)) patch.chargedMinor = charged;
  }
  return patch;
}

/** D8: the amount, currency, rate and date of what another member paid are theirs alone; said, not hidden. */
export function moneyLocked(e: SharedExpenseView | null): string | null {
  return e?.payerOnly ? `Only ${e.payerName} changes the amount, currency, rate or date of what ${e.payerName} paid` : null;
}
