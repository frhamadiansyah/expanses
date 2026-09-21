import { FREE_LISTS, loadSecurityList, type SecurityList } from '@expanses/catalog';

/**
 * A bundled list's query: a free list for everyone, a paid one only while it is granted. The gate is here and in the
 * read itself, so no caller can forget it and a paid list is never loaded without the switch.
 */
export function securityListQuery(list: SecurityList, granted: boolean, load: typeof loadSecurityList = loadSecurityList) {
  const allowed = FREE_LISTS.includes(list) || granted;
  return {
    queryKey: ['security-list', list, allowed] as const,
    queryFn: () => (allowed ? load(list) : Promise.reject(new Error(`The ${list.toUpperCase()} list is not included`))),
    enabled: allowed,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  };
}
