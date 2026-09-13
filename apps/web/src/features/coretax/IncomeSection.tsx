import type { IncomeRow, IncomeTreatment } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { Card, Money } from '../../ui';
import { useIncomeRows } from './queries';

const KIND_LABELS: Record<IncomeRow['kind'], string> = {
  dividend: 'dividend',
  coupon: 'coupon',
  distribution: 'distribution',
  sale: 'sale',
  other: 'income',
};

/** Each block matches a part of the return, which is the whole point of grouping them this way. */
const BANDS: { key: IncomeTreatment | 'unset'; title: string; why: string }[] = [
  { key: 'final', title: 'Final tax', why: 'reported, but not added to your taxable income' },
  { key: 'not_object', title: 'Tidak termasuk objek pajak', why: 'reinvested dividends — reported, no tax' },
  { key: 'ordinary', title: 'Ordinary income', why: 'added together and taxed progressively' },
  { key: 'unset', title: 'Not set', why: 'the app will not guess which box these belong in' },
];

export function IncomeSection({ taxYear }: { taxYear: number }) {
  const { ws } = useApp();
  const rows = useIncomeRows(taxYear).data ?? [];
  if (rows.length === 0) return null;

  const reinvested = rows.filter((row) => row.treatment === 'not_object');
  const anyForeign = rows.some((row) => row.foreign);

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Income and final tax</h2>
        <span className="text-xs text-slate-500">What your holdings paid in {taxYear}, and what was withheld</span>
      </div>

      {BANDS.map((band) => {
        const inBand = rows.filter((row) => (row.treatment ?? 'unset') === band.key);
        if (inBand.length === 0) return null;
        // A holding in another currency is not added in: its figures are in its own money.
        const withheld = inBand.filter((row) => !row.foreign).reduce((total, row) => total + row.taxMinor, 0);
        const unset = band.key === 'unset';
        return (
          <div key={band.key} className="border-t border-slate-100 pt-2 first:border-t-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className={unset ? 'text-xs font-semibold text-amber-700' : 'text-xs font-semibold'}>
                {band.title} <span className="font-normal text-slate-500">{band.why}</span>
              </h3>
              {!unset && (
                <span className="text-xs text-slate-600">
                  withheld <Money minor={withheld} currency={ws.baseCurrency} className="font-semibold text-slate-900" />
                </span>
              )}
            </div>
            <ul className="divide-y divide-slate-100">
              {inBand.map((row) => (
                <li key={`${row.accountId}:${row.kind}:${row.treatment ?? 'unset'}`} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{row.name}</span> <span className="text-xs text-slate-500">{KIND_LABELS[row.kind]}</span>
                    {row.foreign && <span className="ml-2 text-xs text-slate-500">held abroad, in its own currency</span>}
                    {row.reinvestedInto.length > 0 && (
                      <span className="block text-xs text-slate-500">
                        reinvested into {row.reinvestedInto.map((into) => into.name).join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="tabular text-right">
                    <Money minor={row.grossMinor} currency={ws.baseCurrency} />
                  </span>
                </li>
              ))}
            </ul>
            {unset && (
              <p className="mt-1 text-xs text-amber-700">
                Left out of every total above rather than counted in the wrong one. Set how each is taxed on{' '}
                <Link to="/net-worth/assets" className="underline">
                  its asset
                </Link>
                .
              </p>
            )}
          </div>
        );
      })}

      {reinvested.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>Laporan Realisasi Investasi.</b>{' '}
          <Money minor={reinvested.reduce((total, row) => total + row.grossMinor, 0)} currency={ws.baseCurrency} /> of reinvested dividends this
          year. The exemption holds only if that report reaches DJP as well as the SPT — this app names it and totals it, and cannot send it. The
          instruments are in your Harta list, which is the other half of what the rules ask for.
        </p>
      )}

      <p className="text-xs text-slate-500">
        These are the figures you recorded, added up — nothing here is calculated and no rate is applied. Check them against your bukti potong
        before filing.
        {anyForeign && ' A holding abroad shows its own currency and is never added into a rupiah total.'}
      </p>
    </Card>
  );
}
