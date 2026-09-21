import { loadSecurityList, type SecurityList } from '@expanses/catalog';
import { baseCosts, listHoldingLinks, listSecurities, listSecurityPrices } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

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
