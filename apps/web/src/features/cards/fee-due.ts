import { chargeAfterWaiver, feeWaived, nextFeeDate, type UpcomingFee, upcomingFees } from '@expanses/core';
import { listCardTerms, waivedFeeYears } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';

export interface DueFee {
  cardId: string;
  name: string;
  currency: string;
  annualFeeMinor: number | null;
  annualFeeOn: string | null;
  annualFeeWaivedYear: number | null;
}

/**
 * The year each card's fee stands waived, as the Fee waiver page reads it (`waivedFeeYears`): marked, refunded by the
 * app, or reversed on the card (a statement check's find included). A card it does not name is left as it was.
 */
export function withWaivedYears(cards: readonly DueFee[], waived: ReadonlyMap<string, number>): DueFee[] {
  return cards.map((card) => {
    const year = waived.get(card.cardId);
    return year !== undefined ? { ...card, annualFeeWaivedYear: year } : card;
  });
}

/** Every card that is still open, with the fee terms it has. */
function useFeeCards(today: string): DueFee[] {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const terms = useQuery({ queryKey: ['card-terms-all', ws.workspaceId], queryFn: () => listCardTerms(database, ws) });
  const waived = useQuery({ queryKey: ['fee-waived-years', ws.workspaceId, today], queryFn: () => waivedFeeYears(database.db, ws, today) });
  const cards: DueFee[] = (terms.data ?? []).flatMap((t) => {
    const account = (accounts.data ?? []).find((a) => a.id === t.accountId);
    // A fee set to nothing is no fee: it is on neither Due soon nor the Repeating page.
    return account && !account.archivedAt && t.annualFeeMinor !== 0
      ? [{ cardId: t.accountId, name: account.name, currency: account.currency ?? ws.baseCurrency, annualFeeMinor: t.annualFeeMinor, annualFeeOn: t.annualFeeOn, annualFeeWaivedYear: t.annualFeeWaivedYear }]
      : [];
  });
  return withWaivedYears(cards, waived.data ?? new Map());
}

/** The cards whose annual fee is charged within the next 30 days, soonest first, for Recurring's Due soon. */
export function useUpcomingFees(today: string): UpcomingFee<DueFee>[] {
  return upcomingFees(useFeeCards(today), today);
}

/** A card's annual fee for the Repeating page: the next charge, or null while no charge date is set. */
export interface AnnualFee {
  card: DueFee;
  on: string | null;
}

/**
 * Every card with a fee amount or a charge date, by date (cards with no date last, by name). Read-only information:
 * nothing here is a need, since a fee is often waived.
 */
export function annualFeesOf(cards: readonly DueFee[], today: string): AnnualFee[] {
  return cards
    .filter((card) => card.annualFeeMinor !== 0 && (card.annualFeeMinor !== null || card.annualFeeOn))
    .map((card) => ({
      card,
      on: card.annualFeeOn ? (feeWaived(card.annualFeeOn, card.annualFeeWaivedYear, today) ? chargeAfterWaiver(card.annualFeeOn, today) : nextFeeDate(card.annualFeeOn, today)) : null,
    }))
    .sort((a, b) => (a.on ?? '9').localeCompare(b.on ?? '9') || a.card.name.localeCompare(b.card.name));
}

export function useAnnualFees(today: string): AnnualFee[] {
  return annualFeesOf(useFeeCards(today), today);
}
