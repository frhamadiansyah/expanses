import { type Database, recalcPendingForeign } from '@expanses/db';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';

/*
 * The first run after the withdrawal-rate update (spec §6, R18), and anything apply left queued (R9). Never part of
 * opening the app: it starts once the shell has painted, takes one account per db transaction, and gives the app a turn
 * between accounts, so a long history never stands between a person and the screen they opened.
 */

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Drains the queue one account at a time; how many accounts it took off. Stops early when `stopped` says so. */
export async function recalcInBatches(database: Database, opts: { yieldTo?: () => Promise<void>; stopped?: () => boolean } = {}): Promise<number> {
  const yieldTo = opts.yieldTo ?? nextTurn;
  let total = 0;
  for (;;) {
    if (opts.stopped?.()) return total;
    const { done, left } = await recalcPendingForeign(database, { limit: 1 });
    total += done;
    if (done === 0 || left === 0) return total;
    await yieldTo();
  }
}

/** Started by the shell after its first paint; every figure on screen is read again once something was recalculated. */
export function useForeignRecalcAtStart(): void {
  const { database } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => {
    let stopped = false;
    void recalcInBatches(database, { stopped: () => stopped })
      .then((done) => {
        if (!stopped && done > 0) void queryClient.invalidateQueries();
      })
      .catch((error: unknown) => console.warn('Foreign accounts could not be recalculated yet; trying again at the next open', error));
    return () => {
      stopped = true;
    };
  }, [database, queryClient]);
}
