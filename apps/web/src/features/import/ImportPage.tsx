import { type CsvDateFormat, type CsvMapping, type CsvRow, detectDelimiter, formatMinor, mapCsvRows, parseCsv } from '@expanses/core';
import { captureDrafts, existingExternalRefs, importRows } from '@expanses/db';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { moneyHolders, useAccounts, useInOpenBook, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox, Select } from '../../ui';
import { Figure, type GroupChild, InsetGroup, InsetRow, LargeTitle, RecordTable, SCREEN, SelectRow, SwitchRow } from '../../ui/native';

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
  const inOpenBook = useInOpenBook();
  const money = moneyHolders(all);
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The real chooser, kept in the DOM behind a row: the row is its face, and the file is still the file.
  const fileInput = useRef<HTMLInputElement>(null);

  const account = all.find((a) => a.id === accountId);
  const currency = account?.currency ?? ws.baseCurrency;
  const mapped = useMemo(() => (mapping ? mapCsvRows(table, mapping, currency, accountId) : { rows: [], errors: [] }), [table, mapping, currency, accountId]);
  // Matched on key, not name: renaming Other Expense to Miscellaneous once left every row defaulting to Skip.
  // An import records into the open workspace, so its fallbacks must be that workspace's categories.
  const otherExpense = all.find((a) => a.systemKey === 'miscellaneous' && inOpenBook(a))?.id ?? '';
  const otherIncome = all.find((a) => a.systemKey === 'income.other' && inOpenBook(a))?.id ?? '';
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
  const ColumnSelect = ({ label, value, onChange, allowNone, position }: GroupChild & { label: string; value: number | null; onChange: (v: number | null) => void; allowNone?: boolean }) => (
    // `position` is handed on, not swallowed: `InsetGroup` clones each child to give it its place in the group,
    // and a wrapper that dropped it would draw every one of these rows without its hairline.
    <SelectRow position={position} label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <option value="">—</option>}
      {columnNames.map((name, i) => (
        <option key={i} value={i}>
          {name}
        </option>
      ))}
    </SelectRow>
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
    <div className={SCREEN}>
      <LargeTitle title="Import CSV" />
      <ErrorBox error={error} />

      {/* The row opens the platform's own chooser; this is the chooser, so the file the app reads is the file. */}
      <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} className="sr-only" tabIndex={-1} />

      <InsetGroup header="What to import" footer="Export from your bank or card portal. Re-importing the same file skips rows already imported.">
        <SelectRow
          label="Into account"
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
        </SelectRow>
        {/* Dimmed and refusing the tap until an account is named, as every dimmed action row on this branch is. */}
        <InsetRow
          title="CSV file"
          subtitle={mapping ? fileName : undefined}
          value={mapping ? 'Choose another' : 'Choose…'}
          chevron={false}
          className={accountId ? undefined : 'opacity-40'}
          onClick={() => accountId && fileInput.current?.click()}
        />
      </InsetGroup>

      {result && <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]">{result}</p>}

      {mapping && account && (
        <>
          <InsetGroup header="Columns">
            <SwitchRow label="First row is a header" checked={mapping.hasHeader} onChange={(hasHeader) => set({ hasHeader })} />
            <ColumnSelect label="Date column" value={mapping.dateColumn} onChange={(v) => set({ dateColumn: v ?? 0 })} />
            <SelectRow label="Date format" value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as CsvDateFormat })}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            </SelectRow>
            <ColumnSelect label="Description column" value={mapping.descriptionColumn} onChange={(v) => set({ descriptionColumn: v ?? 0 })} />
            <SelectRow
              label="Amounts"
              value={mapping.amountColumn === null ? 'two' : 'one'}
              onChange={(e) => set(e.target.value === 'two' ? { amountColumn: null, outflowColumn: 0, inflowColumn: 1 } : { amountColumn: 0, outflowColumn: null, inflowColumn: null })}
            >
              <option value="one">One amount column</option>
              <option value="two">Separate debit and credit columns</option>
            </SelectRow>
            {/*
             * Two ways of reading a file's money, and only one of them at a time — written as four conditionals
             * rather than one branch of fragments, because `InsetGroup` hands each *child* its place in the group
             * and a fragment is a single child, which would leave one of its two rows unplaced.
             */}
            {mapping.amountColumn !== null && <ColumnSelect label="Amount column" value={mapping.amountColumn} onChange={(v) => set({ amountColumn: v ?? 0 })} />}
            {mapping.amountColumn !== null && (
              <SelectRow label="Sign" value={mapping.negativeIsOutflow ? 'neg' : 'pos'} onChange={(e) => set({ negativeIsOutflow: e.target.value === 'neg' })}>
                <option value="neg">Negative = money out (bank)</option>
                <option value="pos">Positive = charge (credit card)</option>
              </SelectRow>
            )}
            {mapping.amountColumn === null && <ColumnSelect label="Money out (debit)" value={mapping.outflowColumn} onChange={(v) => set({ outflowColumn: v })} allowNone />}
            {mapping.amountColumn === null && <ColumnSelect label="Money in (credit)" value={mapping.inflowColumn} onChange={(v) => set({ inflowColumn: v })} allowNone />}
          </InsetGroup>

          <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {mapped.rows.length} rows · {duplicates.size} already imported · {mapped.errors.length} unreadable
            {account.subtype === 'credit_card' && ' · Card payments default to Skip — record them as transfers from your bank.'}
          </p>
          {mapped.errors.length > 0 && (
            <ul className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-alarm)]">
              {mapped.errors.slice(0, 10).map((e) => (
                <li key={e.rowNumber}>
                  Row {e.rowNumber}: {e.message}
                </li>
              ))}
            </ul>
          )}

          {/* Two ways on with the file, both rows: the kit's one shape for an action, dimmed while it cannot run. */}
          <InsetGroup>
            <InsetRow
              title={`Send ${toReview.length} to review`}
              chevron={false}
              className={busy || toReview.length === 0 ? 'opacity-40' : undefined}
              onClick={() => !busy && void onSendToReview()}
            />
            <InsetRow
              title={`Import ${toImport.length} rows`}
              chevron={false}
              className={busy || toImport.length === 0 ? 'opacity-40' : undefined}
              onClick={() => !busy && void onImport()}
            />
          </InsetGroup>
          {/*
           * A row's category is chosen here, so the table stays a table on a phone — the same ruling `/review`
           * makes, and `detail` is how it is said rather than left to be inferred from a missing column.
           */}
          <RecordTable
            header="What will be imported"
            records={mapped.rows.slice(0, PREVIEW_LIMIT)}
            detail={{ kind: 'none' }}
            shape={{
              key: (row) => row.externalRef,
              title: (row) => row.description,
              subtitle: (row) => row.occurredOn,
              value: (row) => <Figure>{`${row.amountMinor > 0 ? '−' : '+'}${formatMinor(Math.abs(row.amountMinor), currency)}`}</Figure>,
            }}
            columns={[
              { key: 'date', heading: 'Date', cell: (row) => <span className="whitespace-nowrap">{row.occurredOn}</span> },
              { key: 'description', heading: 'Description', cell: (row) => row.description },
              {
                key: 'amount',
                heading: 'Amount',
                numeric: true,
                cell: (row) => <Figure>{`${row.amountMinor > 0 ? '−' : '+'}${formatMinor(Math.abs(row.amountMinor), currency)}`}</Figure>,
              },
              {
                key: 'category',
                heading: 'Category',
                cell: (row) =>
                  duplicates.has(row.externalRef) ? (
                    <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Already imported</span>
                  ) : (
                    <Select
                      aria-label={`Category for row ${row.rowNumber}`}
                      value={categoryFor(row)}
                      onChange={(e) => setOverrides({ ...overrides, [row.externalRef]: e.target.value })}
                      className="py-1"
                    >
                      <option value="">Skip</option>
                      {(['expense', 'income'] as const).map((kind) => (
                        <optgroup key={kind} label={kind === 'expense' ? 'Expense' : 'Income'}>
                          {/* An imported row is real spending, so it may only name the open workspace's categories — as
                              the draft queue and every recording picker already do. */}
                          {all
                            .filter((a) => a.kind === kind && a.archivedAt === null && inOpenBook(a))
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.parentId ? `  ${a.name}` : a.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </Select>
                  ),
              },
            ]}
          />
          {mapped.rows.length > PREVIEW_LIMIT && (
            <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Showing first {PREVIEW_LIMIT} rows; all {mapped.rows.length} will import.</p>
          )}
        </>
      )}
    </div>
  );
}
