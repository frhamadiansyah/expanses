import { setKmkRate } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { useForeignCurrencies, useKmkRates } from './queries';

/**
 * The Menteri Keuangan rate for each currency the year holds.
 *
 * Typed by hand once a year, on purpose. The published figure sits behind an API that needs a token,
 * and a rate that quietly failed to fetch would be worse than one you can see is missing: a holding
 * with no rate is reported as nothing, which is wrong on a return in a way that is easy to miss.
 */
export function KmkRates({ taxYear }: { taxYear: number }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const currencies = useForeignCurrencies(taxYear);
  const entered = useKmkRates(taxYear);
  const [drafts, setDrafts] = useState<Record<string, { rate: string; note: string }>>({});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState('');

  const needed = currencies.data ?? [];
  if (needed.length === 0) return null;

  const rateOf = (currency: string) => (entered.data ?? []).find((row) => row.currency === currency);
  const draftOf = (currency: string) => {
    const existing = rateOf(currency);
    return drafts[currency] ?? { rate: existing ? String(existing.rate) : '', note: existing?.note ?? '' };
  };
  const change = (currency: string, patch: Partial<{ rate: string; note: string }>) =>
    setDrafts((current) => ({ ...current, [currency]: { ...draftOf(currency), ...patch } }));

  async function save(currency: string) {
    setError(null);
    setSaved('');
    try {
      const draft = draftOf(currency);
      const rate = Number(draft.rate.replace(/\./g, '').replace(',', '.'));
      if (!(rate > 0)) throw new Error(`Enter the rate for ${currency} as the decree states it`);
      await setKmkRate(database, ws, taxYear, { currency, rate, note: draft.note });
      await invalidate();
      setDrafts((current) => {
        const next = { ...current };
        delete next[currency];
        return next;
      });
      setSaved(`${currency} rate saved.`);
    } catch (e) {
      setError(e);
    }
  }

  const missing = needed.filter((currency) => rateOf(currency) === undefined);

  return (
    <>
      <ErrorBox error={error ?? currencies.error ?? entered.error} />
      {saved && <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]">{saved}</p>}

      {missing.length > 0 && (
        <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-warn)]">
          Nothing is entered for {missing.join(', ')} yet, so anything held in {missing.length === 1 ? 'it' : 'them'} is reported as nothing. Enter the rate before you file.
        </p>
      )}

      <InsetGroup
        header={`Exchange rates for ${taxYear}`}
        footer={`The Menteri Keuangan rate, which is the only one the form accepts. It is set weekly, Wednesday to Tuesday: use the week that contains 31 December ${taxYear}, and record which decree it came from so the figure can be traced back.`}
      >
        {needed.flatMap((currency) => [
          <TextRow
            key={`${currency}-rate`}
            label={`${currency} rate`}
            hint={`Rate to ${ws.baseCurrency}`}
            value={draftOf(currency).rate}
            onChange={(e) => change(currency, { rate: e.target.value })}
            inputMode="decimal"
            placeholder="17714"
          />,
          <TextRow
            key={`${currency}-decree`}
            label={`${currency} decree`}
            value={draftOf(currency).note}
            onChange={(e) => change(currency, { note: e.target.value })}
            placeholder="KMK 42/MK/EF.2/2026"
          />,
        ])}
      </InsetGroup>

      {/* One group an action: a save row sharing a group with the fields it saves is a mistap from saving nothing. */}
      {needed.map((currency) => (
        <InsetGroup key={currency}>
          <InsetRow title="Save" chevron={false} onClick={() => void save(currency)} />
        </InsetGroup>
      ))}

      <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        The published figure is at{' '}
        <a href="https://fiskal.kemenkeu.go.id/informasi-publik/kurs-pajak" target="_blank" rel="noreferrer" className="underline">
          fiskal.kemenkeu.go.id
        </a>
        .
      </p>
    </>
  );
}
