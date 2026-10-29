import { formatMinor, waiverRowText } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { cx } from '../../ui';
import { InsetRow, PickerRow } from '../../ui/native';
import type { CardPage } from './card-page';
import { feeLine } from './fee-line';
import { useSpendBonuses } from './spend-bonuses';
import { shortDate } from './useCardPoints';

/**
 * Settings' "This year's fee" row: how this year's charge stands (the charge's date, Waived, or Refunded once the bank
 * refunded a fee challenge). A tap asks whether it was waived.
 */
export function YearFeeRow({ page, onAsk }: { page: CardPage; onAsk: () => void }) {
  const { cp, currency, today } = page;
  const { refunds } = useSpendBonuses(cp, page.all, today);
  const terms = cp.terms;
  const line = terms ? feeLine(terms.annualFeeMinor, terms.annualFeeOn, terms.annualFeeWaivedYear, currency, today, refunds.at(-1)?.feeYear ?? null) : null;
  if (!line) return null;
  const text = line.refunded ? 'Refunded' : line.waived ? 'Waived' : (line.when?.replace('Charged on ', '') ?? line.amount ?? '');
  return (
    <InsetRow
      testId="card-annual-fee"
      title="This year's fee"
      value={<span data-testid="year-fee" className={cx(line.soon && 'font-semibold text-[var(--ph-warn)]')}>{text}</span>}
      valueTone="ink"
      onClick={onAsk}
    />
  );
}

/** Settings' one Fee waiver row: None until a yearly target or a bank's challenge is set; it opens the page that sets it. */
export function FeeWaiverRow({ page }: { page: CardPage }) {
  const navigate = useNavigate();
  const { card, cp, currency, today } = page;
  const { waiver } = useSpendBonuses(cp, page.all, today);
  const text = waiverRowText(waiver, waiver ? formatMinor(waiver.amountMinor, currency) : '', waiver?.spendBy ? shortDate(waiver.spendBy) : null);
  return <PickerRow label="Fee waiver" value={text} testId="fee-waiver-row" onOpen={() => void navigate({ to: '/cards/$cardId/settings/fee-waiver', params: { cardId: card.id } })} />;
}
