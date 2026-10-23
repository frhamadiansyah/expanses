import type { HoldingLinkRow, SecurityRow } from '@expanses/db';
import { placeKey } from '../investments/portfolio-view';
import { quantityLabel } from './asset-page';
import type { AssetRow } from './asset-rows';

/** The catalogue item listed shares are opened as: the only drawer whose rows are read by stock. */
export const LISTED_SHARES = 'stock';
/** The catalogue item mutual funds are opened as: their rows are read by fund, as "Same fund as" ties them. */
export const MUTUAL_FUNDS = 'fund';

/**
 * One stock held at two or more places, or one fund tied by "Same fund as" across the places it is held at, drawn as
 * one row on Assets: it opens the stock or the fund across them.
 */
export interface StockLine {
  kind: 'stock' | 'fund';
  securityId: string;
  /** A stock's ticker, as each of its holdings is named before " · {broker}"; a fund's own name. */
  title: string;
  /**
   * "15 lots · 2 brokers", or a fund's "2 places" — short enough for a phone row, with "Update price" after it when any
   * holding asks for one.
   */
  subtitle: string;
  /** Every holding's value added up — one security has one currency, so this is a same-currency sum. */
  valueMinor: number;
  currency: string;
  stale: boolean;
  /** The holdings behind it, in the order they stood in the drawer. */
  rows: AssetRow[];
}

/** What a drawer draws, in its order: an asset's own row, or a stock's rows folded into one. */
export type DrawerLine = { row: AssetRow; stock?: undefined } | { stock: StockLine; row?: undefined };

export interface ByStockInputs {
  links: readonly Pick<HoldingLinkRow, 'accountId' | 'securityId' | 'brokerAccountId'>[];
  securities: readonly Pick<SecurityRow, 'id' | 'ticker' | 'name' | 'lotSize'>[];
  /** Units held per holding account, as the asset values read them. */
  units: ReadonlyMap<string, number>;
  /** The institution each fund is held at, by name (its Nama institusi): where a fund is kept, as a broker is a share's. */
  places?: ReadonlyMap<string, string>;
}

/** Where it is kept, in words: brokers (or places) counted, or — every holding at one place — the holdings counted. */
function keptAt(keys: readonly string[], noun: 'brokers' | 'places'): string {
  const places = new Set(keys).size;
  return places > 1 ? `${places} ${noun}` : `${keys.length} holdings`;
}

/**
 * A drawer's rows, one per stock: a listed share held at two or more places folds into one line where its first
 * holding stood, and opens the stock across them; a share held at one place stays as its holding's own row. Mutual
 * funds fold the same way: two or more places tied by "Same fund as" are one line, opening the fund across them.
 *
 * Only rows of the listed-shares and mutual-funds drawers fold, and only live holdings linked to a security — a share's
 * with a ticker; a fund's is the one the tie made — the same holdings the security's own page counts, so a row that
 * says "2 brokers" opens a page with two institutions on it. Sold holdings, bonds and everything else stay as they
 * are, and so does a fund whose other place is archived or gone. Nothing here is a total: the drawer's, the group's
 * and the page's figures are added up from the same holdings elsewhere, and do not change.
 */
export function linesByStock(drawerKey: string, rows: readonly AssetRow[], { links, securities, units, places = new Map() }: ByStockInputs): DrawerLine[] {
  if (drawerKey !== LISTED_SHARES && drawerKey !== MUTUAL_FUNDS) return rows.map((row) => ({ row }));
  const fund = drawerKey === MUTUAL_FUNDS;
  const linkOf = new Map(links.map((link) => [link.accountId, link]));
  const securityOf = new Map(securities.map((security) => [security.id, security]));
  const securityIdOf = (row: AssetRow): string | null => {
    if (row.sold || row.pockets !== null || row.kind.key !== drawerKey) return null;
    const securityId = linkOf.get(row.accountId)?.securityId ?? null;
    return securityId !== null && (fund || securityOf.get(securityId)?.ticker) ? securityId : null;
  };
  // Where each holding is kept: a share at its broker, a fund at its institution by name — as its page's rows read.
  const placeOf = (row: AssetRow) => placeKey({ brokerAccountId: linkOf.get(row.accountId)?.brokerAccountId ?? null, place: fund ? (places.get(row.accountId) ?? null) : null });
  const held = new Map<string, AssetRow[]>();
  for (const row of rows) {
    const securityId = securityIdOf(row);
    if (securityId !== null) held.set(securityId, [...(held.get(securityId) ?? []), row]);
  }

  const lines: DrawerLine[] = [];
  const drawn = new Set<string>();
  for (const row of rows) {
    const securityId = securityIdOf(row);
    const together = securityId === null ? [] : held.get(securityId)!;
    // One holding, or holdings in two currencies (which one security never has): each stays its own row.
    if (together.length < 2 || new Set(together.map((one) => one.currency)).size > 1) {
      lines.push({ row });
      continue;
    }
    if (drawn.has(securityId!)) continue;
    drawn.add(securityId!);
    const security = securityOf.get(securityId!);
    const unitsMicro = together.reduce((sum, one) => sum + (units.get(one.accountId) ?? 0), 0);
    const stale = together.some((one) => one.stale);
    const kept = together.map(placeOf);
    lines.push({
      stock: {
        kind: fund ? 'fund' : 'stock',
        securityId: securityId!,
        title: fund ? (security?.name ?? together[0]!.name) : security!.ticker!,
        // A fund's row says no units: a place tracked by money has none, so a sum of them would be a part.
        subtitle: [fund ? null : quantityLabel(unitsMicro, 'shares', security!.lotSize), keptAt(kept, fund ? 'places' : 'brokers'), stale ? 'Update price' : null]
          .filter(Boolean)
          .join(' · '),
        valueMinor: together.reduce((sum, one) => sum + one.valueMinor, 0),
        currency: together[0]!.currency,
        stale,
        rows: together,
      },
    });
  }
  return lines;
}
