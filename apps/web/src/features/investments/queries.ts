import { loadSecurityList, type SecurityList } from '@expanses/catalog';
import { baseCosts, listHoldingLinks, listSecurities, listSecurityPrices } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { useHeldRates } from '../accounts/queries';
import { useAssetProfiles, useAssetValues } from '../networth/queries';
import { portfolioView } from './portfolio-view';

export function useSecurities() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['securities', ws.workspaceId], queryFn: () => listSecurities(database, ws) });
}

export function useHoldingLinks() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['holding-links', ws.workspaceId], queryFn: () => listHoldingLinks(database, ws) });
}

export function useSecurityPrices(securityId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['security-prices', ws.workspaceId, securityId], queryFn: () => listSecurityPrices(database, ws, securityId) });
}

export function useBaseCosts() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['base-costs', ws.workspaceId], queryFn: () => baseCosts(database, ws) });
}

/** A bundled list, read once per session and only when asked for — the US one only for an entitled owner. */
export function useSecurityList(list: SecurityList, enabled: boolean) {
  return useQuery({ queryKey: ['security-list', list], queryFn: () => loadSecurityList(list), enabled, staleTime: Infinity, gcTime: Infinity, retry: false });
}

/** Everything the Investments screens read, put together once. `view` is null until every part has loaded. */
export function usePortfolio() {
  const { ws } = useApp();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const links = useHoldingLinks();
  const securities = useSecurities();
  const accounts = useAccounts();
  const costs = useBaseCosts();
  // Exactly the Assets page's call — the same currencies, the same query — so both pages add up at the same rates.
  const held = useHeldRates((values.data ?? []).map((row) => row.currency));
  const parts = [values, profiles, links, securities, accounts, costs, held];
  const ready = parts.every((part) => part.data !== undefined);
  const view = ready
    ? portfolioView({
        values: values.data!, profiles: profiles.data!, links: links.data!, securities: securities.data!, accounts: accounts.data!,
        baseCosts: costs.data!.positions, baseCurrency: ws.baseCurrency, ratesToBase: held.data!.rates,
      })
    : null;
  return {
    view,
    rates: held.data?.rates ?? {},
    costs: costs.data ?? null,
    securities: securities.data ?? [],
    accounts: accounts.data ?? [],
    isPending: !ready,
    error: parts.find((part) => part.error)?.error ?? null,
  };
}
