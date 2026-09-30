import { type GoldPriceChoice, gramPriceMicroFromOunce, isoDate, wantsWorldPrice } from '@expanses/core';
import { goldPriceChoiceOf, recordWorldPrice } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { worldGoldPerOunce } from '../../lib/fx-client';
import { useInvalidateAll } from '../../lib/queries';

/** Where a gold holding takes its price from; null for anything that is not gold counted in grams. */
export function useGoldPriceChoice(accountId: string, gold: boolean) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['gold-price-choice', ws.workspaceId, accountId],
    queryFn: () => goldPriceChoiceOf(database, ws, accountId),
    enabled: gold,
  });
}

export type WorldFetch = 'idle' | 'fetching' | 'failed';

/**
 * Today's world price for a gold holding that follows it, fetched once when its page opens and again on ↻, and
 * stored as the day's price. It never stands in the way of the page: offline or refused, the last price stays with its
 * date and the state says the fetch failed, so the page can offer ↻ quietly. A price typed for today is left alone —
 * `wantsWorldPrice` does not ask, and the store would not overwrite it if it did.
 */
export function useWorldGoldPrice(o: { accountId: string; currency: string; choice: GoldPriceChoice | null; latest: { onDate: string } | null; ready: boolean }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [state, setState] = useState<WorldFetch>('idle');
  const asked = useRef(false);

  const fetchNow = useCallback(async () => {
    const today = isoDate();
    setState('fetching');
    try {
      const perOunce = await worldGoldPerOunce(o.currency, today);
      await recordWorldPrice(database, ws, { accountId: o.accountId, onDate: today, priceMicro: gramPriceMicroFromOunce(perOunce, o.currency) });
      await invalidate();
      setState('idle');
    } catch {
      setState('failed');
    }
  }, [database, ws, invalidate, o.accountId, o.currency]);

  const wanted = o.ready && o.choice !== null && wantsWorldPrice(o.choice, o.latest, isoDate());
  useEffect(() => {
    if (!wanted || asked.current) return;
    asked.current = true;
    void fetchNow();
  }, [wanted, fetchNow]);
  // Switching back to the world price is a fresh ask: the effect above may fetch again.
  useEffect(() => {
    if (o.choice === 'typed') asked.current = false;
  }, [o.choice]);

  return { state, retry: () => void fetchNow() };
}
