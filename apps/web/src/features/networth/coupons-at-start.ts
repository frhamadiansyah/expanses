import { isoDate } from '@expanses/core';
import { recordDueCoupons } from '@expanses/db';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';

/**
 * When the app opens: every bond coupon due up to today, recorded on the bonds set to record their own — behind
 * whatever is on screen, and every figure read again once one was recorded.
 */
export function useCouponsAtStart(): void {
  const { database, ws } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!database) return;
    void recordDueCoupons(database, ws, isoDate())
      .then((recorded) => (recorded > 0 ? queryClient.invalidateQueries() : undefined))
      .catch((error: unknown) => console.warn('Bond coupons were not recorded; trying again at the next open', error));
    // Once per open workspace; a coupon recorded moves its bond's next payment on, so a reopen finds nothing more due.
  }, [database, ws.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
}
