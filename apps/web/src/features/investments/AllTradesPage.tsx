import { PushedTitle, SCREEN } from '../../ui/native';
import { HoldingsTable, TradesSection, useTradeBook } from './IncomeTrades';

/**
 * Every buy and sell of every holding, by day, with a chip per holding: a page of its own, opened from the foot of
 * Assets' Investments (owner, 23 Oct). It sat at the bottom of Income, but a buy pays nothing, so the list read as out
 * of place there; Income keeps what was earned. A line opens its holding's page, where the trade is changed.
 */
export function AllTradesPage() {
  const book = useTradeBook();
  return (
    <div className={SCREEN}>
      <PushedTitle title="All trades" back="Assets" backTo="/net-worth/assets" />
      <HoldingsTable book={book} />
      <TradesSection book={book} />
    </div>
  );
}
