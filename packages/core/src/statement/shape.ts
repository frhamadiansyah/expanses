import type { CaptureLine } from '../capture/types';
import { readStatement } from './read';

/**
 * Whether pictures handed over together are a statement's screenshots rather than one payment.
 *
 * The share sheet and "Choose from Photos" take the same pictures and must send them the same way: two or more are
 * always one statement's screenshots (a receipt is one picture), and a single one is a statement when the statement
 * reader finds at least `STATEMENT_SHAPE_ROWS` transaction rows on it — each a date, a description and an amount. A
 * receipt prints one date and a total; a payment screen prints a row or two. Anything else becomes a draft in Review.
 */
export const STATEMENT_SHAPE_ROWS = 3;

const DAY_MS = 86_400_000;

/**
 * `images` are the pictures' Vision lines, one list per picture; `today` (ISO) places the rows' years, and `currency`
 * is the workspace's. Only how many rows the reader finds matters here, not what they say.
 */
export function readsAsStatement(images: readonly (readonly CaptureLine[])[], today: string, currency: string): boolean {
  if (images.length >= 2) return true;
  const [only] = images;
  if (!only || only.length === 0) return false;
  // The two months before today: wide enough for any statement's year to land, and a single picture's rows are
  // counted, not matched.
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 62 * DAY_MS).toISOString().slice(0, 10);
  return readStatement([[...only]], { start, end: today }, currency).rows.length >= STATEMENT_SHAPE_ROWS;
}
