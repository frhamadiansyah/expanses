import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useStoredRates } from '../../lib/queries';
import { cx } from '../../ui';
import { CurrencySheet } from './CurrencySheet';
import { Keypad } from './Keypad';
import {
  amountAfterEnter,
  chargedHint,
  chargedInNeeded,
  currencyFlag,
  estimatedCharge,
  type FormDraft,
  suggestedRate,
  typedCurrency,
} from './tx-form';

/** What the day's rate says, and what it could not say — the rate row's only producer of `missingRate`. */
export interface SuggestedRate {
  rate: number | null;
  /** The pair `resolveRates` had nothing stored for, for `extraRows`'s `missingRate`. */
  missing: { from: string; to: string; onDate: string } | null;
  /** True when the rate shown came from some other day than `onDate`. */
  stale: boolean;
}

const NOTHING: SuggestedRate = { rate: null, missing: null, stale: false };

/**
 * A rate for the day, for the estimate in the charged row and the hint under it. It is only ever a suggestion:
 * the figure that posts is whatever the account actually charged, and the row stays editable.
 *
 * It reads **only what this device already stored** (`useStoredRates`). Opening a form is not consent to talk
 * to a rate server: the fetch belongs to Save, where the eight existing callers of `useResolveRates` keep it.
 * When nothing is stored the pair comes back in `missing`, which is what asks the user for a rate by hand.
 */
export function useSuggestedRate(from: string, to: string, onDate: string): SuggestedRate {
  const { ws } = useApp();
  const storedRates = useStoredRates();
  const pair = !!from && !!to && from !== to;
  // 'suggested-rate' is used by nothing else in the app; it is narrowed by workspace like every other key here.
  const query = useQuery({
    queryKey: ['suggested-rate', ws.workspaceId, from, to, onDate],
    queryFn: () => storedRates([from, to].filter((c) => c !== ws.baseCurrency), onDate),
    enabled: pair,
  });
  if (!pair) return from && to ? { ...NOTHING, rate: 1 } : NOTHING;
  if (!query.data) return NOTHING;
  const rate = suggestedRate({ rates: query.data.rates, from, to, base: ws.baseCurrency });
  const absent = [from, to].filter((c) => query.data!.missing.includes(c));
  return {
    rate,
    missing: rate === null || absent.length > 0 ? { from, to, onDate } : null,
    stale: [from, to].some((c) => query.data!.stale.includes(c)),
  };
}

/**
 * One money field, wherever it appears on this row.
 *
 * On a phone it is a button that opens the keypad, because the keypad is the only way to type money on a touch
 * screen — including the "Charged in …" row, which is the figure that actually posts. On a desktop it is a real
 * text input whose blur and Enter run the same evaluator the keypad's DONE runs, so `272400+5000` works in
 * either field at either width. A field with no evaluator is a second, weaker way to enter money.
 */
function MoneyField({
  label,
  value,
  currency,
  phone,
  onChange,
  onKeypad,
  className,
}: {
  label: string;
  value: string;
  currency: string;
  phone: boolean;
  onChange: (value: string) => void;
  onKeypad: () => void;
  className: string;
}) {
  if (phone) {
    return (
      <button type="button" aria-label={label} onClick={onKeypad} className={cx(className, 'truncate text-left')}>
        {value || <span className="text-slate-400">0</span>}
      </button>
    );
  }
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const { text } = amountAfterEnter(value, currency);
        if (text !== value) onChange(text);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        // Enter evaluates; it does not also save. A second Enter, on a field that no longer changes, submits.
        const { text, submit } = amountAfterEnter(value, currency);
        if (text !== value) onChange(text);
        if (!submit) e.preventDefault();
      }}
      placeholder="0"
      className={cx(className, 'border-0 bg-transparent p-0 focus:outline-none')}
    />
  );
}

/**
 * The figure, and the currency it was typed in.
 *
 * On a phone both figures open the keypad, which is the only way in on a touch screen and carries the
 * arithmetic with it. **On a desktop they are real text inputs and the keyboard does what the keypad
 * does**: the same evaluator runs when a field is left and when Enter is pressed, so `85000+15000` works where
 * there is no keypad to press DONE on. A desktop is not a phone with the keypad taken away.
 *
 * When the currency on the flag is not the paying account's, the "Charged in …" row appears underneath: that
 * figure is what posts, and the typed one is recorded as what the merchant charged. It opens pre-filled at the
 * day's rate (§3.3) and is editable to what the bank actually took.
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
  const [keypad, setKeypad] = useState<'amount' | 'charged' | null>(null);
  const [picking, setPicking] = useState(false);
  const account = accounts.find((a) => a.id === draft.moneyId);
  const currency = typedCurrency(draft, accounts);
  const settled = account?.currency ?? '';
  const needsCharged = chargedInNeeded(draft, accounts);
  const { rate, stale } = useSuggestedRate(needsCharged ? currency : '', needsCharged ? settled : '', draft.occurredOn);

  // §3.3: "pre-filled with an estimate at that day's rate". Only into an empty row, and only when the figure or
  // the rate behind the estimate has changed — a row the user has typed in, or deliberately cleared, is theirs.
  const estimate = needsCharged ? estimatedCharge({ amount: draft.amount, currency, accountCurrency: settled, rate }) : null;
  useEffect(() => {
    if (estimate && !draft.chargedAmount.trim()) set({ chargedAmount: estimate });
    // The estimate is the only trigger. The row's own text is read but deliberately not a dependency: were it
    // one, clearing the row by hand would immediately re-fill it.
  }, [estimate]);

  const fieldClass = 'min-w-0 flex-1 text-2xl tabular focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900';
  const toggle = (which: 'amount' | 'charged') => setKeypad((open) => (open === which ? null : which));

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
        <MoneyField
          label="Amount"
          value={draft.amount}
          currency={currency || ws.baseCurrency}
          phone={phone}
          onChange={(amount) => set({ amount })}
          onKeypad={() => toggle('amount')}
          className={fieldClass}
        />
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
          <div className="flex h-10 items-center gap-2 text-sm">
            <span className="shrink-0 text-slate-600">
              Charged in <em className="not-italic font-medium text-slate-900">{settled}</em>
            </span>
            <MoneyField
              label={`Charged in ${settled}`}
              value={draft.chargedAmount}
              currency={settled || ws.baseCurrency}
              phone={phone}
              onChange={(chargedAmount) => set({ chargedAmount })}
              onKeypad={() => toggle('charged')}
              className="min-w-0 flex-1 text-right text-base tabular focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
            />
          </div>
          <p className="text-xs text-slate-500">
            {chargedHint({ rate, currency, accountCurrency: settled, onDate: draft.occurredOn, accountName: account?.name ?? 'the account', stale })}
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
        <Keypad
          value={keypad === 'amount' ? draft.amount : draft.chargedAmount}
          currency={(keypad === 'amount' ? currency : settled) || ws.baseCurrency}
          onChange={(text) => set(keypad === 'amount' ? { amount: text } : { chargedAmount: text })}
          onClose={() => setKeypad(null)}
        />
      )}
    </div>
  );
}
