import type { SecurityKind } from '@expanses/core';

export interface ListedSecurity {
  ticker: string;
  name: string;
  market: string;
  currency: string;
  /** Shares in one lot, or null where the market trades single shares. */
  lotSize: number | null;
  kind: SecurityKind;
}

export type SecurityList = 'idx' | 'us';

/** Every market a bundled list may name. A new exchange is a new list file and new rows here — nothing else. */
export const MARKETS: Readonly<Record<string, { currency: string; lotSize: number | null; list: SecurityList }>> = {
  IDX: { currency: 'IDR', lotSize: 100, list: 'idx' },
  NASDAQ: { currency: 'USD', lotSize: null, list: 'us' },
  NYSE: { currency: 'USD', lotSize: null, list: 'us' },
  'NYSE ARCA': { currency: 'USD', lotSize: null, list: 'us' },
  'NYSE AMERICAN': { currency: 'USD', lotSize: null, list: 'us' },
  'CBOE BZX': { currency: 'USD', lotSize: null, list: 'us' },
  IEX: { currency: 'USD', lotSize: null, list: 'us' },
};

/** Lists every user searches. The rest are the paid convenience (spec §6.5). */
export const FREE_LISTS: readonly SecurityList[] = ['idx'];

export type ListRow = [ticker: string, name: string, market: string, kind: 's' | 'e'];
export interface ListFile {
  asOf: string;
  rows: ListRow[];
}

const TICKER: Record<SecurityList, RegExp> = { idx: /^[A-Z]{4}$/, us: /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/ };

export function validateSecurityList(file: unknown, list: SecurityList): string[] {
  const problems: string[] = [];
  const f = file as Partial<ListFile>;
  if (typeof f?.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f.asOf)) problems.push('asOf must be YYYY-MM-DD');
  const seen = new Set<string>();
  (Array.isArray(f?.rows) ? f.rows : []).forEach((row, i) => {
    const [ticker, name, market, kind] = row as unknown[];
    const at = `Row ${i + 1}`;
    if (typeof ticker !== 'string' || !TICKER[list].test(ticker)) problems.push(`${at}: "${String(ticker)}" is not a ${list.toUpperCase()} ticker`);
    if (typeof name !== 'string' || name.trim() === '') problems.push(`${at}: no name`);
    if (typeof market !== 'string' || !MARKETS[market] || MARKETS[market]!.list !== list) problems.push(`${at}: unknown market "${String(market)}"`);
    if (kind !== 's' && kind !== 'e') problems.push(`${at}: kind must be s or e`);
    const key = `${String(market)}:${String(ticker)}`;
    if (seen.has(key)) problems.push(`${key} is listed twice`);
    seen.add(key);
  });
  return problems;
}

export function expandList(file: ListFile): ListedSecurity[] {
  return file.rows.map(([ticker, name, market, kind]) => {
    const info = MARKETS[market];
    if (!info) throw new Error(`Unknown market "${market}"`);
    return { ticker, name, market, currency: info.currency, lotSize: info.lotSize, kind: kind === 'e' ? 'etf' : 'share' };
  });
}

/**
 * A dynamic import each, so the bundler gives each list a chunk of its own: the entry chunk carries neither, and
 * the US list is never parsed on a device that never searches it. `check-bundle.mjs` holds the build to this.
 */
export async function loadSecurityList(list: SecurityList): Promise<{ asOf: string; securities: ListedSecurity[] }> {
  const file = (list === 'idx' ? (await import('../securities/idx.json')).default : (await import('../securities/us.json')).default) as unknown as ListFile;
  return { asOf: file.asOf, securities: expandList(file) };
}

export function searchSecurities<T extends { ticker: string | null; name: string; market: string }>(rows: readonly T[], query: string, limit = 30): T[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const rank = (row: T): number => {
    const ticker = (row.ticker ?? '').toUpperCase();
    const name = row.name.toUpperCase();
    if (ticker === q) return 0;
    if (ticker.startsWith(q)) return 1;
    if (name.split(/[\s.,&()/-]+/).some((word) => word.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return rows
    .map((row) => ({ row, r: rank(row) }))
    .filter((hit) => hit.r >= 0)
    .sort((a, b) => a.r - b.r || (a.row.ticker ?? a.row.name).localeCompare(b.row.ticker ?? b.row.name) || a.row.market.localeCompare(b.row.market))
    .slice(0, limit)
    .map((hit) => hit.row);
}
