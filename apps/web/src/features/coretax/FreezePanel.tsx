import { type CoretaxRow, type CoretaxSection, converterProblems, csvColumns, isoDate, type ReportSection, toConverterTsv, toReportCsv } from '@expanses/core';
import { acceptLedgerValue, freezeReport, markFiled } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Money } from '../../ui';
import { useRowDifferences } from './queries';

const FIELD_LABELS: Record<string, string> = { costMinor: 'cost', valueMinor: 'value', balanceMinor: 'balance' };

/**
 * Freezing a year, and what to do when the ledger moves afterwards. A frozen report is a copy: the
 * figures stop following the ledger, so a later edit shows here rather than changing a filed return.
 */
export function FreezePanel({
  taxYear,
  status,
  rows,
  npwp,
}: {
  taxYear: number;
  status: 'draft' | 'frozen' | 'filed';
  rows: CoretaxRow[];
  /** The sheet's first line is the taxpayer's NPWP, so a file cannot be built without one. */
  npwp: string | null;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const differences = useRowDifferences(taxYear);
  const [filedOn, setFiledOn] = useState(isoDate());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const differenceRows = differences.data ?? [];
  const sections = [...new Set(rows.map((row) => row.section))];

  /** Written here and never sent anywhere; the browser saves it where downloads go. */
  function save(name: string, body: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  const downloadCsv = (section: ReportSection) =>
    save(`tax-report-${taxYear}-${section}.csv`, toReportCsv(section, rows), 'text/csv;charset=utf-8');

  /** The converter sheet DJP publishes for this table, which becomes XML for Coretax. */
  const downloadConverter = (section: CoretaxSection) => {
    if (!npwp) return;
    save(`coretax-${taxYear}-${section}.tsv`, toConverterTsv(section, rows, { npwp, taxYear }), 'text/tab-separated-values;charset=utf-8');
  };

  // A type predicate, so the compiler knows utang is gone: it has no converter to call.
  const isHarta = (section: ReportSection): section is CoretaxSection => section !== 'utang';
  const hartaSections = sections.filter(isHarta);
  const blocked = new Set(hartaSections.filter((section) => converterProblems(section, rows).length > 0));

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Freezing {taxYear}</h2>

      {status === 'draft' && (
        <>
          <p className="text-sm text-slate-600">
            While this is a draft it follows your ledger, so it changes whenever you record something dated in {taxYear}. Freeze it when the figures are the ones you mean to file: the
            rows are copied, and anything you change afterwards shows up here instead of moving quietly.
          </p>
          <p className="text-xs text-slate-500">
            Before freezing, make sure every holding has a price for 31 December {taxYear}, and that anything held in another currency has its KMK rate.
          </p>
          <Button disabled={busy} onClick={() => void run(() => freezeReport(database, ws, taxYear))}>
            Freeze {taxYear}
          </Button>
        </>
      )}

      {status === 'frozen' && (
        <>
          <p className="text-sm text-slate-600">Frozen. The rows below are the copy; your ledger can move without touching them.</p>
          {differenceRows.length === 0 && <p className="text-sm text-slate-500">Nothing has changed in the ledger since you froze it.</p>}
          {differenceRows.length > 0 && (
            <div className="divide-y divide-slate-100 text-sm">
              {differenceRows.map((difference) => (
                <div key={`${difference.rowKey}-${difference.field}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    {difference.name} · {FIELD_LABELS[difference.field]}
                    <span className="block text-xs text-slate-500">
                      Frozen at <Money minor={difference.savedMinor} currency={ws.baseCurrency} />, the ledger now says{' '}
                      <Money minor={difference.ledgerMinor} currency={ws.baseCurrency} />
                    </span>
                  </span>
                  <Button variant="secondary" disabled={busy} onClick={() => void run(() => acceptLedgerValue(database, ws, taxYear, difference.rowKey))}>
                    Use the ledger figure
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <Field label="Filed on">
              <Input type="date" value={filedOn} max={isoDate()} onChange={(e) => setFiledOn(e.target.value)} />
            </Field>
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => markFiled(database, ws, taxYear, filedOn))}>
              Mark as filed
            </Button>
          </div>
          <p className="text-xs text-slate-500">Marking it filed makes it read-only, and next year carries over from it.</p>
        </>
      )}

      {status === 'filed' && <p className="text-sm text-slate-600">Filed, and read-only. Next year's report carries over from these rows.</p>}

      {rows.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-semibold">Take the tables with you</h3>
          <p className="text-xs text-slate-500">
            The converter file carries DJP's own columns for that table: paste it into the Excel converter and export the XML Coretax reads. The CSV is the same rows laid out for
            reading. Both hold your NPWP, NIK and account numbers, and are written straight to this device.
          </p>
          <div className="space-y-2">
            {hartaSections.map((section) => (
              <div key={section} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-32 shrink-0 text-slate-600">{section}</span>
                <Button variant="secondary" disabled={!npwp || blocked.has(section)} onClick={() => downloadConverter(section)}>
                  Converter file (.tsv)
                </Button>
                <Button variant="ghost" onClick={() => downloadCsv(section)}>
                  CSV to read
                </Button>
                {blocked.has(section) && <span className="text-xs text-red-700">Something this sheet needs is missing; see the list above.</span>}
              </div>
            ))}
            {sections.includes('utang') && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-32 shrink-0 text-slate-600">utang</span>
                <Button variant="ghost" onClick={() => downloadCsv('utang')}>
                  CSV to read
                </Button>
                <span className="text-xs text-slate-500">Coretax publishes no import for utang, so Bagian B is typed into the form.</span>
              </div>
            )}
          </div>
          {!npwp && <p className="text-xs text-red-700">The converter sheet starts with your NPWP, so add it to the report before building a file.</p>}
          <p className="text-xs text-slate-400">CSV columns: {csvColumns(hartaSections[0] ?? 'kas').join(', ')}</p>
        </div>
      )}

      <ErrorBox error={error} />
    </Card>
  );
}
