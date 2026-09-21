import { isoDate } from '@expanses/core';
import { openingsOf } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useStoredRates } from '../../lib/queries';

/** Rates this device already holds for a day — never fetched just because a screen opened (see `useStoredRates`). */
export function useHeldRates(currencies: readonly string[], onDate: string = isoDate()) {
  const { ws } = useApp();
  const stored = useStoredRates();
  const codes = [...new Set(currencies)].filter((code) => code && code !== ws.baseCurrency).sort();
  return useQuery({ queryKey: ['held-rates', ws.workspaceId, onDate, codes.join(',')], queryFn: () => stored(codes, onDate) });
}

export function useOpenings(accountIds: readonly string[]) {
  const { database, ws } = useApp();
  const ids = [...accountIds].sort();
  return useQuery({ queryKey: ['openings', ws.workspaceId, ids.join(',')], queryFn: () => openingsOf(database, ws, ids) });
}
