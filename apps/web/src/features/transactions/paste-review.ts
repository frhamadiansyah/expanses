import type { PurchaseLine } from '@expanses/core';
import { pastMarkDefault, type AccountRow, type PostTransactionInput } from '@expanses/db';
import { quickToInput } from './quick-row';

/**
 * The review step of "Paste a list": what each line of the pasted list has become, and the questions the screen asks
 * of the whole (how many lines, whether Save can be pressed, the total). Pure, so the counts and the posting are
 * tested without a screen.
 */
export interface ReviewRow {
  /** The line in the pasted text: the row's identity for as long as the review lasts. */
  lineNo: number;
  note: string;
  /** Minor units of the paying account's currency; null while the line has no readable amount ("Not read"). */
  amountMinor: number | null;
  /** '' while no category is chosen: the purchase is then filed under Uncategorised. */
  categoryId: string;
  occurredOn: string;
  /** The amount looked like a slip (tiny, rounded, ambiguous): drawn outlined until it is retyped. */
  flagged: boolean;
  /** The line named no date in the list, so it took the page's date; cleared once the owner sets a date on the row. */
  noListDate?: boolean;
}

/**
 * The parsed lines as review rows. A date line above a line sets its day, otherwise the page's date applies. `guesses`
 * is the category the note's history suggests, by line number; a missing or null guess leaves the row without one.
 */
export function reviewRowsFrom(lines: readonly PurchaseLine[], pageDate: string, guesses: Readonly<Record<number, string | null | undefined>> = {}): ReviewRow[] {
  return lines.map((line) => ({
    lineNo: line.lineNo,
    note: line.note,
    amountMinor: line.amountMinor,
    categoryId: guesses[line.lineNo] ?? '',
    occurredOn: line.occurredOn ?? pageDate,
    flagged: line.status === 'suspicious',
    noListDate: line.occurredOn === null,
  }));
}

/** The rows with an amount, and those without ("Not read"), each in the order of the pasted text. */
/**
 * What the Date row of the paste screen says, from the lines as read: `all` when every line took its own date from the
 * list (the page date is then never used), `some` when only part did, `none` when no line did or there are no lines.
 */
export type DateRowMode = 'none' | 'some' | 'all';
export function dateRowMode(lines: readonly Pick<PurchaseLine, 'occurredOn'>[]): DateRowMode {
  const dated = lines.filter((line) => line.occurredOn !== null).length;
  if (dated === 0) return 'none';
  return dated === lines.length ? 'all' : 'some';
}

export interface DayGroup {
  date: string;
  rows: ReviewRow[];
  /** The sum of the rows' amounts; rows without an amount add nothing. */
  totalMinor: number;
}

/** The rows with an amount grouped by their own day, oldest day first; rows keep the order of the pasted text within a day. */
export function dayGroups(rows: readonly ReviewRow[]): DayGroup[] {
  const byDay = new Map<string, DayGroup>();
  for (const row of rows) {
    const group = byDay.get(row.occurredOn) ?? { date: row.occurredOn, rows: [], totalMinor: 0 };
    group.rows.push(row);
    group.totalMinor += row.amountMinor ?? 0;
    byDay.set(row.occurredOn, group);
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function sections(rows: readonly ReviewRow[]): { read: ReviewRow[]; unread: ReviewRow[] } {
  return { read: rows.filter((row) => row.amountMinor !== null), unread: rows.filter((row) => row.amountMinor === null) };
}

export interface ReviewCounts {
  /** Every line still in the review. */
  total: number;
  /** Lines with an amount: all that Save needs. A missing category is filed under Uncategorised. */
  ready: number;
  unread: number;
  /** Lines with an amount and no category yet. */
  needCategory: number;
}

export function reviewCounts(rows: readonly ReviewRow[]): ReviewCounts {
  const ready = rows.filter((row) => row.amountMinor !== null);
  return { total: rows.length, ready: ready.length, unread: rows.length - ready.length, needCategory: ready.filter((row) => !row.categoryId).length };
}

/** Save is for a review that still has lines, every one with an amount. */
export function canSave(rows: readonly ReviewRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.amountMinor !== null);
}

export function totalMinor(rows: readonly ReviewRow[]): number {
  return rows.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "4 lines" when all are ready, "3 of 5 lines ready" while some are not read. */
export function reviewHeader(rows: readonly ReviewRow[]): string {
  const { total, ready } = reviewCounts(rows);
  return ready === total ? plural(total, 'line', 'lines') : `${ready} of ${plural(total, 'line', 'lines')} ready`;
}

export const saveLabel = (rows: readonly ReviewRow[]) => `Save ${rows.length}`;
export const reviewLabel = (lines: number) => `Review ${lines}`;
export const addedText = (n: number) => `Added ${plural(n, 'purchase', 'purchases')}`;

export function withEdit(rows: readonly ReviewRow[], lineNo: number, patch: Partial<Omit<ReviewRow, 'lineNo'>>): ReviewRow[] {
  return rows.map((row) => (row.lineNo === lineNo ? { ...row, ...patch } : row));
}

export function withRemoved(rows: readonly ReviewRow[], lineNo: number): ReviewRow[] {
  return rows.filter((row) => row.lineNo !== lineNo);
}

/**
 * What the ledger is given for the whole list: each row an ordinary expense, the same one the Add screen posts for a plain
 * purchase (`quickToInput`). A row without a category goes under `uncategorisedId`. `ratesFor` gives the day's rates for
 * a payer whose currency is not the workspace's. Throws on a row with no amount, which `canSave` keeps from happening.
 */
export function purchaseInputs(
  rows: readonly ReviewRow[],
  paid: { account: AccountRow; cardId: string | null },
  accounts: readonly AccountRow[],
  uncategorisedId: string,
  ratesFor: (occurredOn: string) => Record<string, number> | undefined,
  /**
   * The day the payer's balance is counted from: a line dated before it starts out as a past purchase on a money
   * account, and paid off on a credit card (`pastMarkDefault`).
   */
  openedOn: string | null = null,
): PostTransactionInput[] {
  const currency = paid.account.currency;
  if (!currency) throw new Error('Choose what to pay with');
  return rows.map((row) => {
    if (row.amountMinor === null || row.amountMinor <= 0) throw new Error(`Line ${row.lineNo} has no amount`);
    const input = quickToInput(
      {
        occurredOn: row.occurredOn,
        description: row.note,
        amountMinor: row.amountMinor,
        currency,
        accountId: paid.account.id,
        cardId: paid.cardId,
        categoryId: row.categoryId || uncategorisedId,
      },
      accounts,
    );
    const ratesToBase = ratesFor(row.occurredOn);
    return { ...input, ...(ratesToBase ? { ratesToBase } : {}), ...pastMarkDefault(paid.account, openedOn, row.occurredOn) };
  });
}

/** What identifies one reading of the list, so going back to the text and forward again keeps the fixes already made. */
export const readingKey = (text: string, payer: string, date: string) => JSON.stringify([text, payer, date]);

/**
 * Saving a pasted list, once (event mode fix round 1, H1). The list lands in one database transaction; from the moment
 * it has, it counts as saved whatever follows: a move into a shared event that is refused or throws, or the refresh
 * and the way out, is said in the toast — never thrown back to a page that would let the same list be posted again.
 * Only a failed post leaves the list to try again.
 */
export async function saveListOnce(steps: {
  post: () => Promise<string[]>;
  /** Into a shared event: moves what was posted, and says what did not move (null when all of it did). */
  move: ((ids: string[]) => Promise<string | null>) | null;
  /** The toast's words for what was saved. */
  saidSaved: string;
  /** The refresh, the toast and the way out. */
  finish: (note: string) => Promise<void>;
}): Promise<{ saved: false; error: unknown } | { saved: true; note: string }> {
  let ids: string[];
  try {
    ids = await steps.post();
  } catch (error) {
    return { saved: false, error };
  }
  let note = steps.saidSaved;
  if (steps.move) {
    try {
      const notMoved = await steps.move(ids);
      if (notMoved) note = `${note}. ${notMoved}`;
    } catch (error) {
      note = `${note}. Not moved into the event: ${error instanceof Error ? error.message : 'it could not be moved'}`;
    }
  }
  try {
    await steps.finish(note);
  } catch {
    // Saved all the same: nothing here may offer the list a second time.
  }
  return { saved: true, note };
}
