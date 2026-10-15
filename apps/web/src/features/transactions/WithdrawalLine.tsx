import { evaluateAmount, isFxLotAccount } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { useForeignCostPreview } from '../../lib/withdrawal-queries';
import { withdrawalRateLine } from '../../lib/withdrawal-rate';
import { useHeldRates } from '../accounts/queries';
import { amountFields, type FormDraft } from './tx-form';

/**
 * Spending from foreign cash (withdrawal rate §7, R20): what it comes to in the base currency at what that money cost,
 * oldest withdrawal first — "≈ Rp 236.250 at the withdrawal rate (525)" — under the amount, before Save. The figure that
 * posts is the one `amountFields` reads (the charged one when there are two). Nothing for any other account.
 */
export function WithdrawalLine({ draft, accounts, editingId }: { draft: FormDraft; accounts: readonly AccountRow[]; editingId: string | null }) {
  const { ws } = useApp();
  const account = accounts.find((a) => a.id === draft.moneyId);
  const foreign = !!account?.currency && draft.mode === 'expense' && isFxLotAccount(account, ws.baseCurrency);
  const fields = amountFields(draft, accounts, ws.baseCurrency);
  const field = fields.charged ?? fields.amount;
  const minor = foreign ? evaluateAmount(field.value, field.currency) : null;
  const held = useHeldRates(foreign ? [account!.currency!] : [], draft.occurredOn);
  const preview = useForeignCostPreview({
    accountId: foreign ? account!.id : '',
    amountMinor: minor !== null && minor > 0 ? minor : null,
    occurredOn: draft.occurredOn,
    excludeTransactionId: editingId,
    dayRate: foreign ? (held.data?.rates[account!.currency!] ?? null) : null,
  });
  if (!foreign || !preview.data) return null;
  const text = withdrawalRateLine(preview.data, account!.currency!, ws.baseCurrency);
  if (!text) return null;
  return (
    <p data-testid="withdrawal-rate" className="px-4 pt-1 pb-2 text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
      {text}
    </p>
  );
}
