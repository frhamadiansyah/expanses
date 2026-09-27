import { CreditCard, Landmark, Plus, Search } from 'lucide-react';
import { useState } from 'react';
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

/**
 * Whether a Paid with row answers what was typed: its name (with a card's last digits), whose it is, or its
 * currency — "bca", "7788", "andi", "usd". Nothing typed keeps every row.
 */
export function matchesPayment(option: PaymentOption, currency: string | null | undefined, typed: string): boolean {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return true;
  return [paymentLabel(option), option.holderName ?? '', currency ?? ''].some((text) => text.toLowerCase().includes(wanted));
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
  onAddAccount,
}: {
  /** "Paid with", "Received into" or "From", as the mode names it. */
  title: string;
  options: readonly PaymentOption[];
  accounts: readonly AccountRow[];
  onPick: (option: PaymentOption) => void;
  onClose: () => void;
  /** Offered at the foot of the list, for the account that is not on it yet. */
  onAddAccount?: () => void;
}) {
  const [search, setSearch] = useState('');
  const shown = options.filter((option) => matchesPayment(option, accounts.find((a) => a.id === option.accountId)?.currency, search));
  return (
    <Sheet grouped title={title} onClose={onClose}>
      {/* The Paid with list as B2 draws the row it fills: a glyph, the account or card, its holder and currency. */}
      <ul className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]">
        {shown.map((option) => {
          const account = accounts.find((a) => a.id === option.accountId);
          const Glyph = option.cardId || account?.kind === 'liability' ? CreditCard : Landmark;
          return (
            <li key={paymentKey(option.accountId, option.cardId)}>
              <button
                type="button"
                aria-label={paymentLabel(option)}
                onClick={() => {
                  onPick(option);
                  onClose();
                }}
                className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
              >
                <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-ink-2)]">
                  <Glyph size={16} />
                </span>
                <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{paymentLabel(option)}</span>
                  <span aria-hidden className="shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">
                    {[option.holderName, account?.currency].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {onAddAccount ? (
          <li>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAddAccount();
              }}
              className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
            >
              <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-tint)]">
                <Plus size={16} />
              </span>
              <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center pr-[13px]">
                <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-tint)]">Add account</span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
      {search.trim() !== '' && shown.length === 0 ? (
        <p className="px-4 pt-3 text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing here matches “{search.trim()}”.</p>
      ) : null}
      {/* The category picker's search, in the same place: pinned at the foot, where the thumb already is. */}
      <div className="sticky bottom-0 px-1 pt-2 pb-1">
        <label className="flex h-11 items-center gap-2 rounded-full bg-[var(--ph-surface)] px-4 shadow-[0_6px_20px_rgb(0_0_0/0.12)]">
          <Search size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
          <input
            aria-label={`Search ${title}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-base text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]"
          />
        </label>
      </div>
    </Sheet>
  );
}
