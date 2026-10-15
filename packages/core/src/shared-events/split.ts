import { convertMinor } from '../money/money';

/*
 * A shared event's arithmetic (shared events spec §4). An expense keeps its own currency and the rate to the event's
 * currency it was recorded with, as a decimal string, so every phone converts it with the same figure. Each person's
 * share is converted on its own, half away from zero — the one rounding rule `convertMinor` already uses — and the
 * payer's "paid" figure is the sum of those converted shares, never the total converted once: that is what makes every
 * expense net to exactly zero in the event currency, however the units fall.
 */

export type SharedEventErrorCode = 'SPLIT_MISMATCH' | 'EMPTY_SPLIT' | 'DUPLICATE_PERSON' | 'BAD_RATE' | 'BAD_AMOUNT' | 'UNBALANCED' | 'BAD_SETTLEMENT';

export class SharedEventError extends Error {
  readonly code: SharedEventErrorCode;

  constructor(code: SharedEventErrorCode, message: string) {
    super(message);
    this.name = 'SharedEventError';
    this.code = code;
  }
}

export interface PersonMinor {
  personId: string;
  minor: number;
}

/**
 * Who shares an expense. `equal` lists the people ticked when it was recorded — "everyone" is written out (ruling R7),
 * so a person added to the event later is never silently in an older expense. `amounts` gives each person's share in
 * the expense's own currency.
 */
export type SplitInput = { mode: 'equal'; people: readonly string[] } | { mode: 'amounts'; shares: readonly PersonMinor[] };

export interface ExpenseRecord {
  id: string;
  /** In `currency`'s minor units, above zero. */
  amountMinor: number;
  currency: string;
  /** Units of the event currency per one unit of `currency`, as a decimal string; '1' in the event currency. */
  rateToEvent: string;
  payerPersonId: string;
  split: SplitInput;
  voided: boolean;
}

export interface SettlementRecord {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  /** In the event currency's minor units, above zero. */
  amountMinor: number;
  voided: boolean;
}

function refuseDuplicates(people: readonly string[]): void {
  if (new Set(people).size !== people.length) throw new SharedEventError('DUPLICATE_PERSON', 'A person is in a split once');
}

/**
 * Each person's share of an expense, in the expense's own currency. An equal split gives every person the same whole
 * number of minor units, and the units left over all go to one person: the payer when the payer is in the split, else
 * the first person listed. An amounts split must add up to the total exactly.
 */
export function sharesOf(expense: Pick<ExpenseRecord, 'amountMinor' | 'payerPersonId' | 'split'>): PersonMinor[] {
  const total = expense.amountMinor;
  if (!Number.isSafeInteger(total) || total <= 0) throw new SharedEventError('BAD_AMOUNT', 'An expense is a whole number of minor units above zero');
  const split = expense.split;
  if (split.mode === 'amounts') {
    if (split.shares.length === 0) throw new SharedEventError('EMPTY_SPLIT', 'An expense is shared by at least one person');
    refuseDuplicates(split.shares.map((s) => s.personId));
    for (const share of split.shares) {
      if (!Number.isSafeInteger(share.minor) || share.minor < 0) throw new SharedEventError('BAD_AMOUNT', 'A share is a whole number of minor units, zero or more');
    }
    const sum = split.shares.reduce((acc, s) => acc + s.minor, 0);
    if (sum !== total) throw new SharedEventError('SPLIT_MISMATCH', `The shares add up to ${sum}, the expense is ${total}`);
    return split.shares.map((s) => ({ personId: s.personId, minor: s.minor }));
  }
  if (split.people.length === 0) throw new SharedEventError('EMPTY_SPLIT', 'An expense is shared by at least one person');
  refuseDuplicates(split.people);
  const each = Math.floor(total / split.people.length);
  const leftover = total - each * split.people.length;
  const takes = split.people.includes(expense.payerPersonId) ? expense.payerPersonId : split.people[0]!;
  return split.people.map((personId) => ({ personId, minor: each + (personId === takes ? leftover : 0) }));
}

/** The rate format a record carries: digits, an optional point and more digits, above zero. Never an exponent. */
const RATE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function isRateString(text: string): boolean {
  return RATE.test(text) && Number(text) > 0;
}

/**
 * A typed or derived rate as the decimal string a record carries: twelve places at most, trailing zeros dropped. A rate
 * too small to show in twelve places is refused rather than written as 0.
 */
export function rateString(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) throw new SharedEventError('BAD_RATE', `A rate is a number above zero, got ${rate}`);
  const text = rate.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  if (!isRateString(text)) throw new SharedEventError('BAD_RATE', `The rate ${rate} is too small to keep`);
  return text;
}

/**
 * One amount in the event currency: the one conversion every screen and every phone uses (spec §4). In the event's own
 * currency the rate must be '1' and the amount is returned as it is.
 */
export function toEvent(minor: number, currency: string, rateToEvent: string, eventCurrency: string): number {
  if (!isRateString(rateToEvent)) throw new SharedEventError('BAD_RATE', `"${rateToEvent}" is not a rate`);
  if (currency === eventCurrency) {
    if (Number(rateToEvent) !== 1) throw new SharedEventError('BAD_RATE', 'An expense in the event currency has rate 1');
    return minor;
  }
  return convertMinor(minor, currency, eventCurrency, Number(rateToEvent));
}

/** An expense in the event currency: each share converted on its own, and what the payer paid as their sum. */
export function expenseInEvent(expense: ExpenseRecord, eventCurrency: string): { paidMinor: number; shares: PersonMinor[] } {
  const shares = sharesOf(expense).map((s) => ({ personId: s.personId, minor: toEvent(s.minor, expense.currency, expense.rateToEvent, eventCurrency) }));
  return { paidMinor: shares.reduce((sum, s) => sum + s.minor, 0), shares };
}

/** `split_json` as the spec gives it: `[personId…]` for equal, `[{personId, minor}]` for amounts. */
export function splitJsonOf(split: SplitInput): string {
  return JSON.stringify(split.mode === 'equal' ? [...split.people] : split.shares.map((s) => ({ personId: s.personId, minor: s.minor })));
}

/** Reads `split_mode` and `split_json` back; malformed peer data is a `SharedEventError`, never a crash. */
export function parseSplitJson(mode: string, json: string): SplitInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SharedEventError('EMPTY_SPLIT', 'The split is not readable');
  }
  if (!Array.isArray(parsed)) throw new SharedEventError('EMPTY_SPLIT', 'The split is not readable');
  if (mode === 'equal' && parsed.every((p) => typeof p === 'string')) return { mode: 'equal', people: parsed as string[] };
  if (mode === 'amounts' && parsed.every((p) => p && typeof p === 'object' && typeof (p as PersonMinor).personId === 'string' && Number.isSafeInteger((p as PersonMinor).minor))) {
    return { mode: 'amounts', shares: (parsed as PersonMinor[]).map((p) => ({ personId: p.personId, minor: p.minor })) };
  }
  throw new SharedEventError('EMPTY_SPLIT', 'The split is not readable');
}
