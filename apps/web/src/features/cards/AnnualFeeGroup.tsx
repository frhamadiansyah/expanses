import { formatMinor, waiverRowText } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { InsetGroup, PickerRow, TextRow } from '../../ui/native';
import type { CardPage } from './card-page';
import { FeeAlert } from './FeeAlert';
import { feeLine } from './fee-line';
import { useSpendBonuses } from './spend-bonuses';
import { shortDate } from './useCardPoints';

/**
 * Settings' Annual fee group: the fee, the day it is charged, how this year's charge stands (Charged, Waived or
 * Refunded: a tap asks whether it was waived) and the one Fee waiver row, None until a target or a challenge is set.
 */
export function AnnualFeeGroup({ page, fee, onFee, feeOn, onFeeOn }: { page: CardPage; fee: string; onFee: (v: string) => void; feeOn: string; onFeeOn: (v: string) => void }) {
  const navigate = useNavigate();
  const { card, cp, currency, today } = page;
  const { waiver, refunds } = useSpendBonuses(cp, page.all, today);
  const [asking, setAsking] = useState(false);
  const terms = cp.terms;
  const line = terms ? feeLine(terms.annualFeeMinor, terms.annualFeeOn, terms.annualFeeWaivedYear, currency, today, refunds.at(-1)?.feeYear ?? null) : null;
  const year = line?.refunded ? 'Refunded' : line?.waived ? 'Waived' : 'Charged';
  const waiverText = waiverRowText(waiver, waiver ? formatMinor(waiver.amountMinor, currency) : '', waiver?.spendBy ? shortDate(waiver.spendBy) : null);
  return (
    <InsetGroup header="Annual fee">
      <TextRow label={`Annual fee (${currency})`} value={fee} onChange={(e) => onFee(e.target.value)} inputMode="decimal" />
      <TextRow label="Charged on" type="date" value={feeOn} onChange={(e) => onFeeOn(e.target.value)} />
      {terms?.annualFeeOn && <PickerRow label="This year's fee" value={year} testId="year-fee" onOpen={() => setAsking(true)} />}
      <PickerRow label="Fee waiver" value={waiverText} testId="fee-waiver-row" onOpen={() => void navigate({ to: '/cards/$cardId/settings/fee-waiver', params: { cardId: card.id } })} />
      {asking && terms && (
        <FeeAlert
          fee={{ cardId: card.id, name: card.name, currency, annualFeeMinor: terms.annualFeeMinor, annualFeeOn: terms.annualFeeOn, annualFeeWaivedYear: terms.annualFeeWaivedYear }}
          today={today}
          onClose={() => setAsking(false)}
        />
      )}
    </InsetGroup>
  );
}
