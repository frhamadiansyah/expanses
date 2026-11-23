import { dueDateAfter, statementCycleFor } from '@expanses/core';
import { kindOf } from '../../app/sidebar-model';
import type { Tone } from '../../ui/desk';

/*
 * Mac Wallet in the v1 look (owner, 2026-11-23; docs/mockups/2026-11-21-mac-redesign-sidebar.html, Wallet): the bar's
 * All / Cards / Banks / Cash filter, the title's line, and each credit card's payment — what the bank asks for and by
 * when — that the Cards card prints under each face and Card payments lists. Figures are the page's own (the faces'
 * figures, the Balance box's Spending money, the card's last statement); this only picks and words them.
 */

export type WalletShow = 'all' | 'cards' | 'banks' | 'cash';

/**
 * Which filter a Wallet card belongs to: a credit card is Cards; money is Banks when it is a bank's (a current or
 * saving account, a deposit — the sidebar's bank kind) and Cash otherwise (cash, a digital wallet, electronic money).
 * Foreign money goes by what it is, not by its currency.
 */
export function showOf(item: { side: 'money' | 'credit'; subtype: string }): Exclude<WalletShow, 'all'> {
  if (item.side === 'credit') return 'cards';
  return kindOf({ subtype: item.subtype as Parameters<typeof kindOf>[0]['subtype'] }) === 'bank' ? 'banks' : 'cash';
}

/** Whether the filter shows a card. */
export const shows = (filter: WalletShow, item: { side: 'money' | 'credit'; subtype: string }): boolean => filter === 'all' || showOf(item) === filter;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The title's line: "3 cards · 4 accounts · Rp 412,6 jt in banks and cash" — the money part left out when unknown. */
export function walletLine(cards: number, accounts: number, money: string | null): string {
  return [plural(cards, 'card', 'cards'), plural(accounts, 'account', 'accounts'), money !== null ? `${money} in banks and cash` : null].filter(Boolean).join(' · ');
}

/** What a card's payment is about: a closed statement still to pay, the open one, a closed one paid, or nothing owed. */
export type PaymentState = 'due' | 'open' | 'paid' | 'clear' | 'no-day';

export interface CardPayment {
  state: PaymentState;
  /** What the bank asks for: the closed statement's left to pay, what is owed on the open one, or the bill paid. */
  amountMinor: number;
  /** The statement's date, closed or still to close; null for a card with no statement day. */
  statementOn: string | null;
  /** The statement has closed ("Statement closed 13 Nov"), or not yet ("Statement closes 28 Nov"). */
  closed: boolean;
  /** When it is to be paid by; null when nothing is owed or the card has no due day. */
  dueOn: string | null;
  tone: Tone;
}

const DAY = 86_400_000;
const daysTo = (today: string, on: string) => Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

/** The Due tag's colour: red once passed, orange within a week, grey later. */
export function dueTone(today: string, dueOn: string): Tone {
  const days = daysTo(today, dueOn);
  if (days < 0) return 'red';
  return days <= 7 ? 'orange' : 'grey';
}

/**
 * One credit card's payment, by one plain rule: the last closed statement while any of it is left to pay; else what is
 * owed now, on the statement still open, due the due day after it closes; else the last statement, paid. A card with
 * no statement or due day says only what it owes.
 *
 * `owedNowMinor` is the face's own figure (what is due on the card now); `last` is the last closed statement as
 * `cardStatement` reads it (null when there is none to read).
 */
export function cardPayment(input: {
  today: string;
  owedNowMinor: number;
  terms: { statementDay: number | null; dueDay: number | null } | null | undefined;
  last: { cycleEnd: string; closingMinor: number; leftToPayMinor: number | null } | null | undefined;
}): CardPayment {
  const { today, terms, last } = input;
  const owed = Math.max(0, input.owedNowMinor);
  if (!terms || terms.statementDay === null || terms.dueDay === null) {
    return { state: 'no-day', amountMinor: owed, statementOn: null, closed: false, dueOn: null, tone: 'grey' };
  }
  const { dueDay } = terms;
  const left = last ? Math.max(0, last.leftToPayMinor ?? 0) : 0;
  if (last && left > 0) {
    const dueOn = dueDateAfter(last.cycleEnd, dueDay);
    return { state: 'due', amountMinor: left, statementOn: last.cycleEnd, closed: true, dueOn, tone: dueTone(today, dueOn) };
  }
  const open = statementCycleFor(today, terms.statementDay);
  if (owed > 0) {
    const dueOn = dueDateAfter(open.end, dueDay);
    return { state: 'open', amountMinor: owed, statementOn: open.end, closed: false, dueOn, tone: dueTone(today, dueOn) };
  }
  if (last && last.closingMinor > 0) {
    return { state: 'paid', amountMinor: last.closingMinor, statementOn: last.cycleEnd, closed: true, dueOn: null, tone: 'green' };
  }
  return { state: 'clear', amountMinor: 0, statementOn: open.end, closed: false, dueOn: null, tone: 'grey' };
}

/** "13 Nov". */
export const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The line under a card in Card payments: "Statement closed 13 Nov", "Statement closes 28 Nov", "No statement day set". */
export function statementLine(payment: CardPayment): string {
  if (payment.statementOn === null) return 'No statement day set';
  return `Statement ${payment.closed ? 'closed' : 'closes'} ${dayMonth(payment.statementOn)}${payment.state === 'paid' ? ' · paid' : ''}`;
}

/** The tag beside it: "Due 28 Nov", "Paid", or none. */
export function dueTag(payment: CardPayment): string | null {
  if (payment.state === 'paid') return 'Paid';
  return payment.dueOn ? `Due ${dayMonth(payment.dueOn)}` : null;
}

/** Card payments' order: the soonest due first, then the rest by name. */
export function byDue<T extends { name: string; payment: CardPayment }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const x = a.payment.dueOn;
    const y = b.payment.dueOn;
    if (x && y && x !== y) return x.localeCompare(y);
    if (x && !y) return -1;
    if (!x && y) return 1;
    return a.name.localeCompare(b.name);
  });
}
