import { CURRENCIES } from '@expanses/core';
import { type GroupChild, InsetRow } from '../../ui/native';

/**
 * The currency an event plans in, as one row. A tap asks the form to open the app's currency list (`CurrencySheet`),
 * which the form draws outside its group.
 *
 * Locked once something is bought for the event: the row then only says which currency it is, as the Categories row
 * does once money is tagged. The repository refuses the change as well, so the lock is never the only guard.
 */
export function EventCurrencyRow({
  value,
  locked = false,
  onOpen,
  position,
}: GroupChild & {
  /** The event's currency; the workspace's base currency when it has none of its own. */
  value: string;
  locked?: boolean;
  onOpen: () => void;
}) {
  const name = CURRENCIES.find((currency) => currency.code === value)?.name ?? value;
  return (
    <InsetRow
      position={position}
      title="Currency"
      label={`Currency: ${value}`}
      testId="event-currency"
      value={name}
      chevron={!locked}
      onClick={locked ? undefined : onOpen}
    />
  );
}
