import { X } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useStoredRates } from '../../lib/queries';
import { cx } from '../../ui';
import { CurrencySheet } from './CurrencySheet';
import { ROW_BODY_FLUSH, RowLead } from './FormRow';
import { Keypad } from './Keypad';
import {
  amountAfterEnter,
  amountFace,
  amountFields,
  chargedHint,
  chargedInNeeded,
  currencyChoosable,
  currencyFlag,
  estimatedCharge,
  type FormDraft,
  type MoneyFieldSpec,
  prefilledCharge,
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
 *
 * The label, the text and the currency arrive together as one `MoneyFieldSpec` from `amountFields`, so this
 * component never decides which currency it is reading in — that decision is made once, in the kit.
 */
function MoneyField({
  field,
  phone,
  onChange,
  onKeypad,
  className,
  placeholder = 'Amount',
}: {
  field: MoneyFieldSpec;
  placeholder?: string;
  phone: boolean;
  onChange: (value: string) => void;
  onKeypad: () => void;
  className: string;
}) {
  const { label, value, currency } = field;
  if (phone) {
    return (
      /*
       * The whole height of the row it sits in is the tap target, not the height of the figure printed in it.
       * A bare button's box is its text — 32px in a 56px row — which is under the 44pt minimum for a thumb, on
       * the most-pressed control on the card. `self-stretch` gives the button its row's height and the inner
       * span keeps the figure exactly where it was, so this changes what receives the tap and not the look.
       */
      <button type="button" aria-label={label} onClick={onKeypad} className={cx(className, 'flex items-center self-stretch text-left')}>
        <span className="min-w-0 flex-1 truncate">{value ? amountFace(value, currency) : <span className="text-[var(--ph-ink-3)]">{placeholder}</span>}</span>
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
      placeholder={placeholder}
      className={cx(className, 'border-0 bg-transparent p-0 placeholder:text-[var(--ph-ink-3)] focus:outline-none')}
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
  const choosable = currencyChoosable(draft);
  // One decision about which currency each figure is typed in, read by the row, the keypad and nothing else.
  const fields = amountFields(draft, accounts, ws.baseCurrency);
  const { rate, stale } = useSuggestedRate(needsCharged ? currency : '', needsCharged ? settled : '', draft.occurredOn);

  /*
   * §3.3: "pre-filled with an estimate at that day's rate", and it tracks the amount for as long as the row is
   * still the estimate's. A row reopened on an existing transaction already holds what the bank actually took,
   * so it starts out the user's and is never written over.
   *
   * Emptiness is **not** what says the row is free: a figure typed one digit at a time fills the row on its
   * first keystroke, and reading emptiness as "untouched" is exactly how ¥120 came to post Rp 2.270 — the rate
   * for ¥1. `touched` is set by the two writers that are the user (the field itself, and the dock while it is
   * typing into this field) and by nothing else.
   */
  const touched = useRef(draft.chargedAmount.trim() !== '');
  const setCharged = (chargedAmount: string) => {
    touched.current = true;
    set({ chargedAmount });
  };
  const estimate = needsCharged ? estimatedCharge({ amount: draft.amount, currency, accountCurrency: settled, rate }) : null;
  const prefill = prefilledCharge({ estimate, charged: draft.chargedAmount, touched: touched.current });
  useEffect(() => {
    if (prefill !== null) set({ chargedAmount: prefill });
    // `prefill` is already the whole decision — null the moment the row holds what it should — so this settles
    // in one pass rather than re-filling a row that agrees with the estimate.
  }, [prefill]);

  const fieldClass = 'min-w-0 flex-1 text-[15px] leading-5 text-[var(--ph-ink)] tabular ph-focus-inset';
  const toggle = (which: 'amount' | 'charged') => setKeypad((was) => (was === which ? null : which));
  /** The field the dock is typing into, or null when it is shut. */
  const open = keypad === null ? null : keypad === 'amount' ? fields.amount : fields.charged;
  const flagCircle = 'flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[19px] leading-none';

  /*
   * Option B's amount row (§3.3, C1-C3): it reads like any other row — a round flag for the currency in the lead,
   * the figure where a row's title goes, the code as the caption on the right. It is **not** a giant number. The
   * rows are drawn straight into the card's group, so the hairline between them is the group's own.
   */
  return (
    <>
      {/* While the dock is open the figure sits above the dock's own backdrop (z-30), so tapping it again
          puts the dock away rather than being swallowed by the sheet of glass the dock lays over the page —
          without that, the fourth way out is unreachable, which an e2e now holds in place. Only while the
          dock is open: raised at all times it would paint over any sheet that opened later. */}
      <div className={cx('flex items-center gap-[10px] pl-[10px]', keypad !== null && 'relative z-40 bg-[var(--ph-surface)]')}>
        <RowLead>
          {/* The flag is a control only where a figure may be typed in a currency of its own. A transfer's may
              not — `currencyChoosable` says why — and a control the save ignores is worse than no control: this
              one drew "Charged in IDR = 1600000" over a transfer that moved Rp 100. There the flag is only
              drawn, so the row still says what it is being read in. */}
          {choosable ? (
            <button
              type="button"
              onClick={() => {
                // One thing open at a time: the dock is over the page, and the sheet has to be over the dock.
                setKeypad(null);
                setPicking(true);
              }}
              aria-label="Currency"
              className={cx(flagCircle, 'ph-focus')}
            >
              <span aria-hidden>{currencyFlag(currency)}</span>
            </button>
          ) : (
            <span aria-hidden className={flagCircle}>
              {currencyFlag(currency)}
            </span>
          )}
        </RowLead>
        {/* No vertical padding: the figure's button takes the row's whole 48px as its target, not 36 of it. */}
        <span className={ROW_BODY_FLUSH}>
          <MoneyField
            field={fields.amount}
            phone={phone}
            onChange={(amount) => set({ amount })}
            onKeypad={() => toggle('amount')}
            className={fieldClass}
          />
          <span className="shrink-0 text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{currency}</span>
          {draft.amount !== '' && (
            <button
              type="button"
              aria-label="Clear amount"
              onClick={() => set({ amount: '' })}
              className="ph-focus ph-tap flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-3)]"
              style={{ '--ph-tap-y': '12px', '--ph-tap-x': '12px' } as CSSProperties}
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </span>
      </div>

      {fields.charged && (
        <div className={cx(keypad !== null && 'relative z-40 bg-[var(--ph-surface)]')}>
          <div className="flex items-center gap-[10px] pl-[10px]">
            <RowLead>
              <span aria-hidden className={flagCircle}>
                {currencyFlag(settled)}
              </span>
            </RowLead>
            {/* The hairline is drawn here by hand: this row sits inside its own wrapper, where the group's rule
                for "every row but the first" cannot see it. */}
            <span className={cx(ROW_BODY_FLUSH, 'border-t-[0.5px] border-[var(--ph-hair)]')}>
              <MoneyField
                field={fields.charged}
                phone={phone}
                onChange={setCharged}
                onKeypad={() => toggle('charged')}
                className={fieldClass}
                placeholder="0"
              />
              <span className="shrink-0 text-[12.5px] leading-4 text-[var(--ph-ink-3)]">
                Charged in <em className="not-italic">{settled}</em>
              </span>
            </span>
          </div>
          <p className="pr-[13px] pb-2 pl-[54px] text-[12px] leading-4 text-[var(--ph-ink-3)]">
            {chargedHint({ rate, currency, accountCurrency: settled, onDate: draft.occurredOn, accountName: account?.name ?? 'the account', stale })}
          </p>
        </div>
      )}

      {picking && (
        <CurrencySheet
          value={currency}
          accountCurrency={settled}
          baseCurrency={ws.baseCurrency}
          onPick={(code) => {
            // A new currency makes whatever is in the charged row a conversion of nothing: it was worked out
            // from, or typed against, the code that has just been replaced. The row goes back to the estimate's.
            touched.current = false;
            set({ currency: code, chargedAmount: code === settled ? '' : draft.chargedAmount });
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {/* The dock types into whichever field opened it, in that field's own currency — the same record the
          field itself was drawn from, so the two can never read one figure at two different scales. */}
      {open && (
        <Keypad
          value={open.value}
          currency={open.currency}
          onChange={(text) => (open.which === 'amount' ? set({ amount: text }) : setCharged(text))}
          onClose={() => setKeypad(null)}
        />
      )}
    </>
  );
}
