import { type CoretaxRow, type CoretaxSection, converterProblems, csvColumns, isoDate, type ReportSection, toConverterTsv, toReportCsv } from '@expanses/core';
import { acceptLedgerValue, freezeReport, markFiled } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, Panel, TextRow } from '../../ui/native';
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
    <Panel header={`Freezing ${taxYear}`} pad={false}>
      {status === 'draft' && (
        <>
          <p className="mb-[10px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
            While this is a draft it follows your ledger, so it changes whenever you record something dated in {taxYear}. Freeze it when the figures are the ones you mean to file: the
            rows are copied, and anything you change afterwards shows up here instead of moving quietly.
          </p>
          <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">
            Before freezing, make sure every holding has a price for 31 December {taxYear}, and that anything held in another currency has its KMK rate.
          </p>
          <InsetGroup>
            <InsetRow title={`Freeze ${taxYear}`} chevron={false} disabled={busy} onClick={() => void run(() => freezeReport(database, ws, taxYear))} />
          </InsetGroup>
        </>
      )}

      {status === 'frozen' && (
        <>
          <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
            Frozen. The rows below are the copy; your ledger can move without touching them.
          </p>
          {differenceRows.length === 0 && (
            <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing has changed in the ledger since you froze it.</p>
          )}
          {differenceRows.length > 0 && (
            <InsetGroup header="The ledger has moved since">
              {differenceRows.map((difference) => (
                <InsetRow
                  key={`${difference.rowKey}-${difference.field}`}
                  title={`${difference.name} · ${FIELD_LABELS[difference.field]}`}
                  subtitle={
                    <>
                      Frozen at <Money minor={difference.savedMinor} currency={ws.baseCurrency} />, the ledger now says{' '}
                      <Money minor={difference.ledgerMinor} currency={ws.baseCurrency} />
                    </>
                  }
                  value="Use"
                  label="Use the ledger figure"
                  chevron={false}
                  disabled={busy}
                  onClick={() => void run(() => acceptLedgerValue(database, ws, taxYear, difference.rowKey))}
                />
              ))}
            </InsetGroup>
          )}
          <InsetGroup header="Filing">
            <TextRow label="Filed on" type="date" value={filedOn} max={isoDate()} onChange={(e) => setFiledOn(e.target.value)} />
          </InsetGroup>
          <InsetGroup>
            <InsetRow title="Mark as filed" chevron={false} disabled={busy} onClick={() => void run(() => markFiled(database, ws, taxYear, filedOn))} />
          </InsetGroup>
          <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Marking it filed makes it read-only, and next year carries over from it.</p>
        </>
      )}

      {status === 'filed' && (
        <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">Filed, and read-only. Next year's report carries over from these rows.</p>
      )}

      {rows.length > 0 && (
        <InsetGroup
          header="Take the tables with you"
          footer="The converter file carries DJP's own columns for that table: paste it into the Excel converter and export the XML Coretax reads. The CSV is the same rows laid out for reading. Both hold your NPWP, NIK and account numbers, and are written straight to this device."
        >
          {hartaSections.flatMap((section) => [
            <InsetRow
              key={`${section}-tsv`}
              title="Converter file (.tsv)"
              subtitle={blocked.has(section) ? `${section} · something this sheet needs is missing; see the list above` : section}
              label={`Converter file (.tsv) for ${section}`}
              chevron={false}
              disabled={!npwp || blocked.has(section)}
              onClick={() => downloadConverter(section)}
            />,
            <InsetRow
              key={`${section}-csv`}
              title="CSV to read"
              subtitle={section}
              label={`CSV to read for ${section}`}
              chevron={false}
              onClick={() => downloadCsv(section)}
            />,
          ])}
          {sections.includes('utang') && (
            <InsetRow
              title="CSV to read"
              subtitle="utang · Coretax publishes no import for utang, so Bagian B is typed into the form"
              label="CSV to read for utang"
              chevron={false}
              onClick={() => downloadCsv('utang')}
            />
          )}
        </InsetGroup>
      )}

      {!npwp && rows.length > 0 && (
        <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-alarm)]">
          The converter sheet starts with your NPWP, so add it to the report before building a file.
        </p>
      )}
      {rows.length > 0 && (
        <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">CSV columns: {csvColumns(hartaSections[0] ?? 'kas').join(', ')}</p>
      )}

      <ErrorBox error={error} />
    </Panel>
  );
}
