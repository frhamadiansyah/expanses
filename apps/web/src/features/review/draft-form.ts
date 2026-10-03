/**
 * A captured draft, read into the Add form and written back out of it.
 *
 * Review opens a draft on the very card that adds a transaction, so the owner learns one form. The card holds a
 * `FormDraft` — a typed figure, always positive, and a tab — while a draft holds a signed figure in minor units
 * (positive is money out of its account, negative money in) and a kind. These are the two directions between
 * them, the rule for when the ✓ may record, and which fields the owner corrected against what was read: the
 * corrections are what teach a source its layout.
 */
import { evaluateAmount } from '@expanses/core';
import type { DraftRow, NewDraft } from '@expanses/db';
import type { FormDraft } from '../transactions/tx-form';
import { majorText } from './capture-view';

/** What `editDraft` takes: everything the form can change about a draft. */
export type DraftPatch = Required<
  Pick<NewDraft, 'kind' | 'accountId' | 'toAccountId' | 'categoryAccountId' | 'cardId' | 'amountMinor' | 'currency' | 'description' | 'occurredOn'>
>;

/** The form's fields, filled from what was read. Spread over an empty form: it stays an add, not an edit. */
export function formFromDraft(draft: DraftRow): Partial<FormDraft> {
  const transfer = draft.kind === 'transfer';
  return {
    mode: draft.kind,
    occurredOn: draft.occurredOn,
    description: draft.description,
    moneyId: draft.accountId ?? '',
    cardId: draft.cardId ?? '',
    toId: draft.toAccountId ?? '',
    categoryId: transfer ? '' : (draft.categoryAccountId ?? ''),
    amount: draft.amountMinor === 0 ? '' : majorText(draft.amountMinor, draft.currency),
    // A transfer offers no flag: its figure is the From account's own currency.
    currency: transfer ? '' : draft.currency,
  };
}

/** The currency the form's figure is read in: the flag, else the one the draft was read in. */
const currencyOf = (form: FormDraft, draft: Pick<DraftRow, 'currency'>) => form.currency || draft.currency;

/** The form's figure in minor units, or null when it is not a positive amount. */
function figure(form: FormDraft, draft: Pick<DraftRow, 'currency'>): number | null {
  const minor = evaluateAmount(form.amount, currencyOf(form, draft));
  return minor !== null && minor > 0 ? minor : null;
}

/**
 * The form, written back onto the draft before it is confirmed — `confirmDraft` reads the row, so what the owner
 * chose has to be there first. Money in goes back negative, everything else positive. Throws when the figure is not
 * a positive amount.
 */
export function draftPatch(form: FormDraft, draft: Pick<DraftRow, 'currency' | 'description'>): DraftPatch {
  if (form.mode === 'trade') throw new Error('A capture is recorded as an expense, income or a transfer');
  const minor = figure(form, draft);
  if (minor === null) throw new Error('Amount must be greater than zero');
  const transfer = form.mode === 'transfer';
  return {
    kind: form.mode,
    accountId: form.moneyId || null,
    toAccountId: transfer ? form.toId || null : null,
    categoryAccountId: transfer ? null : form.categoryId || null,
    // A card is a way to pay: it says nothing about money arriving or moving.
    cardId: form.mode === 'expense' ? form.cardId || null : null,
    amountMinor: form.mode === 'income' ? -minor : minor,
    currency: currencyOf(form, draft),
    description: form.description.trim() || draft.description,
    occurredOn: form.occurredOn,
  };
}

/** Whether the ✓ may record: an account, a category (or a different To for a transfer), and a figure. */
export function canRecord(form: FormDraft, draft: Pick<DraftRow, 'currency'>): boolean {
  if (form.mode === 'trade' || !form.moneyId) return false;
  if (form.mode === 'transfer' ? !form.toId || form.toId === form.moneyId : !form.categoryId) return false;
  return figure(form, draft) !== null;
}

export interface Correction {
  field: 'amount' | 'name' | 'date';
  value: string;
}

/** The fields the owner changed against what was read, with what they put there — each one teaches the source. */
export function corrections(form: FormDraft, draft: DraftRow): Correction[] {
  const found: Correction[] = [];
  const minor = figure(form, draft);
  if (minor !== null && minor !== Math.abs(draft.amountMinor)) found.push({ field: 'amount', value: form.amount.trim() });
  const name = form.description.trim();
  if (name !== '' && name !== draft.description) found.push({ field: 'name', value: name });
  if (form.occurredOn !== draft.occurredOn) found.push({ field: 'date', value: form.occurredOn });
  return found;
}
