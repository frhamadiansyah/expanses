import { bonusItem, type FeeWaiver, feeProgressWindow, hasSpendTarget, nearestFirst, type SpendBonusItem, type SpendLine, waiverItem, waiverSpend } from '@expanses/core';
import { type AccountRow, cardFeeYears, cardSpendLines, type FeeRefund, listFeeRefunds, listFeeWaivers } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { activeDuring } from './catalog-panel';
import { type CardPoints, expenseAncestors } from './useCardPoints';

export interface SpendBonuses {
  /** Every cycle bonus in force and the fee waiver, nearest to its goal first. */
  items: SpendBonusItem[];
  waiver: FeeWaiver | null;
  refunds: FeeRefund[];
  /** The purchases the waiver counts over its window, for the page that lists them. */
  waiverLines: SpendLine[];
  ready: boolean;
}

const NONE: SpendBonuses = { items: [], waiver: null, refunds: [], waiverLines: [], ready: false };

/** The cycle bonuses of the card's programme in force this cycle, as items. */
export function cycleBonusItems(cp: CardPoints, today: string): SpendBonusItem[] {
  const result = cp.current;
  if (!result) return [];
  return cp.bonuses
    .filter((b) => activeDuring(b, result.cycle.end, result.cycle.end))
    .map((b) => bonusItem(b, result.earn.eligibleSpendByBonus[b.id] ?? 0, result.earn.bonusById[b.id] ?? 0, result.cycle.end, today));
}

/** A card's spend bonuses: its programme's cycle bonuses and its fee waiver (target or challenge), read the same way. */
export function useSpendBonuses(cp: CardPoints, accounts: readonly AccountRow[], today: string): SpendBonuses {
  const { database, ws } = useApp();
  const card = cp.card;
  const feeOn = cp.terms?.annualFeeOn ?? null;
  const q = useQuery({
    queryKey: ['card-spend-bonuses', ws.workspaceId, card.id, today, feeOn],
    queryFn: async () => {
      const waiver = (await listFeeWaivers(database.db, ws)).get(card.id) ?? null;
      const refunds = await listFeeRefunds(database.db, ws, card.id);
      // Free for life has nothing to spend toward: it is the card's waiver, never a spend bonus.
      if (!waiver || !hasSpendTarget(waiver)) return { waiver, refunds, waiverLines: [] as SpendLine[], item: null as SpendBonusItem | null };
      // The window the Fee waiver page's Progress counts over: the covered fee's, or the next one's once it is settled.
      const current = (await cardFeeYears(database.db, ws, { cardId: card.id, today }))?.current ?? null;
      const window = feeProgressWindow(waiver, feeOn, today, current !== null && current.state !== 'pending');
      const lines = await cardSpendLines(database, ws, card.id, window.from, window.to);
      const spent = waiverSpend(waiver, window, lines, expenseAncestors(accounts as AccountRow[]), card.currency ?? ws.baseCurrency);
      return { waiver, refunds, waiverLines: lines, item: waiverItem(waiver, window, spent, cp.terms?.annualFeeMinor ?? null, today) };
    },
  });
  if (!q.data) return { ...NONE, items: nearestFirst(cycleBonusItems(cp, today)) };
  return {
    items: nearestFirst([...cycleBonusItems(cp, today), ...(q.data.item ? [q.data.item] : [])]),
    waiver: q.data.waiver,
    refunds: q.data.refunds,
    waiverLines: q.data.waiverLines,
    ready: true,
  };
}
