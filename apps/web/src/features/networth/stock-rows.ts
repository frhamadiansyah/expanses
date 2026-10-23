import type { HoldingLinkRow, SecurityRow } from '@expanses/db';
import { quantityLabel } from './asset-page';
import type { AssetRow } from './asset-rows';

/** The catalogue item listed shares are opened as: the only drawer whose rows are read by stock. */
export const LISTED_SHARES = 'stock';

/** One stock held at two or more places, drawn as one row on Assets: it opens the stock across them. */
export interface StockLine {
  securityId: string;
  /** The ticker, as each of its holdings is named before " · {broker}". */
  title: string;
  /** "15 lots · 2 brokers" — short enough for a phone row, with "Update price" after it when any holding asks for one. */
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
  securities: readonly Pick<SecurityRow, 'id' | 'ticker' | 'lotSize'>[];
  /** Units held per holding account, as the asset values read them. */
  units: ReadonlyMap<string, number>;
}

/** Where the stock is kept, in words: brokers counted, or — every holding at one place — the holdings counted. */
function keptAt(links: readonly Pick<HoldingLinkRow, 'brokerAccountId'>[]): string {
  const brokers = new Set(links.map((link) => link.brokerAccountId ?? 'none')).size;
  return brokers > 1 ? `${brokers} brokers` : `${links.length} holdings`;
}

/**
 * A drawer's rows, one per stock: a listed share held at two or more places folds into one line where its first
 * holding stood, and opens the stock across them; a share held at one place stays as its holding's own row.
 *
 * Only rows of the listed-shares drawer fold, and only live holdings linked to a security with a ticker — the same
 * holdings the stock's own page counts, so a row that says "2 brokers" opens a page with two institutions on it.
 * Sold holdings, funds, bonds and everything else stay as they are. Nothing here is a total: the drawer's, the
 * group's and the page's figures are added up from the same holdings elsewhere, and do not change.
 */
export function linesByStock(drawerKey: string, rows: readonly AssetRow[], { links, securities, units }: ByStockInputs): DrawerLine[] {
  if (drawerKey !== LISTED_SHARES) return rows.map((row) => ({ row }));
  const linkOf = new Map(links.map((link) => [link.accountId, link]));
  const securityOf = new Map(securities.map((security) => [security.id, security]));
  const securityIdOf = (row: AssetRow): string | null => {
    if (row.sold || row.pockets !== null || row.kind.key !== LISTED_SHARES) return null;
    const securityId = linkOf.get(row.accountId)?.securityId ?? null;
    return securityId !== null && securityOf.get(securityId)?.ticker ? securityId : null;
  };
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
    const security = securityOf.get(securityId!)!;
    const unitsMicro = together.reduce((sum, one) => sum + (units.get(one.accountId) ?? 0), 0);
    const stale = together.some((one) => one.stale);
    lines.push({
      stock: {
        securityId: securityId!,
        title: security.ticker!,
        subtitle: [quantityLabel(unitsMicro, 'shares', security.lotSize), keptAt(together.map((one) => linkOf.get(one.accountId)!)), stale ? 'Update price' : null]
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
