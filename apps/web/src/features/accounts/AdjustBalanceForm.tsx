import { formatMinor, isoDate, parseMajor } from '@expanses/core';
import { type AccountRow, type AdjustAs, adjustBalance } from '@expanses/db';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow, TextRow } from '../../ui/native';
import { adjustChoices, adjustDifference, defaultAdjustAs, differenceWords } from './adjust-model';

/**
 * Count cash, or adjust any other balance: what the app holds, what is actually there, and — once the two differ —
 * what the difference was. Saved from the sheet's ✓, which stays dim until a figure that differs is typed.
 *
 * The app's figure is the balance on the day chosen, so a count dated last week is compared with last week.
 */
export function AdjustBalanceForm({
  account,
  formId,
  onCanSave,
  onDone,
}: {
  account: AccountRow;
  formId: string;
  onCanSave: (canSave: boolean) => void;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const currency = account.currency!;
  const today = isoDate();
  const [typed, setTyped] = useState('');
  const [onDate, setOnDate] = useState(today);
  const [as, setAs] = useState<AdjustAs>(defaultAdjustAs(account.subtype));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const balances = useBalances(onDate || today);
  const inApp = balances.isSuccess ? (balances.data[account.id] ?? 0) : null;
  const difference = inApp === null ? null : adjustDifference(typed, currency, inApp);
  const differs = difference !== null && difference !== 0;
  useEffect(() => onCanSave(differs && !busy), [onCanSave, differs, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !differs) return;
    setError(null);
    setBusy(true);
    try {
      let rateToBase: number | undefined;
      if (currency !== ws.baseCurrency) {
        rateToBase = (await resolveRates([currency], onDate)).rates[currency];
        if (rateToBase === undefined) throw new Error(`No ${currency}→${ws.baseCurrency} rate for ${onDate} yet, so this cannot be adjusted on that day.`);
      }
      await adjustBalance(database, ws, { accountId: account.id, actualMinor: parseMajor(typed, currency), onDate, as, rateToBase });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBox error={error ?? balances.error} />
      <InsetGroup className="!mb-0">
        <ReadOnlyRow label="In the app" value={inApp === null ? null : formatMinor(inApp, currency)} />
        <TextRow label="Actually have" inputMode="decimal" placeholder="Amount" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <TextRow label="As of" type="date" value={onDate} max={today} onChange={(e) => setOnDate(e.target.value)} />
      </InsetGroup>
      {differs && (
        <section className="rounded-[11px] bg-[var(--ph-surface)] px-[13px] py-[11px]" data-testid="adjust-difference">
          <p className="text-[15px] leading-[20px] text-[var(--ph-ink)]">
            <span className={cx('font-semibold', difference < 0 ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>{differenceWords(difference, currency)}</span>
            {' than the app says.'}
          </p>
          <div role="radiogroup" aria-label="What the difference was" className="mt-[10px] flex flex-col gap-[10px]">
            {adjustChoices(difference).map((choice) => (
              <label key={choice.value} className="flex cursor-pointer items-start gap-[10px]">
                <input
                  type="radio"
                  name="adjust-as"
                  value={choice.value}
                  checked={as === choice.value}
                  onChange={() => setAs(choice.value)}
                  className="mt-[2px] h-[18px] w-[18px] shrink-0 accent-[var(--ph-tint)]"
                />
                <span className="min-w-0 text-[15px] leading-[20px] text-[var(--ph-ink)]">
                  {choice.label}
                  <small className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{choice.detail}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}
    </form>
  );
}
