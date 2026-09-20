import { X } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useResolveRates } from '../../lib/queries';
import { cx } from '../../ui';
import { CurrencySheet } from './CurrencySheet';
import { Keypad } from './Keypad';
import { amountAfterEnter, chargedHint, chargedInNeeded, currencyFlag, type FormDraft, suggestedRate, typedCurrency } from './tx-form';

/**
 * A rate for the day, for the hint under the charged row. It is only ever a suggestion: the figure that posts
 * is whatever the account actually charged, typed by hand.
 */
export function useSuggestedRate(from: string, to: string, onDate: string): number | null {
  const { ws } = useApp();
  const resolveRates = useResolveRates();
  const pair = from && to && from !== to;
  // 'suggested-rate' is used by nothing else in the app; it is narrowed by workspace like every other key here.
  const query = useQuery({
    queryKey: ['suggested-rate', ws.workspaceId, from, to, onDate],
    queryFn: () => resolveRates([from, to].filter((c) => c !== ws.baseCurrency), onDate),
    enabled: !!pair,
  });
  if (!pair) return from && to ? 1 : null;
  if (!query.data) return null;
  return suggestedRate({ rates: query.data.rates, from, to, base: ws.baseCurrency });
}

/**
 * The figure, and the currency it was typed in.
 *
 * On a phone the figure opens the keypad, which is the only way in on a touch screen and carries the
 * arithmetic with it. **On a desktop the figure is a real text input and the keyboard does what the keypad
 * does**: the same `evaluateAmount` runs when the field is left and when Enter is pressed, so `85000+15000`
 * works where there is no keypad to press DONE on. A desktop is not a phone with the keypad taken away.
 *
 * When the currency on the flag is not the paying account's, the "Charged in …" row appears underneath: that
 * figure is what posts, and the typed one is recorded as what the merchant charged.
 */
export function AmountRow({
  draft,
  accounts,
  set,
}: {
  draft: FormDraft;
  accounts: readonly AccountRow[];
  set: (patch: Partial<FormDraft>) => void;
}) {
  const phone = usePhone();
  const { ws } = useApp();
  const [keypad, setKeypad] = useState(false);
  const [picking, setPicking] = useState(false);
  const account = accounts.find((a) => a.id === draft.moneyId);
  const currency = typedCurrency(draft, accounts);
  const settled = account?.currency ?? '';
  const needsCharged = chargedInNeeded(draft, accounts);
  const rate = useSuggestedRate(needsCharged ? currency : '', needsCharged ? settled : '', draft.occurredOn);

  const evaluate = () => {
    const { text } = amountAfterEnter(draft.amount, currency || ws.baseCurrency);
    if (text !== draft.amount) set({ amount: text });
  };

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200">
      <div className="flex h-14 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="Currency"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          <span aria-hidden>{currencyFlag(currency)}</span>
        </button>
        {phone ? (
          <button
            type="button"
            aria-label="Amount"
            onClick={() => setKeypad(true)}
            className="min-w-0 flex-1 truncate text-left text-2xl tabular focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
          >
            {draft.amount || <span className="text-slate-400">0</span>}
          </button>
        ) : (
          <input
            aria-label="Amount"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
            onBlur={evaluate}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // Enter evaluates; it does not also save. A second Enter, on a field that no longer changes, submits.
              const { text, submit } = amountAfterEnter(draft.amount, currency || ws.baseCurrency);
              if (text !== draft.amount) set({ amount: text });
              if (!submit) e.preventDefault();
            }}
            placeholder="0"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-2xl tabular focus:outline-none"
          />
        )}
        <span className="shrink-0 text-sm text-slate-500">{currency}</span>
        {draft.amount !== '' && (
          <button
            type="button"
            aria-label="Clear amount"
            onClick={() => set({ amount: '' })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {needsCharged && (
        <div className="border-t border-slate-200 px-3 py-2">
          <label className="flex h-10 items-center gap-2 text-sm">
            <span className="shrink-0 text-slate-600">
              Charged in <em className="not-italic font-medium text-slate-900">{settled}</em>
            </span>
            <input
              aria-label={`Charged in ${settled}`}
              inputMode="decimal"
              value={draft.chargedAmount}
              onChange={(e) => set({ chargedAmount: e.target.value })}
              placeholder="0"
              className={cx('min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-base tabular focus:outline-none')}
            />
          </label>
          <p className="text-xs text-slate-500">
            {chargedHint({ rate, currency, accountCurrency: settled, onDate: draft.occurredOn, accountName: account?.name ?? 'the account' })}
          </p>
        </div>
      )}

      {picking && (
        <CurrencySheet
          value={currency}
          accountCurrency={settled}
          baseCurrency={ws.baseCurrency}
          onPick={(code) => set({ currency: code, chargedAmount: code === settled ? '' : draft.chargedAmount })}
          onClose={() => setPicking(false)}
        />
      )}
      {keypad && (
        <Keypad value={draft.amount} currency={currency || ws.baseCurrency} onChange={(amount) => set({ amount })} onClose={() => setKeypad(false)} />
      )}
    </div>
  );
}
