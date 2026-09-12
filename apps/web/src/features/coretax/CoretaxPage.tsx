import { balanceSheet, carryOver, isoDate, readiness, reconciliation } from '@expanses/core';
import { draftReport } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Money, PageHeader, Select } from '../../ui';
import { NetWorthTabs } from '../networth/NetWorthTabs';
import { useSheet } from '../networth/queries';
import { FreezePanel } from './FreezePanel';
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

  async function start(basis?: 'cost' | 'estimate' | 'njop' | 'appraisal', repeat?: 'holding' | 'year') {
    setError(null);
    setBusy(true);
    try {
      await draftReport(database, ws, { taxYear, propertyBasis: basis, repeatRows: repeat });
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Coretax" />
      <NetWorthTabs />
      <ErrorBox error={error ?? report.error ?? rows.error} />

      <Card className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Tax year" className="w-40">
          <Select value={String(taxYear)} onChange={(e) => setTaxYear(Number(e.target.value))}>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </Field>
        <span className="flex items-center gap-3">
          {report.data && (
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', report.data.status === 'draft' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800')}>
              {STATUS_LABELS[report.data.status]}
              {report.data.filedOn && ` ${report.data.filedOn}`}
            </span>
          )}
          {!report.data && (
            <Button disabled={busy} onClick={() => void start()}>
              Start the {taxYear} report
            </Button>
          )}
        </span>
      </Card>

      {!report.data && report.isSuccess && (
        <Empty>
          Nothing for {taxYear} yet. Starting a report reads what your ledger held on 31 December {taxYear} — it changes nothing and files nothing.
        </Empty>
      )}

      {report.data && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Ikhtisar</h2>
              <span className="text-sm text-slate-600">
                Harta <Money minor={check.hartaMinor} currency={ws.baseCurrency} className="font-semibold text-slate-900" /> · Utang{' '}
                <Money minor={check.utangMinor} currency={ws.baseCurrency} className="font-semibold text-slate-900" />
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {sections.map((section) => (
                <div key={section.section} className="rounded-xl p-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">{section.label}</div>
                  <Money minor={section.valueMinor} currency={ws.baseCurrency} className="font-semibold" />
                  <div className="text-xs text-slate-500">{section.rows.length === 1 ? '1 row' : `${section.rows.length} rows`}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              The report says <Money minor={check.reportNetMinor} currency={ws.baseCurrency} />, and your balance sheet on 31 December {taxYear} says{' '}
              <Money minor={check.netWorthMinor} currency={ws.baseCurrency} />.
              {check.differenceMinor !== 0 && (
                <>
                  {' The gap is '}
                  <Money minor={check.differenceMinor} currency={ws.baseCurrency} tone="auto" />.
                  <ul className="mt-1 list-disc pl-4">
                    {check.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>

          {report.data.status === 'draft' && (
            <Card className="grid gap-3 md:grid-cols-2">
              <Field label="Property and vehicles report" hint="The cost is what you paid; the others are what you say it is worth now.">
                <Select value={report.data.propertyBasis} onChange={(e) => void start(e.target.value as 'cost' | 'estimate' | 'njop' | 'appraisal', report.data!.repeatRows)}>
                  <option value="cost">What I paid</option>
                  <option value="estimate">My estimate</option>
                  <option value="njop">NJOP from the PBB notice</option>
                  <option value="appraisal">An appraisal</option>
                </Select>
              </Field>
              <Field label="Holdings bought over several years" hint="One row each, or a row per year of purchase.">
                <Select value={report.data.repeatRows} onChange={(e) => void start(report.data!.propertyBasis, e.target.value as 'holding' | 'year')}>
                  <option value="holding">One row per holding</option>
                  <option value="year">One row per year of purchase</option>
                </Select>
              </Field>
            </Card>
          )}

          <Card className="space-y-2">
            <h2 className="text-sm font-semibold">Before you file</h2>
            {blocking.length === 0 && warnings.length === 0 && <p className="text-sm text-slate-500">Nothing missing. Every row has what its table asks for.</p>}
            {[...blocking, ...warnings].map((link) => (
              <div key={link.issue.key} className="flex items-start justify-between gap-3 border-t border-slate-100 py-2 text-sm first:border-t-0">
                <span className="flex gap-2">
                  <i className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', link.issue.level === 'blocking' ? 'bg-red-500' : 'bg-amber-500')} />
                  {link.issue.message}
                </span>
                <Link to={link.to} className="shrink-0 text-slate-600 underline">
                  Fix
                </Link>
              </div>
            ))}
          </Card>

          <FreezePanel taxYear={taxYear} status={report.data.status} />

          {sections.map((section) => (
            <SectionTable key={section.section} section={section} carry={carry} />
          ))}

          <p className="text-xs text-slate-500">
            Everything here stays on this device. The report holds your NPWP, NIK and account numbers, so nothing is sent anywhere and nothing is filed for you.
          </p>
        </>
      )}
    </div>
  );
}
