import { Globe, X } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useIsBookShared, useStoredRates } from '../../lib/queries';
import { cx } from '../../ui';
import { CurrencySheet } from './CurrencySheet';
import { ROW_BODY_FLUSH, RowLead } from './FormRow';
import { Keypad } from './Keypad';
import {
  amountAfterEnter,
  amountFace,
  amountFields,
  chargedInNeeded,
  chargedIsEstimate,
  currencyChoosable,
  currencyShown,
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
  // Household sharing spec §4.4 last line: a shared book's currency is the book's own, fixed for every member, so
  // the flag is drawn but never a control — the same "drawn, not a control" shape a transfer's flag already has.
  const sharedBook = useIsBookShared();
  const choosable = currencyChoosable(draft) && !sharedBook;
  const named = currencyShown(draft);
  // One decision about which currency each figure is typed in, read by the row, the keypad and nothing else.
  const fields = amountFields(draft, accounts, ws.baseCurrency);
  const { rate } = useSuggestedRate(needsCharged ? currency : '', needsCharged ? settled : '', draft.occurredOn);

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

  const fieldBase = 'min-w-0 flex-1 text-[15px] leading-5 text-[var(--ph-ink)] tabular ph-focus-inset';
  /** A code and the figure it names, side by side: the pair is what shares out the row's width. */
  const codeGroup = 'flex min-w-0 items-center gap-[5px] self-stretch';
  const codeClass = 'shrink-0 text-[12.5px] leading-4 font-semibold tracking-[0.2px] text-[var(--ph-ink-3)]';
  const toggle = (which: 'amount' | 'charged') => setKeypad((was) => (was === which ? null : which));
  /** The field the dock is typing into, or null when it is shut. */
  const open = keypad === null ? null : keypad === 'amount' ? fields.amount : fields.charged;
  // The same 28 px circle every other row of the card leads with; the flag is its glyph.
  const flagCircle = 'flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[15px] leading-none';
  /*
   * Whether the charged figure is still this form's own guess. Read at render from the same ref `prefilledCharge`
   * reads, so the mark in front of the figure and the pre-fill behind it can never disagree: every writer of the
   * ref also calls `set`, which is what brings us back here.
   */
  const guessed = fields.charged !== null && chargedIsEstimate({ value: fields.charged.value, touched: touched.current });

  /*
   * Option B's amount row (§3.3, C1-C3), with both figures on it: it reads like any other row — a round flag for
   * the currency in the lead, then each figure behind the code it is read in, the two parted by a hairline. It is
   * **not** a giant number. The row is drawn straight into the card's group, so the hairline above it is the
   * group's own.
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
              {named ? <span aria-hidden>{currencyFlag(fields.amount.currency)}</span> : <Globe size={16} aria-hidden className="text-[var(--ph-ink-3)]" />}
            </button>
          ) : (
            <span aria-hidden className={flagCircle}>
              {named ? currencyFlag(fields.amount.currency) : <Globe size={16} className="text-[var(--ph-ink-3)]" />}
            </span>
          )}
        </RowLead>
        {/* No vertical padding: the figure's button takes the row's whole 48px as its target, not 36 of it. */}
        <span className={cx(ROW_BODY_FLUSH, 'gap-[10px]')}>
          {/* The code names the field; the field holds the figure. Kept out of the control on purpose: a button
              whose text is "IDR450.000" reads that to a screen reader and to every test that asks a money field
              what it is showing, and the figure is what a money field shows. */}
          <span className={cx(codeGroup, fields.charged ? 'shrink' : 'flex-1')}>
            {named && (
              <span aria-hidden className={codeClass}>
                {fields.amount.currency}
              </span>
            )}
            <MoneyField
              field={fields.amount}
              phone={phone}
              onChange={(amount) => set({ amount })}
              onKeypad={() => toggle('amount')}
              className={fieldBase}
            />
          </span>
          {fields.charged && (
            <>
              {/* What parts the two figures. A rule rather than a printed bar: the app spends "·" as a joiner in
                  running text, and a second kind of punctuation between two money figures reads as arithmetic. */}
              <span aria-hidden className="h-[18px] w-px shrink-0 bg-[var(--ph-hair)]" />
              <span className={cx(codeGroup, 'flex-1')}>
                {/* The ≈ is the whole of what the line under this row used to say: this figure is the day's
                    estimate, not what the bank took. It goes on the first keystroke of the user's own. */}
                <span aria-hidden className={codeClass}>
                  {guessed ? `≈ ${fields.charged.currency}` : fields.charged.currency}
                </span>
                <MoneyField
                  field={fields.charged}
                  phone={phone}
                  onChange={setCharged}
                  onKeypad={() => toggle('charged')}
                  className={fieldBase}
                  placeholder="0"
                />
              </span>
            </>
          )}
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
