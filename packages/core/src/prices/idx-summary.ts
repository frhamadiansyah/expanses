/*
 * IDX's daily "Ringkasan Saham" file: every listed share's close for one trading day, as an .xlsx the owner downloads
 * from idx.co.id themselves. It is read here, on the device; nothing is fetched. The file is one worksheet of plain
 * cells with a header row; the columns are found by their header, not their place, so a column IDX adds or moves
 * does not misread the closes.
 */

/** Inflates raw DEFLATE data (a zip entry's). The app hands in the browser's DecompressionStream; a test, zlib. */
export type InflateRaw = (bytes: Uint8Array) => Promise<Uint8Array>;

export class IdxFileError extends Error {}

const NOT_IDX = "This doesn't look like IDX's Ringkasan Saham file";

/** What the file says: the trading day and each share's close, in whole rupiah, by ticker. */
export interface IdxSummary {
  tradeDate: string;
  closes: Map<string, number>;
}

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/** Every entry of a zip file, by name, read lazily. Only stored and deflated entries, which is all an .xlsx uses. */
function zipEntries(bytes: Uint8Array, inflateRaw: InflateRaw): Map<string, () => Promise<Uint8Array>> {
  // The end-of-central-directory record is in the last 64 KB (its comment is at most that long).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (u32(bytes, at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new IdxFileError(NOT_IDX);
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const entries = new Map<string, () => Promise<Uint8Array>>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (u32(bytes, at) !== 0x02014b50) throw new IdxFileError(NOT_IDX);
    const method = u16(bytes, at + 10);
    const size = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const local = u32(bytes, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    entries.set(name, async () => {
      const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new IdxFileError(NOT_IDX);
    });
  }
  return entries;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) =>
    code.startsWith('#x') || code.startsWith('#X')
      ? String.fromCodePoint(parseInt(code.slice(2), 16))
      : code.startsWith('#')
        ? String.fromCodePoint(parseInt(code.slice(1), 10))
        : (ENTITIES[code] ?? whole),
  );
/** The text of every <t> inside a piece of XML, joined: a rich-text string is several runs. */
const textOf = (xml: string) => unescape([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

/** Column letters as a zero-based index: A is 0, AB is 27. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** The worksheet's rows, each a sparse list of cell texts by column. */
export function sheetRows(sheetXml: string, sharedStrings: readonly string[] = []): string[][] {
  const rows: string[][] = [];
  for (const [, body] of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const [, attrs, inner = ''] of body!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs!)?.[1];
      const index = ref ? columnIndex(ref) : next;
      next = index + 1;
      const type = /\bt="(\w+)"/.exec(attrs!)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      row[index] = type === 'inlineStr' ? textOf(inner) : type === 's' ? (sharedStrings[Number(value)] ?? '') : unescape(value ?? '');
    }
    rows.push(row);
  }
  return rows;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

/** "29 Sep 2026" (or Indonesian "29 Agu 2026", an ISO date, or a spreadsheet day number) as 2026-09-29; null otherwise. */
export function idxDate(text: string): string | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = /^(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{4})$/.exec(t);
  if (named) {
    const month = MONTHS[named[2]!.toLowerCase()];
    if (!month) return null;
    return `${named[3]}-${String(month).padStart(2, '0')}-${named[1]!.padStart(2, '0')}`;
  }
  // A cell stored as a date: days since 30 Dec 1899.
  if (/^\d{5}(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000).toISOString().slice(0, 10);
  return null;
}

const HEADERS = { ticker: 'kode saham', close: 'penutupan', date: 'tanggal perdagangan terakhir' } as const;

/**
 * The summary in a worksheet's rows. The header row is the first that names Kode Saham, Penutupan and Tanggal
 * Perdagangan Terakhir. The trading day is the date most rows carry (a suspended share can carry an older one). A
 * share with no trades that day still has its previous close under Penutupan; a row without a positive close is left out.
 */
export function parseIdxRows(rows: readonly (readonly string[])[]): IdxSummary {
  const norm = (cell: string | undefined) => (cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const headerAt = rows.findIndex((row) => [HEADERS.ticker, HEADERS.close, HEADERS.date].every((h) => row.some((cell) => norm(cell) === h)));
  if (headerAt < 0) throw new IdxFileError(NOT_IDX);
  const header = rows[headerAt]!;
  const col = (name: string) => [...header].findIndex((cell) => norm(cell) === name);
  const [tickerCol, closeCol, dateCol] = [col(HEADERS.ticker), col(HEADERS.close), col(HEADERS.date)];
  const closes = new Map<string, number>();
  const dates = new Map<string, number>();
  for (const row of rows.slice(headerAt + 1)) {
    const ticker = (row[tickerCol] ?? '').trim().toUpperCase();
    const close = Number((row[closeCol] ?? '').trim());
    if (!ticker || !Number.isFinite(close) || close <= 0) continue;
    closes.set(ticker, close);
    const date = idxDate(row[dateCol] ?? '');
    if (date) dates.set(date, (dates.get(date) ?? 0) + 1);
  }
  const tradeDate = [...dates].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
  if (closes.size === 0 || !tradeDate) throw new IdxFileError(NOT_IDX);
  return { tradeDate, closes };
}

/** Reads an .xlsx of IDX's summary: its first worksheet (and shared strings, if it has any) through `parseIdxRows`. */
export async function readIdxSummary(bytes: Uint8Array, inflateRaw: InflateRaw): Promise<IdxSummary> {
  const entries = zipEntries(bytes, inflateRaw);
  const sheetName = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetName) throw new IdxFileError(NOT_IDX);
  const decoder = new TextDecoder();
  const shared = entries.get('xl/sharedStrings.xml');
  const strings = shared ? [...decoder.decode(await shared()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!)) : [];
  return parseIdxRows(sheetRows(decoder.decode(await entries.get(sheetName)!()), strings));
}
