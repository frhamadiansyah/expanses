import type { PaymentOption } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Sheet } from '../../app/Sheet';
import { paymentKey } from './quick-row';
import type { FormDraft } from './tx-form';

/**
 * What one Paid with row is called.
 *
 * The digits are part of the name only when they are what tells two rows apart — an account carrying a
 * supplementary card offers one row per card, and "Mandiri Bonvoy" alone would name both. An account with a
 * single card is one choice, so its name is the account's: a name nobody has to read digits out of.
 */
export function paymentLabel(option: PaymentOption): string {
  return option.cardId ? `${option.accountName} ···· ${option.last4 ?? '????'}` : option.accountName;
}

/** What the Paid with row shows once something is chosen, or nothing when it is still empty. */
export function chosenPayment(options: readonly PaymentOption[], draft: FormDraft): string {
  const found = options.find((option) => option.accountId === draft.moneyId && (option.cardId ?? '') === draft.cardId);
  return found ? paymentLabel(found) : (options.find((option) => option.accountId === draft.moneyId)?.accountName ?? '');
}

/**
 * Which account — and which card on it — paid: one list, for every screen that asks.
 *
 * It left `TransactionCard` when the edit sheet arrived. The sheet asks the same question of the same
 * `paymentOptions`, and a second copy of this list is a second place for a supplementary card to go missing
 * from — which is exactly the fault this branch has produced six times.
 */
export function PaymentSheet({
  title,
  options,
  accounts,
  onPick,
  onClose,
}: {
  /** "Paid with", "Received into" or "From", as the mode names it. */
  title: string;
  options: readonly PaymentOption[];
  accounts: readonly AccountRow[];
  onPick: (option: PaymentOption) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <ul className="-mx-1 divide-y divide-slate-100">
        {options.map((option) => (
          <li key={paymentKey(option.accountId, option.cardId)}>
            <button
              type="button"
              aria-label={paymentLabel(option)}
              onClick={() => {
                onPick(option);
                onClose();
              }}
              className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
            >
              <span className="min-w-0 flex-1 truncate">{paymentLabel(option)}</span>
              <span aria-hidden className="shrink-0 text-xs text-slate-400">
                {[option.holderName, accounts.find((a) => a.id === option.accountId)?.currency].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
