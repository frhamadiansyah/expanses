import { closePriceMicro, type IdxSummary, isIdxListing, priceAgeDays } from '@expanses/core';
import type { AssetValueRow, HoldingLinkRow, SecurityRow, SourcedPrice } from '@expanses/db';

/** One line of Update prices: a security (its price values every holding of it) or a holding priced on its own. */
export interface BoardRow {
  key: string;
  securityId: string | null;
  /** The holding, for one priced on its own; null for a security. */
  accountId: string | null;
  title: string;
  currency: string;
  /** The ticker IDX's file names it by, for a share IDX lists; null otherwise. */
  idxTicker: string | null;
  latest: SourcedPrice | null;
}

/** The kinds Update prices lists: a listed share and a fund. Gold keeps its own page and sheet. */
const LISTED_KINDS = new Set(['stock', 'fund']);

/**
 * Every listed share and fund held today, for Update prices: one line per security however many brokers hold it,
 * then each fund or unlinked holding on its own. Shares IDX lists come first (the file fills them); the rest — a US
 * share, a mutual fund — are typed. Sold-out and estimated holdings are left out.
 */
export function priceBoard(o: {
  values: readonly AssetValueRow[];
  kinds: Readonly<Record<string, string>>;
  links: readonly HoldingLinkRow[];
  securities: readonly SecurityRow[];
  latestBySecurity: Readonly<Record<string, SourcedPrice>>;
  latestOwn: Readonly<Record<string, SourcedPrice>>;
}): { stocks: BoardRow[]; others: BoardRow[] } {
  const linkOf = new Map(o.links.map((link) => [link.accountId, link.securityId]));
  const securityById = new Map(o.securities.map((security) => [security.id, security]));
  const stocks: BoardRow[] = [];
  const others: BoardRow[] = [];
  const seen = new Set<string>();
  for (const value of o.values) {
    if (value.mode !== 'market' || !(value.unitsMicro && value.unitsMicro > 0)) continue;
    const security = securityById.get(linkOf.get(value.accountId) ?? '');
    if (security) {
      if (seen.has(security.id)) continue;
      seen.add(security.id);
      const idx = isIdxListing(security);
      (idx ? stocks : others).push({
        key: security.id,
        securityId: security.id,
        accountId: null,
        title: security.ticker ?? security.name,
        currency: security.currency,
        idxTicker: idx ? security.ticker!.toUpperCase() : null,
        latest: o.latestBySecurity[security.id] ?? null,
      });
      continue;
    }
    if (!LISTED_KINDS.has(o.kinds[value.accountId] ?? '')) continue;
    others.push({ key: value.accountId, securityId: null, accountId: value.accountId, title: value.name, currency: value.currency, idxTicker: null, latest: o.latestOwn[value.accountId] ?? null });
  }
  const byTitle = (a: BoardRow, b: BoardRow) => a.title.localeCompare(b.title);
  return { stocks: stocks.sort(byTitle), others: others.sort(byTitle) };
}

/** How many lines' prices are older than `days` (or missing). */
export function staleLines(rows: readonly BoardRow[], today: string, days: number): number {
  return rows.filter((row) => !row.latest || priceAgeDays(row.latest.onDate, today) > days).length;
}

/** One share found in IDX's file: its last price and the file's close, or the typed price that stays. */
export interface PreviewRow {
  securityId: string;
  ticker: string;
  oldMicro: number | null;
  newMicro: number;
  /** A price typed for the file's day stays; this is it. */
  keptMicro: number | null;
}

export interface IdxPreview {
  tradeDate: string;
  rows: PreviewRow[];
  /** Shares in the file that are not held here. */
  skipped: number;
}

/** What importing the file would do to the shares held: each found one's old and new price, and the rest skipped. */
export function idxPreview(summary: IdxSummary, stocks: readonly BoardRow[]): IdxPreview {
  const rows: PreviewRow[] = [];
  for (const row of stocks) {
    const close = row.idxTicker ? summary.closes.get(row.idxTicker) : undefined;
    if (close === undefined || !row.securityId) continue;
    const typedThatDay = row.latest?.onDate === summary.tradeDate && row.latest.source === 'manual';
    rows.push({
      securityId: row.securityId,
      ticker: row.idxTicker!,
      oldMicro: row.latest?.priceMicro ?? null,
      newMicro: closePriceMicro(close, row.currency),
      keptMicro: typedThatDay ? row.latest!.priceMicro : null,
    });
  }
  return { tradeDate: summary.tradeDate, rows, skipped: summary.closes.size - rows.length };
}
