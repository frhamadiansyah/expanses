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
  /** Money out or in with no category of its own and none the merchant's history guesses. */
  needsCategory: boolean;
  /** No paying account — or, for a transfer, no account it went to. */
  needsAccount: boolean;
  /** No figure, or one the reader was not sure of: the owner checks it against what was captured. */
  checkAmount: boolean;
  /** Captured in event mode for a shared event: it is recorded on its form, where the move into the event is seen. */
  onForm: boolean;
  /** Everything the form's ✓ asks for is there (`canRecord`): the peek, where the capture is in view, may record it. */
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
  const complete = !needsCategory && !needsAccount && !sameAccount && draft.amountMinor !== 0;
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

/** What a row that is not a capture came in as: a statement's import, a row typed to finish later, a receipt, a voice note. */
const SOURCE_WORDS: Record<DraftRow['source'], string> = {
  csv: 'Import',
  manual: 'By hand',
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
  manual: 'added by hand',
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
