import type { AccountRow, TradeRow } from '@expanses/db';

/**
 * The account a holding's Buy or Sell starts on (owner, 25 Nov 2026), one rule, read in order:
 *   1. the account the holding is linked to: a fund's or bond's Institution when it is a broker's cash, a share's broker;
 *   2. else the account the holding's most recent buy or sell used;
 *   3. else none: the row asks for the account (the ✓ waiting). A silent wrong account, the first in the list, was
 *      worse than asking once.
 * An account the sheet does not offer (archived, or a card on a sell) is passed over.
 */
export function tradeCashDefault(o: {
  /** The accounts the sheet offers. */
  choices: readonly Pick<AccountRow, 'id'>[];
  /** The account the holding is linked to, if any. */
  linkedId?: string | null;
  /** The holding's own trades. */
  trades?: readonly Pick<TradeRow, 'kind' | 'cashAccountId' | 'occurredOn' | 'createdAt'>[];
}): string | null {
  const offered = new Set(o.choices.map((account) => account.id));
  if (o.linkedId && offered.has(o.linkedId)) return o.linkedId;
  const used = (o.trades ?? [])
    .filter((trade) => (trade.kind === 'buy' || trade.kind === 'sell') && trade.cashAccountId !== null && offered.has(trade.cashAccountId))
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt));
  return used.at(-1)?.cashAccountId ?? null;
}
