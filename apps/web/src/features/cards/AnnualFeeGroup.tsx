import { feeWaiverRowText } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { PickerRow } from '../../ui/native';
import type { GroupChild } from '../../ui/native/InsetList';
import type { CardPage } from './card-page';
import { feeToGo } from './fee-line';
import { useFeeWaivedStatus } from './fee-waived-status';
import { useFeeProgress, useFeeYears } from './FeeYearGroups';
import { useSpendBonuses } from './spend-bonuses';

/**
 * Settings' one Fee waiver row (owner, 13 Nov 2026): the covered year once it is settled ("2026 waived", "2026
 * charged"), else None without a program, or what is left to spend ("Rp 18 jt to go"). Plain grey, whatever it says.
 * It opens the Fee waiver page, where the program is set and the fee year recorded.
 */
export function FeeWaiverRow({ page, position }: GroupChild & { page: CardPage }) {
  const navigate = useNavigate();
  const { card, cp, currency, today, all } = page;
  const { waiver, ready } = useSpendBonuses(cp, all, today);
  const years = useFeeYears(card.id, today);
  const current = years.data?.current ?? null;
  const progress = useFeeProgress(card, all, waiver, cp.terms?.annualFeeOn ?? null, today, current !== null && current.state !== 'pending');
  // The year the card's challenge is for: only that year's challenge speaks for a charged fee.
  const status = useFeeWaivedStatus(card.id, today);
  const loading = !ready || years.isPending || status.isPending || progress === undefined;
  const toGo = waiver && progress ? feeToGo(waiver.amountMinor - progress.spentMinor, currency) : null;
  const text = loading ? '' : feeWaiverRowText(current ? { year: current.year, state: current.state } : null, waiver, toGo, today, status.data?.challengeYear ?? null);
  return <PickerRow position={position} label="Fee waiver" value={text} testId="fee-waiver-row" onOpen={() => void navigate({ to: '/cards/$cardId/settings/fee-waiver', params: { cardId: card.id } })} />;
}
