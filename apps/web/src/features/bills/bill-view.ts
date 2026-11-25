import { BILL_DUE_SOON_DAYS, billPill, type BillTone, convertMinor, dayMonth, daysFrom, minorToMajorString, monthName, monthYear, periodMonthOf, thisBillMonth, weeklyMonthlyMinor } from '@expanses/core';
import type { BookMoney, MemberPayer, MonthlyBill, PurchasePayer } from '@expanses/db';
import type { Tone } from '../../ui/native/row';
import { payerLine } from '../sharing/sharing-copy';
import type { UnconvertedRow } from '../workspaces/Unconverted';

export const isSettled = (bill: MonthlyBill) => bill.state === 'paid' || bill.state === 'skipped';
/** A bill whose month is paused: nothing comes out, so it is neither owed nor counted. */
export const isPaused = (bill: Pick<MonthlyBill, 'state'>) => bill.state === 'paused';
/** A bill still to pay this month: not settled, not paused. */
export const isToPay = (bill: MonthlyBill) => !isSettled(bill) && !isPaused(bill);
const isOutAndUnpaid = (bill: MonthlyBill) => bill.state === 'overdue' || bill.state === 'dueSoon' || bill.state === 'open';

/** What a row is worth in a total: what it came to once paid, else its amount, else the estimate. */
export const amountOf = (bill: MonthlyBill) => (bill.state === 'paid' ? (bill.paidMinor ?? 0) : (bill.amountMinor ?? bill.estimateMinor ?? 0));

export const variesWords = (n: number) => (n === 1 ? '1 amount varies' : `${n} amounts vary`);

export interface BillSection {
  key: 'overdue' | 'dueSoon';
  title: string;
  rows: MonthlyBill[];
}

/** The bills still to deal with, most urgent first. What is paid or skipped is listed apart by `settledOf`. */
export function sectionsOf(rows: readonly MonthlyBill[]): BillSection[] {
  return [
    { key: 'overdue' as const, title: 'Overdue', rows: rows.filter((b) => b.state === 'overdue') },
    // Two groups only: a bill not yet near is listed with the ones coming up, not under a header of its own.
    { key: 'dueSoon' as const, title: 'Due soon', rows: rows.filter((b) => b.state === 'dueSoon' || b.state === 'open' || b.state === 'upcoming') },
  ].filter((section) => section.rows.length > 0);
}

/** The bills whose month is paused, for a group of their own under the ones to pay. */
export function pausedOf(rows: readonly MonthlyBill[]): MonthlyBill[] {
  return rows.filter(isPaused);
}

/** The month's paid and skipped bills, for the Paid group under the ones to pay. */
export function settledOf(rows: readonly MonthlyBill[]): MonthlyBill[] {
  return rows.filter(isSettled);
}

const sum = (rows: readonly MonthlyBill[]) => rows.reduce((total, b) => total + amountOf(b), 0);
const anyVaries = (rows: readonly MonthlyBill[]) => rows.some((b) => b.amountMinor === null);

export interface BillSummary {
  monthLabel: string;
  totalMinor: number;
  approximate: boolean;
  variesText: string | null;
  /** What the total is made of, for the bar and its key: only the parts with money in them. */
  parts: { key: 'overdue' | 'dueSoon'; label: string; minor: number; approximate: boolean }[];
  /** What was paid this month, and so what the whole month came to once the rest is added: skipped and paused bills count for nothing. */
  paidMinor: number;
  monthTotalMinor: number;
  allSettled: boolean;
  /** Nothing to pay because every bill is paused, which is not the same as all paid. */
  allPaused: boolean;
}

/** `monthStart` is the workspace's "Month starts on": the summary names the workspace's month that holds today. */
export function summaryOf(rows: readonly MonthlyBill[], today: string, monthStart = 1): BillSummary {
  const open = rows.filter(isToPay);
  const varying = open.filter((b) => b.amountMinor === null).length;
  const groups = [
    { key: 'overdue' as const, label: 'Overdue', rows: open.filter((b) => b.state === 'overdue') },
    { key: 'dueSoon' as const, label: 'Due soon', rows: open.filter((b) => b.state === 'dueSoon' || b.state === 'open' || b.state === 'upcoming') },
  ];
  return {
    monthLabel: monthName(periodMonthOf(today, monthStart), 'long'),
    totalMinor: sum(open),
    approximate: varying > 0,
    variesText: varying > 0 ? variesWords(varying) : null,
    parts: groups.filter((g) => sum(g.rows) > 0).map((g) => ({ key: g.key, label: g.label, minor: sum(g.rows), approximate: anyVaries(g.rows) })),
    paidMinor: sum(rows.filter((b) => b.state === 'paid')),
    monthTotalMinor: sum(open) + sum(rows.filter((b) => b.state === 'paid')),
    allSettled: open.length === 0,
    allPaused: open.length === 0 && rows.length > 0 && rows.every(isPaused),
  };
}

/**
 * The currency a bill's amount is written in: its own when it has one, else the money of the account that pays it —
 * every bill made before bills had a currency of their own.
 */
export function billCurrencyOf(bill: Pick<MonthlyBill, 'currency' | 'moneyAccountId'>, accounts: readonly { id: string; currency: string | null }[], baseCurrency: string): string {
  return bill.currency ?? accounts.find((account) => account.id === bill.moneyAccountId)?.currency ?? baseCurrency;
}

/**
 * Every bill in the currency the workspace reads in, so a total can add them up.
 *
 * A bill's amount is in its own currency when it has one, else in the money of the account that pays it, and a
 * workspace may be paid from accounts in several currencies: added up raw, a dollar bill and a rupiah bill would make a
 * figure that means nothing. Each is converted from its currency (`currencyOf`) at the rate on the day the bill comes
 * out — the day the money leaves — and one no rate reaches counts as nothing and is named, rather than being added in
 * as the wrong money. A bill already paid counts for what the account was charged, when the payment was a foreign one.
 *
 * A workspace reading in the owner's own currency converts nothing and gets its rows back untouched — except a bill
 * written in a currency of its own (`convertForeign`, when the money was asked for it): an SGD bill is the one figure
 * there that is not already in the workspace's money.
 */
export function billsInReadCurrency(
  rows: readonly MonthlyBill[],
  money: BookMoney | undefined,
  currencyOf: (bill: MonthlyBill) => string,
): { rows: MonthlyBill[]; unconverted: UnconvertedRow[] } {
  if (!money || (!money.converts && !money.convertForeign)) return { rows: [...rows], unconverted: [] };
  const missed = new Map<string, string>();
  const converted = rows.map((bill) => {
    const from = currencyOf(bill);
    // Reading in the owner's own money, only a bill with a currency of its own, other than that money, is converted.
    if (!money.converts && (!bill.currency || bill.currency === money.currency)) return bill;
    const convert = money.converts ? money.convert : money.convertForeign!;
    const onDate = bill.window.opensOn;
    const at = (minor: number | null, currency: string = from) => {
      if (minor === null) return null;
      const value = convert(minor, currency, onDate);
      if (value === null) {
        const earliest = missed.get(currency);
        if (!earliest || onDate < earliest) missed.set(currency, onDate);
      }
      return value ?? 0;
    };
    const paidMinor =
      bill.chargedMinor !== null && bill.chargedCurrency ? at(bill.chargedMinor, bill.chargedCurrency) : at(bill.paidMinor, bill.paidCurrency ?? from);
    return { ...bill, amountMinor: at(bill.amountMinor), paidMinor, estimateMinor: at(bill.estimateMinor) };
  });
  return { rows: converted, unconverted: [...missed].map(([currency, onDate]) => ({ currency, onDate })).sort((a, b) => a.currency.localeCompare(b.currency)) };
}

/**
 * What the account is charged for a bill written in another currency, as a figure for the "Charged in …" field: the bill's
 * amount at the rate known for the day, in the account's own money. Null when there is nothing to convert, the two
 * currencies match, or no rate is known — the field is then left to be typed, since a guess on a rate nobody has is worse
 * than an empty field. `rates` are against the base currency, as `resolveRates` gives them.
 */
export function chargedEstimate({
  amountMinor,
  billCurrency,
  payerCurrency,
  rates,
  baseCurrency,
}: {
  amountMinor: number;
  billCurrency: string;
  payerCurrency: string;
  rates: Record<string, number>;
  baseCurrency: string;
}): number | null {
  if (billCurrency === payerCurrency || !(amountMinor > 0)) return null;
  const leg = (code: string) => (code === baseCurrency ? 1 : (rates[code] ?? null));
  const from = leg(billCurrency);
  const to = leg(payerCurrency);
  if (from === null || to === null || !(to > 0)) return null;
  const charged = convertMinor(amountMinor, billCurrency, payerCurrency, from / to);
  return charged > 0 ? charged : null;
}

/** What the Cashflow card calls owed: every bill that is out and unpaid. */
export function owedNow(rows: readonly MonthlyBill[]): { minor: number; approximate: boolean } {
  const out = rows.filter(isOutAndUnpaid);
  return { minor: sum(out), approximate: anyVaries(out) };
}

/**
 * The account a bill's row names under its name: the one that paid the month, else the bill's own.
 *
 * In a shared workspace a month another member paid from an account of their own is posted here against that member's
 * placeholder (spec §4.4), which no list of this phone's accounts holds; nor does a bill that member pays by default.
 * Such a row reads as the same purchase reads on Cashflow (`payerLine`): the label the payer's phone gave the account,
 * and who paid — "Bayu Kartu ···· 0917 · paid by Bayu" — or, before that label is read, "Paid by Bayu". A month paid
 * from one of this member's own accounts names that account, as in a private workspace, unless someone else paid it.
 * An unpaid bill on a placeholder names its member, as the bill's own page does.
 */
export function billAccountName(
  bill: Pick<MonthlyBill, 'moneyAccountId' | 'paidFromAccountId'>,
  accounts: readonly { id: string; name: string }[],
  payer: PurchasePayer | null,
  memberPayers: ReadonlyMap<string, MemberPayer> | undefined,
): string {
  const accountId = bill.paidFromAccountId ?? bill.moneyAccountId;
  const own = accounts.find((account) => account.id === accountId);
  if (payer && !(payer.mine && own) && (payer.paidLabel || !payer.mine)) return payerLine(payer);
  if (own) return own.name;
  const member = memberPayers?.get(accountId);
  if (!member) return '';
  return bill.paidFromAccountId !== null && !member.self ? `Paid by ${member.name}` : member.name;
}

/** An older month's bill still owed is named by its month: older than this month's bill (`thisBillMonth`, "Month starts on"). */
export function sublineOf(bill: MonthlyBill, accountName: string, today: string, monthStart = 1): string {
  // A bill by weeks is keyed by its day, not a month: the day it is due is under its amount already.
  if (bill.repeat === 'weeks') return accountName;
  return bill.billMonth < thisBillMonth(today, bill.dayOfMonth, monthStart) ? `${monthName(bill.billMonth, 'short')} bill · ${accountName}` : accountName;
}

/** Each tone as a capsule on its own tinted ground, from the kit's panel tokens so a dark screen gets a dark pill. */
export const PILL_CLASS: Record<BillTone, string> = {
  grey: 'bg-[var(--ph-fill)] text-[var(--ph-ink-3)]',
  blue: 'bg-[var(--ph-info-panel)] text-[var(--ph-info-ink)]',
  amber: 'bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)]',
  red: 'bg-[var(--ph-alarm-panel)] text-[var(--ph-alarm-ink)]',
  green: 'bg-[var(--ph-up-panel)] text-[var(--ph-up-ink)]',
};

export function pillOf(bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn'>): { text: string; className: string } {
  const pill = billPill({ state: bill.state, days: bill.days }, bill.window, bill.paidOn);
  return { text: pill.text, className: PILL_CLASS[pill.tone] };
}

/**
 * The line under the amount on a bill's own page: where the bill stands, then its dates. The standing is the pill's own
 * wording (`pillOf`), now written in the line rather than in a pill; only a late or soon bill's words take a colour.
 * A bill not out yet reads "Due 10 Nov 2026 · opens 5 Nov"; a late one "Overdue 18 days · due 10 Oct 2026".
 */
export function heroLineOf(
  bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn'>,
  windowText: string,
): { lead: string | null; tone: 'alarm' | 'warn' | 'ink-3'; rest: string } {
  const { text } = pillOf(bill);
  const { payBy, opensOn } = bill.window;
  const due = `${dayMonth(payBy)} ${payBy.slice(0, 4)}`;
  switch (bill.state) {
    case 'overdue':
      return { lead: text, tone: 'alarm', rest: `due ${due}` };
    case 'dueSoon':
      return { lead: text, tone: 'warn', rest: `due ${due}` };
    case 'upcoming':
      return { lead: null, tone: 'ink-3', rest: opensOn === payBy ? windowText : `Due ${due} · opens ${dayMonth(opensOn)}` };
    case 'paid':
    case 'skipped':
    case 'paused':
      return { lead: text, tone: 'ink-3', rest: windowText };
    default:
      return { lead: null, tone: 'ink-3', rest: windowText };
  }
}

/**
 * The small line under a row's amount: how late, how soon, or the day it is due — the same states the pill names,
 * in fewer words. Late in alarm, soon in warning, the rest quiet.
 */
export function statusOf(bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn' | 'pausedUntil'>): { text: string; tone: Tone } {
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  switch (bill.state) {
    case 'overdue':
      return { text: `${days(bill.days)} late`, tone: 'alarm' };
    case 'dueSoon':
      return { text: bill.days === 0 ? 'due today' : `in ${days(bill.days)}`, tone: 'warn' };
    case 'open':
      return { text: dayMonth(bill.window.payBy), tone: 'ink-3' };
    case 'upcoming':
      // A bill that comes out before it is due says when it comes out; one due the day it comes out, just the day.
      return { text: bill.window.opensOn === bill.window.payBy ? dayMonth(bill.window.payBy) : `Opens ${dayMonth(bill.window.opensOn)}`, tone: 'ink-3' };
    case 'paid':
      return { text: bill.paidOn ? `Paid ${dayMonth(bill.paidOn)}` : 'Paid', tone: 'gain' };
    case 'skipped':
      return { text: 'Skipped', tone: 'ink-3' };
    case 'paused':
      return { text: bill.pausedUntil ? `until ${monthYear(bill.pausedUntil)}` : 'Paused', tone: 'ink-3' };
  }
}

/**
 * A bill's amount as it goes into a form field, in the currency of the account that pays it — the currency it is
 * parsed back in on save, so a USD bill of 1500 minor reads 15.00 and saves as 15.00. Empty when the amount varies.
 */
export function amountInput(amountMinor: number | null, currency: string): string {
  return amountMinor === null ? '' : minorToMajorString(amountMinor, currency);
}

/** The toast after recording: the bill by name when there was one, else how many. */
export function paidText(names: readonly string[]): string {
  return names.length === 1 ? `Paid ${names[0]}` : `Paid ${names.length} bills`;
}

/** The toast after a skip. Last month's or next month's bill is named, so the skip is not mistaken for this month's. */
export function skippedText(name: string, month: string, today: string, thisMonth: string = today.slice(0, 7)): string {
  return month === thisMonth ? `Skipped ${name} this month` : `Skipped ${name}’s ${monthName(month, 'long')} bill`;
}

/* ---------------------------------------------- bills by weeks (2026-11-25) ---------------------------------------------- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Tue, 15 Dec": a weekly bill's date as its list names it. */
export function weekdayDayMonth(date: string): string {
  const day = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();
  return `${WEEKDAYS[day]}, ${dayMonth(date)}`;
}

/** "3 weeks", or "1 week". */
export const weeksWords = (n: number) => (n === 1 ? '1 week' : `${n} weeks`);

/** Where a weekly bill's next due date stands on `today`: "Due · in 20 days", "Due today", "Overdue · 3 days". */
export function weeklyDueWords(nextDue: string, today: string): { text: string; tone: Tone } {
  const days = daysFrom(today, nextDue);
  const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  if (days < 0) return { text: `Overdue · ${plural(-days)}`, tone: 'alarm' };
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  return { text: `Due · in ${plural(days)}`, tone: days <= BILL_DUE_SOON_DAYS ? 'warn' : 'ink-3' };
}

/**
 * The line under a weekly bill's amount: "≈ Rp 1.448.000 a month · next 15 Dec" ("Amount varies · next 15 Dec"), or once
 * that day has passed unpaid, "… · overdue since 15 Dec".
 */
export function weeklyHeroLine(amountMinor: number | null, everyWeeks: number, nextDue: string, money: (minor: number) => string, today: string): string {
  const next = nextDue < today ? `overdue since ${dayMonth(nextDue)}` : `next ${dayMonth(nextDue)}`;
  return amountMinor === null ? `Amount varies · ${next}` : `≈ ${money(weeklyMonthlyMinor(amountMinor, everyWeeks))} a month · ${next}`;
}
