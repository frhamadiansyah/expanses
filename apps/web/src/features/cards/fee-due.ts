import { chargeAfterWaiver, coveredCharge, feeWaived, nextFeeDate, type UpcomingFee, upcomingFees } from '@expanses/core';
import { type FeeRefund, listCardTerms, listFeeRefunds } from '@expanses/db';
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
 * The year each card's fee stands waived: the year Fee waived marked, or the covered charge's year when a refund is
 * kept for it — the old Fee refunded set no mark, and its year must not read as due.
 */
export function withRefundYears(cards: readonly DueFee[], refunds: readonly FeeRefund[], today: string): DueFee[] {
  return cards.map((card) => {
    if (!card.annualFeeOn) return card;
    const year = Number(coveredCharge(card.annualFeeOn, today).slice(0, 4));
    return refunds.some((r) => r.accountId === card.cardId && r.feeYear === year) ? { ...card, annualFeeWaivedYear: year } : card;
  });
}

/** Every card that is still open, with the fee terms it has. */
function useFeeCards(today: string): DueFee[] {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const terms = useQuery({ queryKey: ['card-terms-all', ws.workspaceId], queryFn: () => listCardTerms(database, ws) });
  const refunds = useQuery({ queryKey: ['fee-refunds-all', ws.workspaceId], queryFn: () => listFeeRefunds(database.db, ws) });
  const cards: DueFee[] = (terms.data ?? []).flatMap((t) => {
    const account = (accounts.data ?? []).find((a) => a.id === t.accountId);
    // A fee set to nothing is no fee: it is on neither Due soon nor the Repeating page.
    return account && !account.archivedAt && t.annualFeeMinor !== 0
      ? [{ cardId: t.accountId, name: account.name, currency: account.currency ?? ws.baseCurrency, annualFeeMinor: t.annualFeeMinor, annualFeeOn: t.annualFeeOn, annualFeeWaivedYear: t.annualFeeWaivedYear }]
      : [];
  });
  return withRefundYears(cards, refunds.data ?? [], today);
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
