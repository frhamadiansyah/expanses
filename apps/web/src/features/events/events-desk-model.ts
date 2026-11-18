import { dayMonth, type EventPlanItemView, exponentOf, isExchangeResultKey } from '@expanses/core';
import type { EventRow, SharedEventSummary, SharedEventView } from '@expanses/db';
import { eventStatus } from './event-dates';
import { possessive } from './shared-view';

/*
 * The Mac Events pages (step 11, option A): the cards page and an event's own page, read as plain figures so they are
 * tested without drawing anything. Every figure comes from what the phone already reads — `eventStatus` for where an
 * event stands, the plan's own totals, the shared trip's view — so a card, a box and the phone never disagree.
 */

/** The cards page's two sections, in the phone list's order: running ones by start, then the most recent past first. */
export function eventGroups<E extends Pick<EventRow, 'startsOn' | 'endsOn' | 'finishedAt'>>(events: readonly E[], today: string): { now: E[]; past: E[] } {
  return {
    now: events.filter((event) => eventStatus(event, today) !== 'Done'),
    past: events.filter((event) => eventStatus(event, today) === 'Done').reverse(),
  };
}

export interface MenuRow {
  id: string;
  name: string;
  /** Its first day, short: "6 Jan". */
  when: string;
  current: boolean;
}

/** The title menu's lists: Now and next, then Past, each event with its first day and a ✓ on the one open. Empty lists are left out. */
export function titleMenu(events: readonly Pick<EventRow, 'id' | 'name' | 'startsOn' | 'endsOn' | 'finishedAt'>[], today: string, currentId: string): { title: string; rows: MenuRow[] }[] {
  const { now, past } = eventGroups(events, today);
  const row = (event: (typeof events)[number]): MenuRow => ({ id: event.id, name: event.name, when: dayMonth(event.startsOn), current: event.id === currentId });
  return [
    { title: 'Now and next', rows: now.map(row) },
    { title: 'Past', rows: past.map(row) },
  ].filter((section) => section.rows.length > 0);
}

/** "Shared · Rina", "Shared · Rina, Budi", "Shared · Rina +2", or "Shared" before anyone else is in it. */
export function sharedChip(summary: Pick<SharedEventSummary, 'people'> | undefined): string {
  const names = (summary?.people ?? []).map((person) => person.name);
  if (names.length === 0) return 'Shared';
  if (names.length <= 2) return `Shared · ${names.join(', ')}`;
  return `Shared · ${names[0]} +${names.length - 1}`;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;

/**
 * Whole months from today until the start, never fewer than one: 18 Nov → 18 Jan is two, → 17 Jan one, → 11 Dec one
 * (a month that has not run its course is not counted, and a start inside a month still leaves one month to save in).
 */
export function monthsUntil(today: string, startsOn: string): number {
  const [y1, m1, d1] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10))];
  const [y2, m2, d2] = [Number(startsOn.slice(0, 4)), Number(startsOn.slice(5, 7)), Number(startsOn.slice(8, 10))];
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(1, months);
}

/** How long until the start, said in the box's header: "8 weeks", "10 days", "1 day". */
export function untilWords(today: string, startsOn: string): string {
  const days = Math.max(0, dayNumber(startsOn) - dayNumber(today));
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  return `${Math.floor(days / 7)} weeks`;
}

/**
 * Before it starts (owner, 2026-11-18): what a planned private event still has to pay before its first day, and what
 * that is a month until then.
 *
 * To pay before then is the plan's own still-to-pay (`planTotals().toBuyMinor`): every cost not done, its estimate less
 * what was already paid towards it. A cost has no date of its own, so all of it is reckoned as due before the start.
 * A month is that over the whole months left (at least one), rounded up to a whole unit of the currency (whole rupiah),
 * so the months together never come to less than what is due.
 */
export function beforeItStarts(input: { toPayMinor: number; startsOn: string; today: string; currency: string }): { toPayMinor: number; months: number; aMonthMinor: number; until: string } {
  const toPayMinor = Math.max(0, input.toPayMinor);
  const months = monthsUntil(input.today, input.startsOn);
  const step = 10 ** exponentOf(input.currency);
  const aMonthMinor = Math.ceil(toPayMinor / months / step) * step;
  return { toPayMinor, months, aMonthMinor, until: untilWords(input.today, input.startsOn) };
}

/** Whether the event's third box is Before it starts: a private event with a plan, not started yet. */
export const startsAhead = (event: Pick<EventRow, 'startsOn' | 'finishedAt'>, today: string) => event.finishedAt === null && event.startsOn > today;

export type PlanStatusWord = 'To buy' | 'Paying' | 'Bought';

/** A cost's status in the Plan table: Bought once done (today's Done buying), Paying while payments come in, else To buy. */
export function planItemStatus(item: Pick<EventPlanItemView, 'done' | 'purchaseCount'>): PlanStatusWord {
  if (item.done) return 'Bought';
  return item.purchaseCount > 0 ? 'Paying' : 'To buy';
}

/** The Payments cell: "Baby store · 18 Sep" for one payment, "3 payments" for several, "—" for none. */
export function paymentsLine(item: Pick<EventPlanItemView, 'purchaseCount' | 'description' | 'occurredOn'>): string {
  if (item.purchaseCount === 0) return '—';
  if (item.purchaseCount === 1 && item.description) return item.occurredOn ? `${item.description} · ${dayMonth(item.occurredOn)}` : item.description;
  return `${item.purchaseCount} payments`;
}

/** The share of a bar, 0 to 100, never past either end and never a division by nought. */
export const barPercent = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, Math.round((part / whole) * 100))) : 0);

/**
 * The Plan box's line under its figure, from the plan's own totals: what is still to pay while anything is; once every
 * cost is paid, what is left of the plan — or, past it, by how much it went over (the gauge's own words).
 */
export function planLine(totals: { plannedMinor: number; plannedSpentMinor: number; toBuyMinor: number }): { kind: 'to-pay' | 'left' | 'over'; minor: number } {
  if (totals.toBuyMinor > 0) return { kind: 'to-pay', minor: totals.toBuyMinor };
  const left = totals.plannedMinor - totals.plannedSpentMinor;
  return left >= 0 ? { kind: 'left', minor: left } : { kind: 'over', minor: -left };
}

/** Only the parts of a transaction the Paid with box reads. */
export interface PaidWithTx {
  entries: readonly { accountKind: string; accountName: string; amountBaseMinor: number; accountSystemKey?: string | null }[];
}

/**
 * The third box of an event with no Before it starts (past, started or unplanned): what it spent by what paid for it,
 * largest first, each the phone's day figure for its rows (spending lines, never an exchange's gain or loss), and the
 * total as the rows' own sum — so the box always adds up the way it reads.
 */
export function paidWithRows(txs: readonly PaidWithTx[]): { rows: { name: string; minor: number }[]; totalMinor: number } {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    const spent = tx.entries.filter((entry) => entry.accountKind === 'expense' && !isExchangeResultKey(entry.accountSystemKey)).reduce((sum, entry) => sum + entry.amountBaseMinor, 0);
    if (spent === 0) continue;
    const name = tx.entries.find((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability')?.accountName ?? 'Other';
    totals.set(name, (totals.get(name) ?? 0) + spent);
  }
  const rows = [...totals.entries()].map(([name, minor]) => ({ name, minor })).sort((a, b) => b.minor - a.minor || a.name.localeCompare(b.name));
  return { rows, totalMinor: rows.reduce((sum, row) => sum + row.minor, 0) };
}

/** One person on a shared trip's Split costs box: what they paid, in the trip's currency. */
export interface PaidBy {
  personId: string;
  name: string;
  initials: string;
  isMe: boolean;
  minor: number;
}

/**
 * A shared trip's Split costs box: what each person paid (every expense counted on the page, by its payer, in the trip's
 * currency — together the trip's Total spent), how costs are shared ("Half each" while every expense is split equally
 * between the same two people, "Equal · 3 people" for more, else this person's own share), and the share figure.
 */
export function splitCostsBox(view: Pick<SharedEventView, 'people' | 'expenses' | 'myShareMinor' | 'myName' | 'me'>): { paidBy: PaidBy[]; rule: string; shareMinor: number } {
  const people = view.people.filter((person) => !person.removed);
  const paid = new Map<string, number>();
  const counted = view.expenses.filter((e) => !e.voided && !e.unreadable);
  for (const e of counted) paid.set(e.payerPersonId, (paid.get(e.payerPersonId) ?? 0) + e.eventAmountMinor);
  const paidBy = people.map((person) => ({ personId: person.personId, name: person.name, initials: person.initials, isMe: person.isMe, minor: paid.get(person.personId) ?? 0 }));
  // A payer since removed still paid: kept, so the rows add up to the trip's total.
  for (const [personId, minor] of paid) {
    if (paidBy.some((row) => row.personId === personId)) continue;
    const person = view.people.find((one) => one.personId === personId);
    paidBy.push({ personId, name: person?.name ?? 'Someone', initials: person?.initials ?? '?', isMe: false, minor });
  }
  const everyone = new Set(people.map((person) => person.personId));
  const equalAll =
    counted.length > 0 &&
    counted.every((e) => e.split.mode === 'equal' && e.split.people.length === everyone.size && e.split.people.every((id) => everyone.has(id)));
  const rule = equalAll ? (everyone.size === 2 ? 'Half each' : `Equal · ${everyone.size} people`) : `${possessive(view.myName)} share`;
  return { paidBy, rule, shareMinor: view.myShareMinor };
}
