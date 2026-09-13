import { setKmkRate } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Input } from '../../ui';
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
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Exchange rates for {taxYear}</h2>
        <span className="text-xs text-slate-500">The Menteri Keuangan rate, which is the only one the form accepts</span>
      </div>

      <ErrorBox error={error ?? currencies.error ?? entered.error} />
      {saved && <p className="text-xs text-emerald-700">{saved}</p>}

      {missing.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Nothing is entered for {missing.join(', ')} yet, so anything held in {missing.length === 1 ? 'it' : 'them'} is reported as
          nothing. Enter the rate before you file.
        </p>
      )}

      <div className="space-y-2">
        {needed.map((currency) => (
          <div key={currency} className="flex flex-wrap items-end gap-2">
            <span className="w-12 pb-2 text-sm font-medium">{currency}</span>
            <label className="flex-1 text-xs text-slate-500">
              Rate to {ws.baseCurrency}
              <Input
                aria-label={`${currency} rate`}
                value={draftOf(currency).rate}
                onChange={(e) => change(currency, { rate: e.target.value })}
                inputMode="decimal"
                placeholder="17714"
              />
            </label>
            <label className="flex-1 text-xs text-slate-500">
              Decree
              <Input
                aria-label={`${currency} decree`}
                value={draftOf(currency).note}
                onChange={(e) => change(currency, { note: e.target.value })}
                placeholder="KMK 42/MK/EF.2/2026"
              />
            </label>
            <Button variant="secondary" onClick={() => void save(currency)}>
              Save
            </Button>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        The rate is set weekly, Wednesday to Tuesday. Use the week that contains 31 December {taxYear}, and record which decree it came
        from so the figure can be traced back. Published at{' '}
        <a href="https://fiskal.kemenkeu.go.id/informasi-publik/kurs-pajak" target="_blank" rel="noreferrer" className="underline">
          fiskal.kemenkeu.go.id
        </a>
        .
      </p>
    </Card>
  );
}
