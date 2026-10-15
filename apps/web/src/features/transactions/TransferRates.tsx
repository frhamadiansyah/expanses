import type { AccountRow } from '@expanses/db';
import { exchangeResultText } from '../../lib/withdrawal-rate';
import type { FormDraft } from './tx-form';
import { useTransferPreview } from './transfer-preview';

/**
 * Under a transfer between currencies (withdrawal rate §7, R15): the Rate against the market, and — out of foreign cash
 * — what that money cost and the gain or loss Save will record. Nothing until both figures are typed.
 */
export function TransferRates({ draft, accounts, editingId }: { draft: FormDraft; accounts: readonly AccountRow[]; editingId: string | null }) {
  const preview = useTransferPreview(draft, accounts, editingId);
  if (!preview.rateText && !preview.result) return null;
  return (
    <div className="space-y-1 px-4 pt-1 pb-2 text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
      {preview.rateText && <p data-testid="transfer-rate">Rate {preview.rateText}</p>}
      {preview.costText && <p data-testid="exchange-cost">Cost {preview.costText}</p>}
      {preview.result && (
        <p data-testid="exchange-result">
          {exchangeResultText(preview.result)}
          {preview.stale ? ' at the last-known rate' : ''}
        </p>
      )}
    </div>
  );
}
