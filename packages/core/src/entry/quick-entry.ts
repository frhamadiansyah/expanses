import { parseMajor } from '../money/money';

/**
 * Forgiving readers for a row typed the way people type: into a table, or pasted from a spreadsheet.
 *
 * Everything here returns null rather than throwing. A cell that cannot be read yet is simply not
 * filled in yet — the row shows what it still needs, and nothing reaches the ledger until it is right.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function realDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Reads 2026-09-15, 15/9, 15/09/2026, 15 Sep, 15 September 2026, Sep 15.
 *
 * Day-first by default; pass `dayFirst: false` where people write the month first. A date without a
 * year takes the year of `today`.
 */
export function parseLooseDate(raw: string, today: string, opts: { dayFirst?: boolean } = {}): string | null {
  const dayFirst = opts.dayFirst ?? true;
  const s = raw.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  const year = Number(today.slice(0, 4));

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    return dayFirst ? realDate(y, b, a) : realDate(y, a, b);
  }

  const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3)) + 1;
  m = /^(\d{1,2}) ([a-z]{3,})\.?(?: (\d{4}))?$/.exec(s);
  if (m && monthOf(m[2]!) > 0) return realDate(m[3] ? Number(m[3]) : year, monthOf(m[2]!), Number(m[1]));
  m = /^([a-z]{3,})\.? (\d{1,2})(?: (\d{4}))?$/.exec(s);
  if (m && monthOf(m[1]!) > 0) return realDate(m[3] ? Number(m[3]) : year, monthOf(m[1]!), Number(m[2]));

  return null;
}

/** Reads 450000, 450.000, Rp 450.000, 1,250.50 — a positive amount in minor units, or null. */
export function parseLooseAmount(raw: string, currency: string): number | null {
  const s = raw.trim().replace(/^[^\d\-.,]+/, '').replace(/[^\d.,]+$/, '');
  if (!s) return null;
  try {
    const minor = parseMajor(s, currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

export const searchTokens = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

export interface PaymentOption {
  accountId: string;
  cardId: string | null;
  accountName: string;
  last4: string | null;
  holderName: string | null;
}

const paymentText = (o: PaymentOption) => [o.accountName, o.last4 ?? '', o.holderName ?? ''].join(' ').toLowerCase();

/**
 * Finds the account, and the card on it, that a piece of text names: "Mandiri Bonvoy 8802", "4411".
 *
 * Every word has to match. When several cards on one account match and nothing tells them apart, the
 * account is still known and the card is left for the owner to say, rather than guessed.
 */
export function matchPayment(text: string, options: readonly PaymentOption[]): { accountId: string; cardId: string | null } | null {
  const tokens = searchTokens(text);
  if (!tokens.length) return null;
  const hits = options.filter((o) => tokens.every((t) => paymentText(o).includes(t)));
  if (hits.length === 1) return { accountId: hits[0]!.accountId, cardId: hits[0]!.cardId };
  const accounts = new Set(hits.map((o) => o.accountId));
  return accounts.size === 1 ? { accountId: [...accounts][0]!, cardId: null } : null;
}

export interface CategoryOption {
  id: string;
  name: string;
  parentName: string | null;
}

/** An exact name wins; otherwise every word must match one category and one only. */
export function matchCategory(text: string, options: readonly CategoryOption[]): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const exact = options.filter((o) => o.name.toLowerCase() === t);
  if (exact.length === 1) return exact[0]!.id;
  const tokens = searchTokens(text);
  const hits = options.filter((o) => tokens.every((x) => `${o.name} ${o.parentName ?? ''}`.toLowerCase().includes(x)));
  return hits.length === 1 ? hits[0]!.id : null;
}

export interface Searchable {
  /** Words the row can be found by: description, category and its parent, account, holder. */
  text: readonly (string | null | undefined)[];
  amountMinor: number;
  last4?: string | null;
}

/**
 * Whether a row matches a search. Every word must match; a word made of digits matches the amount
 * however it was typed (450000, 450.000) or a card's last four digits.
 */
export function matchesSearch(row: Searchable, query: string): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const haystack = row.text.filter(Boolean).join(' ').toLowerCase();
  return tokens.every((t) => {
    if (/^[\d.,]+$/.test(t)) {
      const digits = t.replace(/[.,]/g, '');
      return String(row.amountMinor).includes(digits) || Boolean(row.last4 && row.last4.includes(digits));
    }
    return haystack.includes(t);
  });
}

export interface DayRow {
  kind: 'expense' | 'income' | 'transfer' | 'other';
  amountMinor: number;
  counted: boolean;
}

/** What a day came to: income less spending. Transfers only move money, and uncounted rows are left out. */
export function dayNet(rows: readonly DayRow[]): number {
  return rows.reduce((sum, r) => (!r.counted ? sum : r.kind === 'income' ? sum + r.amountMinor : r.kind === 'expense' ? sum - r.amountMinor : sum), 0);
}

/**
 * The part of a description that names the merchant, for matching it against earlier purchases:
 * "SUPERINDO KEBAYORAN 0912" and "Superindo Kebayoran" read the same.
 */
export function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 2)
    .join(' ');
}
