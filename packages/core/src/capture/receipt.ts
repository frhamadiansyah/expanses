import { wholeFromHundredths } from '../money/money';
import { exponentOf } from './amount';
import { capturedDayOf, findDateTime } from './date';
import { readCapture } from './read';
import type { CaptureLine } from './types';
import { WORDS } from './words';

/** What a receipt photo says, as the add form takes it: each part null when the picture did not say. */
export interface ReceiptFill {
  /** In minor units of `currency`. */
  amountMinor: number | null;
  currency: string;
  /** The merchant, as the note. */
  name: string | null;
  /** YYYY-MM-DD. */
  date: string | null;
}

/**
 * Reads a receipt photographed on the add form, with the reader every capture goes through: the amount, the
 * merchant and the day. A receipt is always money that left, so a printed figure with cents in a currency with no
 * minor unit is rounded up, as a captured purchase is. Null when the picture holds no figure to read.
 *
 * `currency` is the one the form is reading money in, for a figure the receipt printed with no currency of its own.
 */
export function readReceipt(lines: readonly CaptureLine[], currency: string, capturedAt: string): ReceiptFill | null {
  const reading = readCapture(
    { id: 'receipt', kind: 'photo', capturedAt, app: null, title: null, body: null, lines: [...lines], imageFile: null },
    WORDS,
    null,
    { offers: 'read' },
  );
  const texts = lines.map((line) => line.text.trim()).filter(Boolean);
  // The day the reader found, or the first line that prints one: a skipped reading has looked at nothing.
  const printed = reading.occurredAt?.value ?? texts.map(findDateTime).find((found) => found !== null) ?? null;
  const date = printed ? printed.slice(0, 10) || capturedDayOf(capturedAt) : null;
  const name = reading.name?.value.trim() || merchantOf(texts);

  const read = reading.skipped === null ? (reading.amount?.value ?? null) : null;
  if (read) {
    const code = read.currency ?? currency;
    const amountMinor =
      read.exactHundredths !== undefined ? wholeFromHundredths(read.exactHundredths, 'up') : read.currency === null ? read.minor * 10 ** exponentOf(code) : read.minor;
    return { amountMinor, currency: code, name, date };
  }
  // A printed till receipt rarely writes "Rp" beside its figures, which an app's screen always does: its total is
  // read off the line that says TOTAL instead.
  const total = totalOf(texts, currency);
  return total === null ? null : { amountMinor: total, currency, name, date };
}

/** The words a till prints beside what was paid, best first; a subtotal, a count or a discount is never it. */
const TOTAL_WORDS = [/grand\s*total/i, /total\s*(bayar|belanja|pembayaran|harga)/i, /jumlah\s*bayar/i, /amount\s*due/i, /\btotal\b/i];
const NOT_TOTAL = /sub\s*-?\s*total|total\s*(item|qty|disc|diskon|hemat|potongan|ppn|tax|pajak)/i;

/** The figure on the receipt's total line, or on the line under it when the total stands alone. */
function totalOf(texts: readonly string[], currency: string): number | null {
  for (const word of TOTAL_WORDS) {
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!;
      if (!word.test(text) || NOT_TOTAL.test(text)) continue;
      const figure = figureOf(text, currency) ?? (texts[i + 1] !== undefined ? figureOf(texts[i + 1]!, currency) : null);
      if (figure !== null && figure > 0) return figure;
    }
  }
  return null;
}

/**
 * The last figure on a line, in minor units: 41.300 and 41,300 are forty-one thousand three hundred; 41.300,50 and
 * 41,300.50 carry cents. A currency with no minor unit has its cents rounded up, as money that left is.
 */
function figureOf(text: string, currency: string): number | null {
  const found = text.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g);
  if (!found) return null;
  const raw = found[found.length - 1]!;
  const cents = /[.,]\d{1,2}$/.exec(raw);
  const whole = Number((cents ? raw.slice(0, cents.index) : raw).replace(/[.,]/g, ''));
  const hundredths = cents ? Number(cents[0].slice(1).padEnd(2, '0')) : 0;
  const exponent = exponentOf(currency);
  if (exponent === 0) return whole + (hundredths > 0 ? 1 : 0);
  return whole * 10 ** exponent + Math.round(hundredths * 10 ** (exponent - 2));
}

/** The shop's name: the first line at the top that reads as words, not as an address, a date or a figure. */
function merchantOf(texts: readonly string[]): string | null {
  for (const text of texts.slice(0, 4)) {
    const letters = text.replace(/[^\p{L}]/gu, '').length;
    if (letters < 3 || /^(jl\.?|jalan|telp|tel|npwp|no\.?)\b/i.test(text) || /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(text)) continue;
    return text;
  }
  return null;
}
