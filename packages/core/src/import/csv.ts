import { currencyInfo, isSupportedCurrency } from '../money/currencies';
import { parseFractionalMajor, parseMajor, type RoundDirection, wholeFromHundredths } from '../money/money';

/** RFC 4180 parsing: quoted fields, escaped quotes, CRLF or LF, leading BOM. Blank lines are dropped. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Guesses ',' or ';' from the first line. */
export function detectDelimiter(text: string): ',' | ';' {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

export type CsvDateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

export interface CsvMapping {
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: CsvDateFormat;
  descriptionColumn: number;
  /** Either a single signed amount column... */
  amountColumn: number | null;
  /** ...where negative values are money going out (bank exports) or positive values are charges (card exports). */
  negativeIsOutflow: boolean;
  /** ...or separate outflow and inflow columns. */
  outflowColumn: number | null;
  inflowColumn: number | null;
}

export interface CsvRow {
  rowNumber: number;
  occurredOn: string;
  description: string;
  /** Positive = money out or card charge; negative = money in, payment, or refund. */
  amountMinor: number;
  /**
   * For a currency with no minor unit, the row's figure in hundredths when its cents are not zero (always positive);
   * `amountMinor` is then that figure rounded up when money went out and down when it came in. Absent otherwise.
   */
  exactHundredths?: number;
  externalRef: string;
}

export interface CsvRowError {
  rowNumber: number;
  message: string;
}

export function parseCsvDate(value: string, format: CsvDateFormat): string {
  const v = value.trim();
  let y: number;
  let m: number;
  let d: number;
  if (format === 'YYYY-MM-DD') {
    const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
    if (!match) throw new Error(`"${value}" is not YYYY-MM-DD`);
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(v);
    if (!match) throw new Error(`"${value}" is not ${format}`);
    const [a, b, c] = [Number(match[1]), Number(match[2]), Number(match[3])];
    y = c < 100 ? 2000 + c : c;
    [d, m] = format === 'DD/MM/YYYY' ? [a, b] : [b, a];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`"${value}" is not a real date`);
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Parses "Rp 1.250.000", "(12.50)", "-1,234.56", "1.234,56 CR" style amounts.
 *
 * With `direction`, a currency with no minor unit also takes cents ("Rp 12.500,30"), rounded that way: 'up' for
 * money out, 'down' for money in. Without it, cents on such a currency are refused, as they always were.
 */
export function parseCsvAmount(value: string, currency: string, direction?: RoundDirection): number | null {
  if (direction) return parseCsvExact(value, currency, direction)?.minor ?? null;
  const parts = csvFigure(value);
  if (parts === null) return null;
  const minor = parseMajor(parts.cleaned, currency);
  return parts.negative ? -minor : minor;
}

/**
 * Like `parseCsvAmount` with a direction, with the exact figure beside it: for a currency with no minor unit whose
 * cents are not zero, the magnitude in hundredths (always positive; the sign is on `minor`). Null for an empty cell.
 */
export function parseCsvExact(value: string, currency: string, direction: RoundDirection): { minor: number; exactHundredths: number | null } | null {
  const parts = csvFigure(value);
  if (parts === null) return null;
  const { minor, exactHundredths } = parseFractionalMajor(parts.cleaned, currency, direction);
  return { minor: parts.negative ? -minor : minor, exactHundredths };
}

/** A CSV cell's digits and separators, and whether it says the money is negative; null for an empty cell. */
function csvFigure(value: string): { cleaned: string; negative: boolean } | null {
  const v = value.trim();
  if (v === '' || v === '-') return null;
  // Negative: parentheses, a leading minus, a trailing minus after a digit, or a CR marker. "50.000,-" is Indonesian for no decimals.
  const negative = /^\(.*\)$/.test(v) || /^[^0-9]*-/.test(v) || /\d\s*-$/.test(v) || /\bCR\b/i.test(v);
  const cleaned = v.replace(/[^0-9.,]/g, '').replace(/[.,]+$/, '');
  if (!/[0-9]/.test(cleaned)) throw new Error(`"${value}" is not an amount`);
  return { cleaned, negative };
}

/** A cell in hundredths, signed: what the row is netted in before it is rounded, for a currency with no minor unit. */
function csvHundredths(value: string, currency: string): number | null {
  const parts = csvFigure(value);
  if (parts === null) return null;
  const { minor, exactHundredths } = parseFractionalMajor(parts.cleaned, currency, 'down');
  const magnitude = exactHundredths ?? minor * 100;
  return parts.negative ? -magnitude : magnitude;
}

function normalizeDescription(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** Maps parsed CSV rows to signed amounts with deterministic external refs for re-import dedupe. */
/** refScope (the target account id) keeps identical rows in different accounts distinct. */
export function mapCsvRows(rows: string[][], mapping: CsvMapping, currency: string, refScope: string): { rows: CsvRow[]; errors: CsvRowError[] } {
  const out: CsvRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((cells, index) => {
    if (mapping.hasHeader && index === 0) return;
    const rowNumber = index + 1;
    try {
      const cell = (col: number | null) => (col === null ? '' : (cells[col] ?? ''));
      const occurredOn = parseCsvDate(cell(mapping.dateColumn), mapping.dateFormat);
      const description = normalizeDescription(cell(mapping.descriptionColumn));
      // A currency with no minor unit is read in hundredths, so a row's cents survive until the row is rounded — once,
      // by its sign: up when money went out, down when it came in.
      const fractional = isSupportedCurrency(currency) && currencyInfo(currency).exponent === 0;
      const read = (col: number | null) => (fractional ? csvHundredths(cell(col), currency) : parseCsvAmount(cell(col), currency));
      let total: number;
      if (mapping.amountColumn !== null) {
        const amount = read(mapping.amountColumn);
        if (amount === null) throw new Error('Amount is empty');
        total = mapping.negativeIsOutflow ? -amount : amount;
      } else {
        const outflow = read(mapping.outflowColumn);
        const inflow = read(mapping.inflowColumn);
        if (outflow === null && inflow === null) throw new Error('Both amount columns are empty');
        total = Math.abs(outflow ?? 0) - Math.abs(inflow ?? 0);
      }
      let amountMinor = total;
      let exact: number | null = null;
      if (fractional) {
        amountMinor = wholeFromHundredths(total, total > 0 ? 'up' : 'down');
        exact = Math.abs(total) % 100 === 0 ? null : Math.abs(total);
      }
      if (amountMinor === 0) throw new Error('Amount is zero');
      const key = `${occurredOn}|${amountMinor}|${description.toLowerCase()}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      out.push({ rowNumber, occurredOn, description, amountMinor, ...(exact === null ? {} : { exactHundredths: exact }), externalRef: `csv:${refScope}|${key}|${occurrence}` });
    } catch (error) {
      errors.push({ rowNumber, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { rows: out, errors };
}
