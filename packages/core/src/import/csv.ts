import { parseMajor } from '../money/money';

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

/** Parses "Rp 1.250.000", "(12.50)", "-1,234.56", "1.234,56 CR" style amounts. */
export function parseCsvAmount(value: string, currency: string): number | null {
  const v = value.trim();
  if (v === '' || v === '-') return null;
  const negative = /^\(.*\)$/.test(v) || /-/.test(v) || /\bCR\b/i.test(v);
  const cleaned = v.replace(/[^0-9.,]/g, '');
  if (!/[0-9]/.test(cleaned)) throw new Error(`"${value}" is not an amount`);
  const minor = parseMajor(cleaned, currency);
  return negative ? -minor : minor;
}

function normalizeDescription(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** Maps parsed CSV rows to signed amounts with deterministic external refs for re-import dedupe. */
export function mapCsvRows(rows: string[][], mapping: CsvMapping, currency: string): { rows: CsvRow[]; errors: CsvRowError[] } {
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
      let amountMinor: number;
      if (mapping.amountColumn !== null) {
        const amount = parseCsvAmount(cell(mapping.amountColumn), currency);
        if (amount === null) throw new Error('Amount is empty');
        amountMinor = mapping.negativeIsOutflow ? -amount : amount;
      } else {
        const outflow = parseCsvAmount(cell(mapping.outflowColumn), currency);
        const inflow = parseCsvAmount(cell(mapping.inflowColumn), currency);
        if (outflow === null && inflow === null) throw new Error('Both amount columns are empty');
        amountMinor = Math.abs(outflow ?? 0) - Math.abs(inflow ?? 0);
      }
      if (amountMinor === 0) throw new Error('Amount is zero');
      const key = `${occurredOn}|${amountMinor}|${description.toLowerCase()}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      out.push({ rowNumber, occurredOn, description, amountMinor, externalRef: `csv:${key}|${occurrence}` });
    } catch (error) {
      errors.push({ rowNumber, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { rows: out, errors };
}
