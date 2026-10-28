import { groupedMajorString } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useStoredRates } from '../../lib/queries';
import { chargedEstimate } from './bill-view';

/**
 * The rates (against the workspace's base currency) the pay sheets estimate "Charged in …" from: what this device
 * already stored, as Add transaction's charged row reads them. Opening a sheet is not consent to ask a rate server, so
 * nothing is fetched; with no rate the estimate is simply absent and the figure is typed.
 */
export function useChargedRates(currencies: readonly string[], onDate: string): Record<string, number> {
  const { ws } = useApp();
  const stored = useStoredRates();
  const wanted = [...new Set(currencies)].filter((code) => code && code !== ws.baseCurrency).sort();
  const query = useQuery({
    queryKey: ['bill-charged-rates', ws.workspaceId, wanted.join(','), onDate],
    queryFn: () => stored(wanted, onDate),
    enabled: wanted.length > 0,
  });
  return query.data?.rates ?? {};
}

/** The estimate as text for the charged field, grouped as typed there, in the paying account's money; '' when there is none. */
export function chargedEstimateText(input: {
  amountMinor: number;
  billCurrency: string;
  payerCurrency: string;
  rates: Record<string, number>;
  baseCurrency: string;
}): string {
  const minor = chargedEstimate(input);
  return minor === null ? '' : groupedMajorString(minor, input.payerCurrency);
}
