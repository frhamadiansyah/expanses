import { dayMonth, formatMinor, groupedMajorString } from '@expanses/core';

/*
 * Settings › Balance: a money account's starting balance, the figure on its As of day (owner, 22 Nov 2026). Changing it
 * changes the opening entry only, so every balance from that day on moves by the difference; the confirm says by how
 * much and what the balance today becomes, before anything is written.
 */

/** A stored balance as the amount field shows it: grouped, with a minus in front when it is below zero. */
export function startingBalanceText(minor: number, currency: string): string {
  return `${minor < 0 ? '-' : ''}${groupedMajorString(Math.abs(minor), currency)}`;
}

/** "1 Nov 2026". */
const longDay = (on: string) => `${dayMonth(on)} ${on.slice(0, 4)}`;

const signed = (minor: number, currency: string) => `${minor < 0 ? '−' : '+'}${formatMinor(Math.abs(minor), currency)}`;

/**
 * The confirm's words, its title and its body apart by a blank line (as Restore's are): "Change the starting balance?
 * — Every balance from 1 Nov 2026 moves by +Rp 200.000. Balance today becomes Rp 1.450.000."
 */
export function startingBalanceQuestion(p: { on: string; fromMinor: number; toMinor: number; todayMinor: number; currency: string }): string {
  const difference = p.toMinor - p.fromMinor;
  return `Change the starting balance?\n\nEvery balance from ${longDay(p.on)} moves by ${signed(difference, p.currency)}. Balance today becomes ${formatMinor(p.todayMinor + difference, p.currency)}.`;
}

/** Why an account with pockets has no Balance to change here. */
export const POCKETS_BALANCE_INFO = 'Each pocket keeps its own starting balance, in its own settings.';
