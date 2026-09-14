import { type CsvDateFormat, type CsvMapping, type CsvRow, detectDelimiter, formatMinor, mapCsvRows, parseCsv } from '@expanses/core';
import { captureDrafts, existingExternalRefs, importRows } from '@expanses/db';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, Field, PageHeader, Select } from '../../ui';

const PREVIEW_LIMIT = 300;

function findColumn(headers: string[], words: string[]): number {
  return headers.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)));
}

/** Card exports list charges as positive amounts; bank exports list money out as negative. */
function guessMapping(table: string[][], isCard: boolean): CsvMapping {
  const first = table[0] ?? [];
  const hasHeader = !first.some((c) => /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(c));
  const sample = (hasHeader ? table[1] : table[0]) ?? [];
  const date = findColumn(first, ['date', 'tanggal', 'tgl']);
  const description = findColumn(first, ['desc', 'keterangan', 'merchant', 'detail', 'transaksi', 'transaction', 'remark']);
  const amount = findColumn(first, ['amount', 'jumlah', 'nominal', 'nilai']);
  const debit = findColumn(first, ['debit', 'debet', 'withdrawal', 'keluar']);
  const credit = findColumn(first, ['credit', 'kredit', 'deposit', 'masuk']);
  const twoColumns = hasHeader && amount < 0 && debit >= 0 && credit >= 0;
  const dateColumn = Math.max(0, date);
  const dateFormat: CsvDateFormat = /^\d{4}[-/.]/.test(sample[dateColumn] ?? '') ? 'YYYY-MM-DD' : 'DD/MM/YYYY';
  return {
    hasHeader,
    dateColumn,
    dateFormat,
    descriptionColumn: description >= 0 ? description : 1,
    amountColumn: twoColumns ? null : amount >= 0 ? amount : 2,
    negativeIsOutflow: !isCard,
    outflowColumn: twoColumns ? debit : null,
    inflowColumn: twoColumns ? credit : null,
  };
}

export function ImportPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const all = useAccounts().data ?? [];
  const money = all.filter(isMoneyAccount);
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const account = all.find((a) => a.id === accountId);
  const currency = account?.currency ?? ws.baseCurrency;
  const mapped = useMemo(() => (mapping ? mapCsvRows(table, mapping, currency, accountId) : { rows: [], errors: [] }), [table, mapping, currency, accountId]);
  // Matched on key, not name: renaming Other Expense to Miscellaneous once left every row defaulting to Skip.
  const otherExpense = all.find((a) => a.systemKey === 'miscellaneous')?.id ?? '';
  const otherIncome = all.find((a) => a.systemKey === 'income.other')?.id ?? '';
  const categoryFor = (row: CsvRow) => overrides[row.externalRef] ?? (row.amountMinor > 0 ? otherExpense : account?.subtype === 'credit_card' ? '' : otherIncome);

  useEffect(() => {
    let cancelled = false;
    const refs = mapped.rows.map((r) => r.externalRef);
    void existingExternalRefs(database, ws, refs).then((found) => {
      if (!cancelled) setDuplicates(found);
    });
    return () => {
      cancelled = true;
    };
  }, [database, ws, mapped.rows]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    const text = await file.text();
    const parsed = parseCsv(text, detectDelimiter(text));
    setFileName(file.name);
    setTable(parsed);
    setMapping(guessMapping(parsed, account?.subtype === 'credit_card'));
    setOverrides({});
  }

  const set = (patch: Partial<CsvMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const width = Math.max(0, ...table.slice(0, 5).map((r) => r.length));
  const columnNames = Array.from({ length: width }, (_, i) => (mapping?.hasHeader && table[0]?.[i] ? table[0][i]! : `Column ${i + 1}${table[0]?.[i] ? ` (${table[0][i]})` : ''}`));
  const ColumnSelect = ({ label, value, onChange, allowNone }: { label: string; value: number | null; onChange: (v: number | null) => void; allowNone?: boolean }) => (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        {allowNone && <option value="">—</option>}
        {columnNames.map((name, i) => (
          <option key={i} value={i}>
            {name}
          </option>
        ))}
      </Select>
    </Field>
  );

  const toImport = mapped.rows.filter((r) => !duplicates.has(r.externalRef) && categoryFor(r));
  const toReview = mapped.rows.filter((r) => !duplicates.has(r.externalRef));

  /**
   * Sends the mapped rows to the review queue instead of the ledger.
   *
   * The same rows, stopped one step earlier: nothing is recorded until each is confirmed. A row whose
   * category could not be guessed comes along without one, which is a question to answer in the queue
   * rather than a reason to drop it here.
   */
  async function onSendToReview() {
    if (!account) return;
    setError(null);
    setBusy(true);
    try {
      if (toReview.length === 0) throw new Error('Nothing to send: every row has already been imported.');
      const outcome = await captureDrafts(
        database,
        ws,
        toReview.map((r) => ({
          source: 'csv' as const,
          occurredOn: r.occurredOn,
          description: r.description,
          amountMinor: r.amountMinor,
          currency,
          accountId: account.id,
          categoryAccountId: categoryFor(r) || null,
          externalRef: r.externalRef,
          // No per-row payload for a CSV: the file is what the source said, and it is not retained.
          rawPayload: null,
        })),
      );
      setResult(`Sent ${outcome.captured} rows to Review${outcome.skipped > 0 ? `, ${outcome.skipped} already captured` : ''}. Nothing is recorded until you confirm it there.`);
      setTable([]);
      setMapping(null);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!account) return;
    setError(null);
    setBusy(true);
    try {
      if (toImport.length === 0) throw new Error('Nothing to import: every row is a duplicate or set to Skip.');
      let ratesToBaseByDate: Record<string, Record<string, number>> | undefined;
      if (currency !== ws.baseCurrency) {
        ratesToBaseByDate = {};
        for (const date of new Set(toImport.map((r) => r.occurredOn))) {
          const resolved = await resolveRates([currency], date);
          if (resolved.missing.length) throw new Error(`No ${currency}→${ws.baseCurrency} rate for ${date}.`);
          ratesToBaseByDate[date] = resolved.rates;
        }
      }
      const outcome = await importRows(database, ws, {
        accountId: account.id,
        currency,
        rows: toImport.map((r) => ({ occurredOn: r.occurredOn, description: r.description, amountMinor: r.amountMinor, externalRef: r.externalRef, categoryAccountId: categoryFor(r) })),
        ratesToBaseByDate,
      });
      const skippedByChoice = mapped.rows.length - toImport.length - duplicates.size;
      setResult(`Imported ${outcome.imported} transactions from ${fileName}. ${duplicates.size + outcome.skipped} already imported${skippedByChoice > 0 ? `, ${skippedByChoice} skipped` : ''}.`);
      setTable([]);
      setMapping(null);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Import CSV" />
      <Card className="grid gap-3 md:grid-cols-2">
        <Field label="Into account">
          <Select
            value={accountId}
            onChange={(e) => {
              const next = all.find((a) => a.id === e.target.value);
              setAccountId(e.target.value);
              setMapping((m) => (m ? { ...m, negativeIsOutflow: next?.subtype !== 'credit_card' } : m));
              setOverrides({});
            }}
          >
            <option value="">Choose…</option>
            {money.map((a) => (
              <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
            ))}
          </Select>
        </Field>
        <Field label="CSV file" hint="Export from your bank or card portal. Re-importing the same file skips rows already imported.">
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} disabled={!accountId} className="block w-full text-sm" />
        </Field>
      </Card>
      {result && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{result}</p>}
      <ErrorBox error={error} />

      {mapping && account && (
        <>
          <Card className="grid gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => set({ hasHeader: e.target.checked })} />
              First row is a header
            </label>
            <ColumnSelect label="Date column" value={mapping.dateColumn} onChange={(v) => set({ dateColumn: v ?? 0 })} />
            <Field label="Date format">
              <Select value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as CsvDateFormat })}>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              </Select>
            </Field>
            <ColumnSelect label="Description column" value={mapping.descriptionColumn} onChange={(v) => set({ descriptionColumn: v ?? 0 })} />
            <Field label="Amounts">
              <Select
                value={mapping.amountColumn === null ? 'two' : 'one'}
                onChange={(e) => set(e.target.value === 'two' ? { amountColumn: null, outflowColumn: 0, inflowColumn: 1 } : { amountColumn: 0, outflowColumn: null, inflowColumn: null })}
              >
                <option value="one">One amount column</option>
                <option value="two">Separate debit and credit columns</option>
              </Select>
            </Field>
            {mapping.amountColumn !== null ? (
              <>
                <ColumnSelect label="Amount column" value={mapping.amountColumn} onChange={(v) => set({ amountColumn: v ?? 0 })} />
                <Field label="Sign">
                  <Select value={mapping.negativeIsOutflow ? 'neg' : 'pos'} onChange={(e) => set({ negativeIsOutflow: e.target.value === 'neg' })}>
                    <option value="neg">Negative = money out (bank)</option>
                    <option value="pos">Positive = charge (credit card)</option>
                  </Select>
                </Field>
              </>
            ) : (
              <>
                <ColumnSelect label="Money out (debit)" value={mapping.outflowColumn} onChange={(v) => set({ outflowColumn: v })} allowNone />
                <ColumnSelect label="Money in (credit)" value={mapping.inflowColumn} onChange={(v) => set({ inflowColumn: v })} allowNone />
              </>
            )}
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">
                {mapped.rows.length} rows · {duplicates.size} already imported · {mapped.errors.length} unreadable
                {account.subtype === 'credit_card' && ' · Card payments default to Skip — record them as transfers from your bank.'}
              </p>
              <span className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void onSendToReview()} disabled={busy || toReview.length === 0}>
                  Send {toReview.length} to review
                </Button>
                <Button onClick={() => void onImport()} disabled={busy || toImport.length === 0}>
                  Import {toImport.length} rows
                </Button>
              </span>
            </div>
            {mapped.errors.length > 0 && (
              <ul className="mb-2 text-xs text-red-700">
                {mapped.errors.slice(0, 10).map((e) => (
                  <li key={e.rowNumber}>
                    Row {e.rowNumber}: {e.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Description</th>
                    <th className="py-1 pr-2 text-right">Amount</th>
                    <th className="py-1">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {mapped.rows.slice(0, PREVIEW_LIMIT).map((row) => {
                    const duplicate = duplicates.has(row.externalRef);
                    return (
                      <tr key={row.externalRef} className={cx('border-t border-slate-100', duplicate && 'opacity-50')}>
                        <td className="py-1 pr-2 whitespace-nowrap">{row.occurredOn}</td>
                        <td className="py-1 pr-2">{row.description}</td>
                        <td className={cx('tabular py-1 pr-2 text-right whitespace-nowrap', row.amountMinor > 0 ? 'text-red-700' : 'text-emerald-700')}>
                          {row.amountMinor > 0 ? '−' : '+'}
                          {formatMinor(Math.abs(row.amountMinor), currency)}
                        </td>
                        <td className="py-1">
                          {duplicate ? (
                            <span className="text-xs">Already imported</span>
                          ) : (
                            <Select aria-label={`Category for row ${row.rowNumber}`} value={categoryFor(row)} onChange={(e) => setOverrides({ ...overrides, [row.externalRef]: e.target.value })} className="py-1">
                              <option value="">Skip</option>
                              {(['expense', 'income'] as const).map((kind) => (
                                <optgroup key={kind} label={kind === 'expense' ? 'Expense' : 'Income'}>
                                  {all
                                    .filter((a) => a.kind === kind && a.archivedAt === null)
                                    .map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.parentId ? `  ${a.name}` : a.name}
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                            </Select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {mapped.rows.length > PREVIEW_LIMIT && <p className="mt-2 text-xs text-slate-500">Showing first {PREVIEW_LIMIT} rows; all {mapped.rows.length} will import.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
