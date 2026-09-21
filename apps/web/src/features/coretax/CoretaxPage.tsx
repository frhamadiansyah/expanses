import { balanceSheet, carryOver, isoDate, readiness, reconciliation } from '@expanses/core';
import { draftReport } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { useSheet } from '../networth/queries';
import { FreezePanel } from './FreezePanel';
import { BusinessSection } from './BusinessSection';
import { IncomeSection } from './IncomeSection';
import { KmkRates } from './KmkRates';
import { readinessLinks, screenSections } from './report-rows';
import { SectionTable } from './SectionTable';
import { useReport, usePreviousRows, useReportRows, useReportYears } from './queries';

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', frozen: 'Frozen', filed: 'Filed' };

export function CoretaxPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const years = useReportYears();
  const [taxYear, setTaxYear] = useState(() => Number(isoDate().slice(0, 4)) - 1);
  const report = useReport(taxYear);
  const rows = useReportRows(taxYear);
  const previous = usePreviousRows(taxYear);
  const sheetInputs = useSheet(`${taxYear}-12-31`);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [npwp, setNpwp] = useState('');
  const [taxpayerName, setTaxpayerName] = useState('');
  const [savedWho, setSavedWho] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  const all = rows.data ?? [];
  const harta = all.filter((row) => row.section !== 'utang');
  const utang = all.filter((row) => row.section === 'utang');
  const sections = screenSections(all);
  const carry = carryOver(all, previous.data?.length ? previous.data : null);
  const issues = readiness(all, taxYear);
  const links = readinessLinks(issues, all);
  const blocking = links.filter((link) => link.issue.level === 'blocking');
  const warnings = links.filter((link) => link.issue.level === 'warning');
  const sheet = balanceSheet(sheetInputs.data?.assets ?? [], sheetInputs.data?.liabilities ?? []);
  const check = reconciliation(harta, utang, sheet.netWorthMinor);

  async function start(
    basis?: 'cost' | 'estimate' | 'njop' | 'appraisal',
    repeat?: 'holding' | 'year',
    who?: { npwp?: string; taxpayerName?: string },
  ) {
    setError(null);
    setBusy(true);
    try {
      await draftReport(database, ws, { taxYear, propertyBasis: basis, repeatRows: repeat, ...who });
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (report.data && loadedFor !== taxYear) {
    setLoadedFor(taxYear);
    setNpwp(report.data.npwp ?? '');
    setTaxpayerName(report.data.taxpayerName ?? '');
  }

  /** Saves who the report is for, and says so, because the converter file depends on it. */
  async function saveWho(who: { npwp: string; taxpayerName: string }) {
    setSavedWho(false);
    await start(report.data?.propertyBasis, report.data?.repeatRows, who);
    setSavedWho(true);
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Tax report" />
      <ErrorBox error={error ?? report.error ?? rows.error} />

      <InsetGroup header="Tax year">
        <SelectRow label="Tax year" value={String(taxYear)} onChange={(e) => setTaxYear(Number(e.target.value))}>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </SelectRow>
        {report.data && (
          <ReadOnlyRow
            label="Status"
            value={`${STATUS_LABELS[report.data.status]}${report.data.filedOn ? ` ${report.data.filedOn}` : ''}`}
          />
        )}
      </InsetGroup>

      {!report.data && (
        <InsetGroup>
          <InsetRow
            title={`Start the ${taxYear} report`}
            chevron={false}
            className={busy ? 'opacity-40' : undefined}
            onClick={() => !busy && void start()}
          />
        </InsetGroup>
      )}

      {!report.data && report.isSuccess && (
        <Empty>
          Nothing for {taxYear} yet. Starting a report reads what your ledger held on 31 December {taxYear} — it changes nothing and files nothing.
        </Empty>
      )}

      {report.data && (
        <>
          <InsetGroup
            header="Ikhtisar"
            footer={
              <>
                Harta <Money minor={check.hartaMinor} currency={ws.baseCurrency} /> · Utang{' '}
                <Money minor={check.utangMinor} currency={ws.baseCurrency} />. The report says{' '}
                <Money minor={check.reportNetMinor} currency={ws.baseCurrency} />, and your balance sheet on 31 December {taxYear} says{' '}
                <Money minor={check.netWorthMinor} currency={ws.baseCurrency} />.
                {check.differenceMinor !== 0 && (
                  <>
                    {' The gap is '}
                    <Money minor={check.differenceMinor} currency={ws.baseCurrency} tone="auto" />.
                    <ul className="mt-[4px] list-disc pl-4">
                      {check.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            }
          >
            {sections.map((section) => (
              <InsetRow
                key={section.section}
                title={section.label}
                subtitle={section.rows.length === 1 ? '1 row' : `${section.rows.length} rows`}
                value={<Money minor={section.valueMinor} currency={ws.baseCurrency} />}
                chevron={false}
              />
            ))}
          </InsetGroup>

          {report.data.status === 'draft' && (
            <>
              <InsetGroup header="Who it is for">
                <TextRow
                  label="NPWP"
                  hint="Sixteen digits. The converter sheet starts with it, so a file cannot be built without one."
                  value={npwp}
                  inputMode="numeric"
                  onChange={(e) => setNpwp(e.target.value)}
                  placeholder="0011223344556677"
                />
                <TextRow label="Nama wajib pajak" value={taxpayerName} onChange={(e) => setTaxpayerName(e.target.value)} />
                <SelectRow
                  label="Property and vehicles report"
                  hint="The cost is what you paid; the others are what you say it is worth now."
                  value={report.data.propertyBasis}
                  onChange={(e) => void start(e.target.value as 'cost' | 'estimate' | 'njop' | 'appraisal', report.data!.repeatRows)}
                >
                  <option value="cost">What I paid</option>
                  <option value="estimate">My estimate</option>
                  <option value="njop">NJOP from the PBB notice</option>
                  <option value="appraisal">An appraisal</option>
                </SelectRow>
                <SelectRow
                  label="Holdings bought over several years"
                  hint="One row each, or a row per year of purchase."
                  value={report.data.repeatRows}
                  onChange={(e) => void start(report.data!.propertyBasis, e.target.value as 'holding' | 'year')}
                >
                  <option value="holding">One row per holding</option>
                  <option value="year">One row per year of purchase</option>
                </SelectRow>
              </InsetGroup>

              {/* Its own group: an action sharing a group with the fields it saves is one mistap from saving a typo. */}
              <InsetGroup>
                <InsetRow
                  title="Save taxpayer details"
                  chevron={false}
                  className={busy ? 'opacity-40' : undefined}
                  onClick={() => !busy && void saveWho({ npwp: npwp.trim(), taxpayerName: taxpayerName.trim() })}
                />
              </InsetGroup>
              {savedWho && <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]">Saved</p>}
            </>
          )}

          {[...blocking, ...warnings].length > 0 ? (
            <InsetGroup header="Before you file">
              {[...blocking, ...warnings].map((link) => (
                <InsetRow
                  key={link.issue.key}
                  title={link.issue.message}
                  subtitle={link.issue.level === 'blocking' ? 'Needs fixing before you file' : 'Worth a look'}
                  value="Fix"
                  to={link.to}
                />
              ))}
            </InsetGroup>
          ) : (
            <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing missing. Every row has what its table asks for.</p>
          )}

          <KmkRates taxYear={taxYear} />
          <IncomeSection taxYear={taxYear} />
          <BusinessSection taxYear={taxYear} />

          <FreezePanel taxYear={taxYear} status={report.data.status} rows={all} npwp={report.data.npwp} />

          {sections.map((section) => (
            <SectionTable key={section.section} section={section} carry={carry} />
          ))}

          <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            Everything here stays on this device. The report holds your NPWP, NIK and account numbers, so nothing is sent anywhere and nothing is filed for you.
          </p>
        </>
      )}
    </div>
  );
}
