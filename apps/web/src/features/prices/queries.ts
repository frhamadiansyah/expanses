import { latestOwnPrices, latestSecurityPrices, listSecurityPriceChoices } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** The price source saved for each security; a security with none follows the default. */
export function useSecurityPriceChoices() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['security-price-choices', ws.workspaceId], queryFn: () => listSecurityPriceChoices(database, ws) });
}

/** Each security's latest price, with its source. */
export function useLatestSecurityPrices() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['latest-security-prices', ws.workspaceId], queryFn: () => latestSecurityPrices(database, ws) });
}

/** These holdings' own latest prices (the ones with no security), with their source. */
export function useLatestOwnPrices(accountIds: string[]) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['latest-own-prices', ws.workspaceId, accountIds.join(',')], queryFn: () => latestOwnPrices(database, ws, accountIds) });
}
