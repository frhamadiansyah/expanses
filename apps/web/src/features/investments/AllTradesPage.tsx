import { formatMinor } from '@expanses/core';
import { InsetGroup, PushedTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { HoldingsTable, TradesSection, useTradeBook } from './IncomeTrades';

/**
 * Every buy and sell of every holding, by day, with a chip per holding: a page of its own, opened from the foot of
 * Assets' Investments (owner, 23 Oct). It sat at the bottom of Income, but a buy pays nothing, so the list read as out
 * of place there; Income keeps what was earned. A line opens its holding's page, where the trade is changed.
 *
 * Above the list, what the year's sells realized: it was one of two figures at the top of Income until the Income
 * redesign (owner, 23 Oct) left that page to dividends and coupons alone. A gain is the tint and a loss alarm, as the
 * trade lines under it colour money; another currency's sum is said after the base's rather than added into it.
 */
export function AllTradesPage() {
  const book = useTradeBook();
  const { base, others } = book.realized;
  const realized = `${base > 0 ? '+' : ''}${formatMinor(base, book.ws.baseCurrency)}${others ? ` · ${others}` : ''}`;
  return (
    <div className={SCREEN}>
      <PushedTitle title="All trades" back="Assets" backTo="/net-worth/assets" />
      {book.holdings.length > 0 && (
        <InsetGroup>
          <ReadOnlyRow
            label="Realized this year"
            value={realized}
            tone={base > 0 ? 'tint' : base < 0 ? 'alarm' : undefined}
            info="Gains and losses from sales this year, against what the units cost."
          />
        </InsetGroup>
      )}
      <HoldingsTable book={book} />
      <TradesSection book={book} />
    </div>
  );
}
