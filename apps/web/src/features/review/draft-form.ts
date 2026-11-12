/**
 * A captured draft, read into the Add form and written back out of it.
 *
 * Review opens a draft on the very card that adds a transaction, so the owner learns one form. The card holds a
 * `FormDraft` — a typed figure, always positive, and a tab — while a draft holds a signed figure in minor units
 * (positive is money out of its account, negative money in) and a kind. These are the two directions between
 * them, the rule for when the ✓ may record, and which fields the owner corrected against what was read: the
 * corrections are what teach a source its layout.
 */
import { evaluateExact } from '@expanses/core';
import type { AccountRow, DraftRow, NewDraft } from '@expanses/db';
import { chargedFigure, DECIMALS_REFUSAL, decimalsDirection, estimatedChargeMinor, type FormDraft, suggestedRate, typedCurrency } from '../transactions/tx-form';
import { majorText } from './capture-view';

/**
 * What `editDraft` takes: everything the form can change about a draft. The exact figure is optional, and named only
 * when the figure was typed with cents: left out, `editDraft` keeps the draft's own while the amount, currency and
 * kind stand, and clears it when any of them changes.
 */
export type DraftPatch = Required<
  Pick<NewDraft, 'kind' | 'accountId' | 'toAccountId' | 'categoryAccountId' | 'cardId' | 'amountMinor' | 'currency' | 'description' | 'occurredOn'>
> &
  Pick<NewDraft, 'exactHundredths'>;

/**
 * Whether recording a draft has to be done on its form (event mode fix round 1): one captured in event mode for a shared
 * event moves into that event when it is recorded, so it is recorded where that is seen — never by a swipe or a table
 * row that would record it silently, without the event.
 */
export function recordsOnForm(draft: Pick<DraftRow, 'eventId'>, sharedEvents: Readonly<Record<string, unknown>>): boolean {
  return !!draft.eventId && !!sharedEvents[draft.eventId];
}

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
    // Captured in event mode: the event is already picked, on the form's own Event row, to keep or take off.
    ...(draft.eventId ? { eventId: draft.eventId } : {}),
  };
}

/**
 * The currency the form's figure is read in: the form's own answer (`typedCurrency` — the flag, and for a transfer,
 * which has none, the From account's), else the one the draft was read in.
 */
const currencyOf = (form: FormDraft, draft: Pick<DraftRow, 'currency'>, accounts: readonly AccountRow[]) => typedCurrency(form, accounts) || draft.currency;

/**
 * The form's figure in minor units, with the exact figure of one typed with cents (rounded up for money out, down for
 * money in, as the Add form does), or null when it is not a positive amount. A transfer takes no cents.
 */
function read(form: FormDraft, draft: Pick<DraftRow, 'currency'>, accounts: readonly AccountRow[]): { minor: number; exactHundredths: number | null } | null {
  const result = evaluateExact(form.amount, currencyOf(form, draft, accounts), { fractional: decimalsDirection(form) ?? undefined });
  return result !== null && result.minor > 0 ? result : null;
}

const figure = (form: FormDraft, draft: Pick<DraftRow, 'currency'>, accounts: readonly AccountRow[]): number | null => read(form, draft, accounts)?.minor ?? null;

/** Whether a figure refused for a tab that takes no cents would have read with them. */
const centsRefused = (form: FormDraft, draft: Pick<DraftRow, 'currency'>, accounts: readonly AccountRow[]): boolean =>
  decimalsDirection(form) === null && (evaluateExact(form.amount, currencyOf(form, draft, accounts), { fractional: 'up' })?.exactHundredths ?? null) !== null;

/**
 * The form, written back onto the draft before it is confirmed — `confirmDraft` reads the row, so what the owner
 * chose has to be there first. Money in goes back negative, everything else positive. Throws when the figure is not
 * a positive amount. The figure stays in the currency it is read in: what an account in another currency was charged
 * is the posting's (`chargedFigure`), never the draft's.
 */
export function draftPatch(form: FormDraft, draft: Pick<DraftRow, 'currency' | 'description'>, accounts: readonly AccountRow[]): DraftPatch {
  if (form.mode === 'trade') throw new Error('A capture is recorded as an expense, income or a transfer');
  const figured = read(form, draft, accounts);
  if (figured === null) throw new Error(centsRefused(form, draft, accounts) ? DECIMALS_REFUSAL : 'Amount must be greater than zero');
  const { minor, exactHundredths } = figured;
  const transfer = form.mode === 'transfer';
  return {
    kind: form.mode,
    accountId: form.moneyId || null,
    toAccountId: transfer ? form.toId || null : null,
    categoryAccountId: transfer ? null : form.categoryId || null,
    // A card is a way to pay: it says nothing about money arriving or moving.
    cardId: form.mode === 'expense' ? form.cardId || null : null,
    amountMinor: form.mode === 'income' ? -minor : minor,
    currency: currencyOf(form, draft, accounts),
    description: form.description.trim() || draft.description,
    occurredOn: form.occurredOn,
    ...(exactHundredths !== null ? { exactHundredths } : {}),
  };
}

/**
 * Whether the ✓ may record: an account, a category (or a different To for a transfer), a figure — and, for a figure in
 * a currency the account does not hold, what the account was charged.
 */
export function canRecord(form: FormDraft, draft: Pick<DraftRow, 'currency'>, accounts: readonly AccountRow[]): boolean {
  if (form.mode === 'trade' || !form.moneyId) return false;
  if (form.mode === 'transfer' ? !form.toId || form.toId === form.moneyId : !form.categoryId) return false;
  if (figure(form, draft, accounts) === null) return false;
  try {
    chargedFigure(form, accounts);
    return true;
  } catch {
    return false;
  }
}

/** A draft's own currency and the one its paying account settles in, when they differ; null when there is no such pair. */
export function foreignPair(draft: Pick<DraftRow, 'currency' | 'accountId'>, accounts: readonly AccountRow[]): { from: string; to: string } | null {
  const settled = accounts.find((account) => account.id === draft.accountId)?.currency;
  return settled && settled !== draft.currency ? { from: draft.currency, to: settled } : null;
}

/** What recording a foreign draft without the form comes to: the charge to post, or the form, where it is asked. */
export type QuickCharge = { kind: 'charged'; amountMinor: number; currency: string } | { kind: 'ask' };

/**
 * What the account was charged for a foreign draft recorded straight from the queue: the read figure at its day's
 * rate, the very conversion the form's "Charged in …" row opens on (`estimatedChargeMinor`).
 *
 * Nobody sees this figure before it posts, so it is worked out only from the day's own rate. A rate that is missing,
 * or the last one known from some other day, asks on the form instead, where the figure is shown before it is
 * recorded. So does a transfer, whose figure is the From account's own and has no charge beside it.
 */
export function quickCharge(
  draft: Pick<DraftRow, 'kind' | 'amountMinor'>,
  pair: { from: string; to: string },
  rates: { rates: Record<string, number>; stale: readonly string[]; missing: readonly string[] } | null,
  baseCurrency: string,
): QuickCharge {
  if (draft.kind === 'transfer' || rates === null) return { kind: 'ask' };
  if ([pair.from, pair.to].some((code) => rates.missing.includes(code) || rates.stale.includes(code))) return { kind: 'ask' };
  const rate = suggestedRate({ rates: rates.rates, from: pair.from, to: pair.to, base: baseCurrency });
  const amountMinor = estimatedChargeMinor({ minor: Math.abs(draft.amountMinor), currency: pair.from, accountCurrency: pair.to, rate });
  return amountMinor === null ? { kind: 'ask' } : { kind: 'charged', amountMinor, currency: pair.to };
}

export interface Correction {
  field: 'amount' | 'name' | 'date';
  value: string;
}

/** The fields the owner changed against what was read, with what they put there — each one teaches the source. */
export function corrections(form: FormDraft, draft: DraftRow, accounts: readonly AccountRow[]): Correction[] {
  const found: Correction[] = [];
  const minor = figure(form, draft, accounts);
  if (minor !== null && minor !== Math.abs(draft.amountMinor)) found.push({ field: 'amount', value: form.amount.trim() });
  const name = form.description.trim();
  if (name !== '' && name !== draft.description) found.push({ field: 'name', value: name });
  if (form.occurredOn !== draft.occurredOn) found.push({ field: 'date', value: form.occurredOn });
  return found;
}
