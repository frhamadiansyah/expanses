import type { ConversionDetail, TransferPartner } from '@expanses/core';
import { formatPoints } from './useCardPoints';

/** Why a partner's estimate is smaller than its ratio alone suggests, or null when nothing holds it back. */
export function capNote(partner: Pick<TransferPartner, 'cap' | 'incrementPoints'>, detail: ConversionDetail, unit: string): string | null {
  const cap = partner.cap;
  if (!cap) return null;
  const ceiling = `the ${cap.window === 'year' ? 'yearly' : 'monthly'} ceiling${cap.shared ? ' (shared with the other partners)' : ''}`;
  if (detail.beyondPoints > 0) return `${formatPoints(detail.beyondPoints)} ${unit} past ${ceiling} move at the reduced rate`;
  // A remainder smaller than one step is the step rounding, not the ceiling, so it goes unremarked.
  const held = detail.unconvertedPoints;
  return held >= partner.incrementPoints ? `${ceiling} leaves ${formatPoints(held)} ${unit} behind` : null;
}
