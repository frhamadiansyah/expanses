import type { IncomeRow, IncomeTreatment } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { Card, Money } from '../../ui';
import { InsetGroup, InsetRow, Panel } from '../../ui/native';
import { useIncomeRows } from './queries';

const KIND_LABELS: Record<IncomeRow['kind'], string> = {
  dividend: 'dividend',
  coupon: 'coupon',
  distribution: 'distribution',
  interest: 'interest',
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
    <Panel header="Income and final tax" footer={`What your holdings paid in ${taxYear}, and what was withheld. Each band matches a part of the return.`} pad={false}>
      {BANDS.map((band) => {
        const inBand = rows.filter((row) => (row.treatment ?? 'unset') === band.key);
        if (inBand.length === 0) return null;
        // A holding in another currency is not added in: its figures are in its own money.
        const withheld = inBand.filter((row) => !row.foreign).reduce((total, row) => total + row.taxMinor, 0);
        const unset = band.key === 'unset';
        return (
          <InsetGroup
            key={band.key}
            header={band.title}
            footer={band.why}
            trailing={
              unset ? undefined : (
                <>
                  withheld <Money minor={withheld} currency={ws.baseCurrency} />
                </>
              )
            }
          >
            {inBand.map((row) => (
              <InsetRow
                key={`${row.accountId}:${row.kind}:${row.treatment ?? 'unset'}`}
                testId="income-row"
                title={row.name}
                subtitle={
                  <>
                    {KIND_LABELS[row.kind]}
                    {row.foreign && ' · held abroad, in its own currency'}
                    {row.reinvestedInto.length > 0 && (
                      <span className="block">reinvested into {row.reinvestedInto.map((into) => into.name).join(', ')}</span>
                    )}
                  </>
                }
                value={<Money minor={row.grossMinor} currency={ws.baseCurrency} />}
                chevron={false}
              />
            ))}
          </InsetGroup>
        );
      })}

      {/* Outside the group, because this is the one band that is a warning rather than a total. */}
      {rows.some((row) => (row.treatment ?? 'unset') === 'unset') && (
        <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-warn)]">
          Left out of every total above rather than counted in the wrong one. Set how each is taxed on{' '}
          <Link to="/net-worth/assets" className="underline">
            its asset
          </Link>
          .
        </p>
      )}

      {reinvested.length > 0 && (
        <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-warn)]">
          <b>Laporan Realisasi Investasi.</b>{' '}
          <Money minor={reinvested.reduce((total, row) => total + row.grossMinor, 0)} currency={ws.baseCurrency} /> of reinvested dividends this
          year. The exemption holds only if that report reaches DJP as well as the SPT — this app names it and totals it, and cannot send it. The
          instruments are in your Harta list, which is the other half of what the rules ask for.
        </p>
      )}

      <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        These are the figures you recorded, added up — nothing here is calculated and no rate is applied. Check them against your bukti potong
        before filing.
        {anyForeign && ' A holding abroad shows its own currency and is never added into a rupiah total.'}
      </p>
    </Panel>
  );
}
