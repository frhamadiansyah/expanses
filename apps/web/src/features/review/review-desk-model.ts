import { dayMonth, isoDate } from '@expanses/core';
import type { AccountRow, CardRow, CaptureSource, DraftRow } from '@expanses/db';
import { CAPTURE_TYPES, type CaptureType } from './capture-type';
import { captureRowView, effectiveCategory } from './capture-view';
import { recordsOnForm } from './draft-form';

/*
 * Review on a wide screen (Mac Review, owner 2026-11-17): the queue as a table you work through, with the counts above
 * it. Every rule here is the phone's own — what a swipe may record (`swipeRecord`), what the form may record
 * (`canRecord`), what the row asks for — so the table, the counts strip and the peek can never disagree with the phone,
 * the sidebar's badge or Cashflow's To review.
 */

/** Where one draft stands: what it still needs, and whether it may be recorded from the table or the peek. */
export interface DeskDraftState {
  /**
   * Money out or in with no category of its own and none the merchant's history guesses. It holds nothing back (one
   * record rule, owner 2026-11-21): recorded so, the row is filed under the book's Uncategorised, as Cashflow files it,
   * and found again by Cashflow's "Waiting for a category". It is counted, to fix later.
   */
  needsCategory: boolean;
  /** No paying account — or, for a transfer, no account it went to. */
  needsAccount: boolean;
  /** No figure, or one the reader was not sure of: the owner checks it against what was captured. */
  checkAmount: boolean;
  /** Captured in event mode for a shared event: it is recorded on its form, where the move into the event is seen. */
  onForm: boolean;
  /**
   * What a record needs is there — an account (and a different one it went to, for a transfer) and a figure: the peek,
   * where the capture is in view, may record it. A blank category is not asked for (filed under Uncategorised).
   */
  complete: boolean;
  /**
   * What a swipe may record on the phone (`swipeRecord`): complete, its figure sure, and not one for its form. The row's
   * Record, Return on it and "Record N ready" record these, and only these.
   */
  ready: boolean;
}

export function deskState(
  draft: DraftRow,
  source: CaptureSource | null,
  guesses: Readonly<Record<string, string | null>> | undefined,
  sharedEvents: Readonly<Record<string, unknown>>,
): DeskDraftState {
  const transfer = draft.kind === 'transfer';
  const needs = captureRowView(draft, source).needs;
  const needsCategory = !transfer && !effectiveCategory(draft, guesses);
  const needsAccount = needs.includes('account') || needs.includes('to-account');
  const checkAmount = needs.includes('amount');
  const onForm = recordsOnForm(draft, sharedEvents);
  const sameAccount = transfer && draft.accountId !== null && draft.accountId === draft.toAccountId;
  // One rule with Cashflow's Record: a date, an amount and Paid with. A category left blank files it under Uncategorised.
  const complete = !needsAccount && !sameAccount && draft.amountMinor !== 0;
  return { needsCategory, needsAccount, checkAmount, onForm, complete, ready: complete && !checkAmount && !onForm };
}

/** The counts strip: the queue (the sidebar's badge and Cashflow's To review count the same rows), then what each needs. */
export interface QueueCounts {
  toReview: number;
  ready: number;
  needCategory: number;
  needAccount: number;
  checkAmount: number;
}

export function queueCounts(states: readonly DeskDraftState[]): QueueCounts {
  return {
    toReview: states.length,
    ready: states.filter((s) => s.ready).length,
    needCategory: states.filter((s) => s.needsCategory).length,
    needAccount: states.filter((s) => s.needsAccount).length,
    checkAmount: states.filter((s) => s.checkAmount).length,
  };
}

/**
 * What a row that is not a capture came in as: a statement's import, a receipt, a voice note — or "Cashflow", a row typed
 * or pasted into Cashflow's table to finish later (it waits there too; the draft does not say which of the two it was).
 */
const SOURCE_WORDS: Record<DraftRow['source'], string> = {
  csv: 'Import',
  manual: 'Cashflow',
  voice: 'Voice',
  receipt: 'Receipt',
  email: 'Email',
  notification: 'Notification',
  screen: 'Screenshot',
  photo: 'Photo',
};

/** The From column's tag: a capture's kind in the phone's own word (`CAPTURE_TYPES`), else the door the row came in by. */
export function fromTag(draft: Pick<DraftRow, 'source'>, type: CaptureType | null): { word: string; type: CaptureType | null } {
  return { word: type ? CAPTURE_TYPES[type].word : SOURCE_WORDS[draft.source], type };
}

/**
 * The When column: "Today 08:12", "Yesterday 21:03", "14 Nov". The time is when the phone noticed a capture, said only
 * when that was on the day it is dated — an import or a row typed later has no time worth saying.
 */
export function whenText(draft: Pick<DraftRow, 'occurredOn' | 'createdAt'>, captured: boolean, now: Date = new Date()): string {
  const today = isoDate(now);
  const yesterday = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const day = draft.occurredOn === today ? 'Today' : draft.occurredOn === yesterday ? 'Yesterday' : dayMonth(draft.occurredOn);
  if (!captured || !draft.createdAt) return day;
  const at = new Date(draft.createdAt);
  if (Number.isNaN(at.getTime()) || isoDate(at) !== draft.occurredOn) return day;
  return `${day} ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** The queue newest first, as the phone's days run: by the day it is dated, then by when it arrived. */
export function newestFirst<T extends Pick<DraftRow, 'occurredOn' | 'createdAt'>>(drafts: readonly T[]): T[] {
  return [...drafts].sort((a, b) => (a.occurredOn !== b.occurredOn ? (a.occurredOn < b.occurredOn ? 1 : -1) : (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
}

/**
 * The Paid with column: the account, and the card's digits when one card paid (the draft's own card, else the account's
 * only card) — "BCA Visa 1467", as Cashflow's table reads. Null while no account is chosen.
 */
export function paidWithOf(
  accountId: string | null,
  cardId: string | null,
  accounts: readonly Pick<AccountRow, 'id' | 'name'>[],
  cards: readonly Pick<CardRow, 'id' | 'accountId' | 'last4' | 'archived'>[],
): { name: string; last4: string | null } | null {
  const account = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  if (!account) return null;
  const own = cards.filter((card) => card.accountId === account.id && !card.archived);
  const card = (cardId ? own.find((c) => c.id === cardId) : undefined) ?? (own.length === 1 ? own[0] : undefined);
  return { name: account.name, last4: card?.last4 ?? null };
}

/**
 * Where the peek goes once the row it showed has left the queue (recorded or discarded): the row that took its place,
 * else the one before it, else nowhere.
 */
export function peekAfterGone(ids: readonly string[], index: number): string | null {
  if (ids.length === 0) return null;
  return ids[Math.min(index, ids.length - 1)] ?? null;
}

/** A key pressed on the queue, with a row peeked: what it asks for. Typing, or a sheet open, asks for nothing. */
export type QueueKey = 'record' | 'discard' | 'up' | 'down' | 'close' | null;

export function queueKey(key: string): QueueKey {
  switch (key) {
    case 'Enter':
      return 'record';
    case 'Backspace':
    case 'Delete':
      return 'discard';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'Escape':
      return 'close';
    default:
      return null;
  }
}

/** How a capture came in, said after its time in the peek: "from a notification", "from an import". */
const FROM_PHRASES: Record<CaptureType, string> = {
  sms: 'from an SMS',
  whatsapp: 'from WhatsApp',
  notification: 'from a notification',
  email: 'from an email',
  screenshot: 'from a screenshot',
  photo: 'from a photo',
  nfc: 'from a card tap',
};
const SOURCE_PHRASES: Record<DraftRow['source'], string> = {
  csv: 'from an import',
  manual: 'typed or pasted in Cashflow',
  voice: 'from a voice note',
  receipt: 'from a receipt',
  email: 'from an email',
  notification: 'from a notification',
  screen: 'from a screenshot',
  photo: 'from a photo',
};

export function fromPhrase(draft: Pick<DraftRow, 'source'>, type: CaptureType | null): string {
  return type ? FROM_PHRASES[type] : SOURCE_PHRASES[draft.source];
}

/**
 * The table's columns that step aside, by the room its box has, so no figure is cut: the account it was paid with goes
 * last (it is a question the row asks), then When, the row's Discard (the peek and ⌫ still discard), and From first —
 * the peek says both where a capture came from and when. Zero (not measured yet) shows them all.
 */
export interface DeskColumns {
  paidWith: boolean;
  when: boolean;
  discard: boolean;
  from: boolean;
}

/** Tick, Description at its narrowest, Amount, Category and Record: the columns that always stay. */
const BASE_WIDTH = 30 + 150 + 100 + 150 + 76;
const STEP_ASIDE: readonly (readonly [keyof DeskColumns, number])[] = [
  ['paidWith', 150],
  ['when', 110],
  ['discard', 70],
  ['from', 100],
];

export function deskColumns(width: number): DeskColumns {
  const shown: DeskColumns = { paidWith: true, when: true, discard: true, from: true };
  if (width === 0) return shown;
  let used = BASE_WIDTH;
  let room = true;
  for (const [key, needs] of STEP_ASIDE) {
    room = room && used + needs <= width;
    shown[key] = room;
    if (room) used += needs;
  }
  return shown;
}

/*
 * The table's header filters (owner, 2026-11-24: docs/mockups/2026-11-24-mac-review-header-filter.html): each column
 * name narrows the rows — Note by words, When by From / To, Category and Paid with by one value or none. They hold for
 * the visit only. A filter left empty narrows nothing.
 */

/** "No category", or no account: the one value a Category or Paid with filter can hold that names nothing. */
export const NONE = '';

export interface ReviewFilters {
  /** Words the note or the line under it holds (any case, accents left out). */
  note: string;
  /** The first and last day shown (ISO dates, both kept); null for no bound. */
  from: string | null;
  to: string | null;
  /** A category's id, or `NONE` for no category; null for any. */
  category: string | null;
  /** An account's id, or `NONE` for none; null for any. */
  paid: string | null;
}

export const NO_FILTERS: ReviewFilters = { note: '', from: null, to: null, category: null, paid: null };

/** Whether any filter narrows the rows. */
export const anyFilter = (filters: ReviewFilters) => filters.note.trim() !== '' || filters.from !== null || filters.to !== null || filters.category !== null || filters.paid !== null;

/** Words as matched: any case, accents left out ("Café" is "cafe"), spaces as one. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** What a row is matched on: its day, its note and the line under it, its category (as shown), its account. */
export interface FilterRow {
  occurredOn: string;
  note: string;
  /** The line under the note: where it came from, what it was merged with. */
  line: string;
  categoryId: string | null;
  accountId: string | null;
}

export function matchesFilters(row: FilterRow, filters: ReviewFilters): boolean {
  const words = fold(filters.note);
  if (words && !fold(`${row.note} ${row.line}`).includes(words)) return false;
  if (filters.from !== null && row.occurredOn < filters.from) return false;
  if (filters.to !== null && row.occurredOn > filters.to) return false;
  if (filters.category !== null && (row.categoryId ?? NONE) !== filters.category) return false;
  if (filters.paid !== null && (row.accountId ?? NONE) !== filters.paid) return false;
  return true;
}

/** The first and last day of the month `back` months before the one `today` is in: This month (0), Last month (1). */
export function monthBounds(today: string, back: number): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 - back;
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** What a When filter holds, as its header says it: "1–30 Sep", "28 Aug – 3 Sep", "from 1 Sep", "to 30 Sep". */
export function whenFilterText(from: string | null, to: string | null): string {
  if (from && to) {
    if (from === to) return dayMonth(from);
    if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${dayMonth(to)}`;
    return `${dayMonth(from)} – ${dayMonth(to)}`;
  }
  if (from) return `from ${dayMonth(from)}`;
  if (to) return `to ${dayMonth(to)}`;
  return '';
}

/** The table's title line while a filter is on: "6 of 24 shown". */
export const shownLine = (shown: number, of: number) => `${shown} of ${of} shown`;
