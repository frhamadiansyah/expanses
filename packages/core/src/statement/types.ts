/**
 * What a credit-card statement says, as read off the owner's screenshots of it.
 *
 * Nothing here is stored: the rows live in memory while the owner checks the statement against what cicis holds, and
 * only the transactions the owner records persist. The statement's text and the screenshots are never kept.
 */

/** The statement's period: inclusive ISO dates (`YYYY-MM-DD`). */
export interface StatementPeriod {
  start: string;
  end: string;
}

/** One transaction row of a statement. */
export interface StatementRow {
  /** The transaction date, ISO. This is the date matching uses. */
  on: string;
  /** The posting date, when the statement prints two dates; null when it prints one. */
  postedOn: string | null;
  /** The text between the dates and the amount, as printed, whitespace collapsed. */
  description: string;
  /** Positive, in the card currency's minor units. */
  amountMinor: number;
  /** `in` for a CR / kredit row or a minus amount (a payment or a refund); `out` otherwise. */
  direction: 'out' | 'in';
  /** The description names a fee, a charge, interest or stamp duty. */
  isFee: boolean;
  /** Index of the screenshot it came from, 0-based, in the order the screenshots were handed over. */
  image: number;
}

/** Everything read off one statement's screenshots. */
export interface StatementReading {
  /** Every row once, in statement order: the repeat where two screenshots overlap is dropped. */
  rows: StatementRow[];
  /** The closing (new) balance; negative when the statement shows a credit balance. Null when no summary was read. */
  closingMinor: number | null;
  /** The previous statement's balance, read the same way. */
  previousMinor: number | null;
  /** Images that gave no row and no balance — "Nothing read from screenshot N". */
  emptyImages: number[];
}
