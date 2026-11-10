import { CURRENCIES } from '../money/currencies';
import { lineFigures, readDayText, trimNote, withoutClosingDash } from './purchase-list';
import { matchPayment, type PaymentOption } from './quick-entry';

/*
 * One typed line, read into parts: "kopi kenangan 38rb gopay", "kemarin toko buku 249k nusa", "KRW 95000 tteokbokki".
 * Pure and never throws. The order of reading is fixed: the day, then the currency with its figure, then what the
 * expense was paid with, then (when no currency mark picked one) the last figure as the amount. What is left is the
 * description.
 */

export interface ReadExpenseLineOptions {
  today: string;
  currency: string;
  payments: readonly PaymentOption[];
}

export interface ExpenseLineReading {
  description: string;
  amountMinor: number | null;
  currency: string;
  currencyRead: boolean;
  occurredOn: string | null;
  payment: { accountId: string; cardId: string | null } | null;
  ambiguous: boolean;
  /** The line without the description's words: its date, currency, amount and paid-with words in typed order. */
  rest: string;
}

/** Capitalises each word's first letter when the text was typed all lower-case; otherwise leaves it as typed. */
export function tidyDescription(text: string): string {
  if (text !== text.toLowerCase()) return text;
  return text.replace(/(^|\s)(\p{L})/gu, (_all, space: string, letter: string) => space + letter.toUpperCase());
}

const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_TOKEN = new RegExp(
  String.raw`(?<![\d/.,])\d{1,2}/\d{1,2}(?:/(?:\d{4}|\d{2}))?(?![\d/])|(?<![\p{L}\p{N}])\d{1,2} (?:${MONTH})\.?(?: (?:19|20)\d{2})?(?![\p{L}\p{N}])`,
  'giu',
);
const YESTERDAY = /(?<![\p{L}\p{N}])(kemarin|yesterday)(?![\p{L}\p{N}])/iu;

const SYMBOLS: Record<string, string> = { 'S$': 'SGD', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', RM: 'MYR' };
const CODES = new Set(CURRENCIES.map((c) => c.code));
const MARK_BEFORE = /(?:(?<![\p{L}\p{N}])(S\$|RM)|(\$|€|£|¥)|(?<![\p{L}\p{N}])([A-Za-z]{3}))\s*$/u;
const CODE_AFTER = /^\s*([A-Za-z]{3})(?![\p{L}\p{N}])/u;
const MINUS_BEFORE = /(?:^|\s)[-−–]\s*$/;

const codeOf = (word: string): string | null => {
  if (word === 'try') return null;
  const upper = word.toUpperCase();
  return CODES.has(upper) ? upper : null;
};

const addDays = (iso: string, days: number): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

interface Span {
  start: number;
  end: number;
}

const wordsOf = (text: string | null): string[] => (text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Reads one typed line (see the notes at the top of the file). */
export function readExpenseLine(line: string, options: ReadExpenseLineOptions): ExpenseLineReading {
  const s = withoutClosingDash(line.replace(/\s+/g, ' ').trim());
  let masked = s;
  const removed: Span[] = [];
  const remove = (span: Span) => {
    removed.push(span);
    masked = masked.slice(0, span.start) + ' '.repeat(span.end - span.start) + masked.slice(span.end);
  };

  // 1. The day.
  let occurredOn: string | null = null;
  const yesterday = YESTERDAY.exec(s);
  if (yesterday) {
    occurredOn = addDays(options.today, -1);
    remove({ start: yesterday.index, end: yesterday.index + yesterday[0].length });
  } else {
    for (const token of s.matchAll(DATE_TOKEN)) {
      const day = readDayText(token[0], options.today);
      if (!day) continue;
      occurredOn = day;
      remove({ start: token.index, end: token.index + token[0].length });
      break;
    }
  }

  // 2. The currency, and the figure it belongs to.
  let currency = options.currency;
  let currencyRead = false;
  let amountMinor: number | null = null;
  let ambiguous = false;
  let amountFound = false;

  const figures = lineFigures(masked, options.currency).filter((f) => f.minor !== null);
  for (let i = figures.length - 1; i >= 0; i--) {
    const fig = figures[i]!;
    let code: string | null = null;
    let span: Span = { start: fig.start, end: fig.end };
    if (fig.rupiahMark) {
      code = 'IDR';
    } else {
      const before = MARK_BEFORE.exec(masked.slice(0, fig.start));
      if (before) {
        code = before[1] ? SYMBOLS[before[1]]! : before[2] ? SYMBOLS[before[2]]! : codeOf(before[3]!);
        if (code) span = { start: before.index, end: fig.end };
      }
      if (!code) {
        const after = CODE_AFTER.exec(masked.slice(fig.end));
        if (after) {
          code = codeOf(after[1]!);
          if (code) span = { start: fig.start, end: fig.end + after[0].length };
        }
      }
    }
    if (!code) continue;
    const again = lineFigures(masked.slice(fig.start, fig.end), code)[0];
    if (!again || again.minor === null) continue;
    currency = code;
    currencyRead = true;
    amountFound = true;
    if (fig.negative || MINUS_BEFORE.test(masked.slice(0, span.start)) || again.minor <= 0) break;
    amountMinor = again.minor;
    ambiguous = again.ambiguous;
    remove(span);
    break;
  }

  // 3. Paid with: a card's last digits first, then whole words of an account's name.
  let payment: { accountId: string; cardId: string | null } | null = null;
  for (const fig of lineFigures(masked, options.currency)) {
    const text = masked.slice(fig.start, fig.end);
    if (!/^\d{4}$/.test(text) || !options.payments.some((o) => o.last4 === text)) continue;
    const hit = matchPayment(text, options.payments);
    if (!hit) continue;
    payment = hit;
    remove({ start: fig.start, end: fig.end });
    break;
  }

  const known = new Set(
    options.payments.flatMap((o) => [...wordsOf(o.accountName), ...wordsOf(o.holderName)]).filter((w) => w.length >= 2 && /\p{L}/u.test(w)),
  );
  const named = [...masked.matchAll(/[\p{L}\p{N}]+/gu)].filter((w) => known.has(w[0].toLowerCase()));
  if (named.length) {
    const hit = matchPayment(named.map((w) => w[0]).join(' '), options.payments);
    if (hit && (!payment || payment.accountId === hit.accountId)) {
      if (!payment) payment = hit;
      for (const w of named) remove({ start: w.index, end: w.index + w[0].length });
    }
  }

  // 4. The amount, when no currency mark picked one.
  if (!amountFound) {
    const last = lineFigures(masked, options.currency)
      .filter((f) => f.minor !== null)
      .at(-1);
    if (last && !last.negative && last.minor! > 0) {
      amountMinor = last.minor;
      ambiguous = last.ambiguous;
      remove({ start: last.start, end: last.end });
    }
  }

  // 5. What is left is the description; what was taken out is the rest.
  const rest = removed
    .sort((a, b) => a.start - b.start)
    .map((span) => s.slice(span.start, span.end))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { description: tidyDescription(trimNote(masked)), amountMinor, currency, currencyRead, occurredOn, payment, ambiguous, rest };
}
