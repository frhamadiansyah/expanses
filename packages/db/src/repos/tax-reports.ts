import { type CoretaxRow, coretaxRows, isoDate, type ReportSettings, utangRows, uuidv7 } from '@expanses/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { taxYearReports, taxYearRows } from '../schema-tax';
import { coretaxInputsFor } from './tax-inputs';

export class TaxDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxDbError';
  }
}

export interface TaxReportRow {
  id: string;
  workspaceId: string;
  taxYear: number;
  status: 'draft' | 'frozen' | 'filed';
  frozenAt: string | null;
  filedOn: string | null;
  npwp: string | null;
  taxpayerName: string | null;
  propertyBasis: ReportSettings['propertyBasis'];
  repeatRows: ReportSettings['repeatRows'];
  createdAt: string;
}

export interface SaveReportInput {
  taxYear: number;
  npwp?: string | null;
  taxpayerName?: string | null;
  propertyBasis?: ReportSettings['propertyBasis'];
  repeatRows?: ReportSettings['repeatRows'];
}

const toRow = (row: typeof taxYearReports.$inferSelect): TaxReportRow => ({
  id: row.id,
  workspaceId: row.workspaceId,
  taxYear: row.taxYear,
  status: row.status,
  frozenAt: row.frozenAt,
  filedOn: row.filedOn,
  npwp: row.npwp,
  taxpayerName: row.taxpayerName,
  propertyBasis: row.propertyBasis,
  repeatRows: row.repeatRows,
  createdAt: row.createdAt,
});

/**
 * Opens the report for a year, or updates the one already open. A draft holds only the taxpayer's
 * details and the two settings: its rows are read live from the ledger until the year is frozen.
 */
export async function draftReport(database: Database, ws: WorkspaceContext, input: SaveReportInput, today: string = isoDate()): Promise<string> {
  const thisYear = Number(today.slice(0, 4));
  if (!Number.isInteger(input.taxYear) || input.taxYear < 2000 || input.taxYear > thisYear) {
    throw new TaxDbError(`${input.taxYear} is not a tax year you can report on yet`);
  }

  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(taxYearReports)
      .where(and(eq(taxYearReports.workspaceId, ws.workspaceId), eq(taxYearReports.taxYear, input.taxYear)));
    if (existing?.status === 'filed') throw new TaxDbError(`The ${input.taxYear} report is filed, so it cannot be changed`);

    const id = existing?.id ?? uuidv7();
    const values = {
      id,
      workspaceId: ws.workspaceId,
      taxYear: input.taxYear,
      status: existing?.status ?? ('draft' as const),
      frozenAt: existing?.frozenAt ?? null,
      filedOn: existing?.filedOn ?? null,
      npwp: input.npwp ?? existing?.npwp ?? null,
      taxpayerName: input.taxpayerName ?? existing?.taxpayerName ?? null,
      propertyBasis: input.propertyBasis ?? existing?.propertyBasis ?? ('cost' as const),
      repeatRows: input.repeatRows ?? existing?.repeatRows ?? ('holding' as const),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const { createdAt, ...changes } = values;
    await tx.insert(taxYearReports).values(values).onConflictDoUpdate({ target: taxYearReports.id, set: changes });
    return id;
  });
}

export async function reportFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<TaxReportRow | undefined> {
  const [row] = await database.db
    .select()
    .from(taxYearReports)
    .where(and(eq(taxYearReports.workspaceId, ws.workspaceId), eq(taxYearReports.taxYear, taxYear)));
  return row ? toRow(row) : undefined;
}

/** Every year the owner has a report for, newest first. */
export async function listReports(database: Database, ws: WorkspaceContext): Promise<TaxReportRow[]> {
  const rows = await database.db
    .select()
    .from(taxYearReports)
    .where(eq(taxYearReports.workspaceId, ws.workspaceId))
    .orderBy(desc(taxYearReports.taxYear));
  return rows.map(toRow);
}

/** The settings a report was saved with, in the shape the row builders expect. */
function settingsOf(report: TaxReportRow): ReportSettings {
  // KMK rates are entered per report on the freeze panel; none yet means a foreign amount waits.
  return { propertyBasis: report.propertyBasis, repeatRows: report.repeatRows, kmkRateBps: {} };
}

/** The rows the ledger says the year holds right now, harta then utang. */
async function liveRows(database: Database, ws: WorkspaceContext, report: TaxReportRow): Promise<CoretaxRow[]> {
  const inputs = await coretaxInputsFor(database, ws, report.taxYear);
  const settings = settingsOf(report);
  return [...coretaxRows(report.taxYear, inputs, settings), ...utangRows(report.taxYear, inputs, settings)];
}

async function reportRowTx(tx: Db, ws: WorkspaceContext, taxYear: number): Promise<TaxReportRow> {
  const [row] = await tx
    .select()
    .from(taxYearReports)
    .where(and(eq(taxYearReports.workspaceId, ws.workspaceId), eq(taxYearReports.taxYear, taxYear)));
  if (!row) throw new TaxDbError(`There is no ${taxYear} report yet`);
  return toRow(row);
}

/**
 * Copies what the ledger says into the report, which stops following it from then on. A later edit
 * to the ledger shows as a difference the owner can accept, rather than changing a return quietly.
 */
export async function freezeReport(database: Database, ws: WorkspaceContext, taxYear: number): Promise<{ rows: number }> {
  const rows = await (async () => {
    const report = await reportFor(database, ws, taxYear);
    if (!report) throw new TaxDbError(`There is no ${taxYear} report to freeze`);
    if (report.status === 'filed') throw new TaxDbError(`The ${taxYear} report is filed, so it cannot be frozen again`);
    if (report.status === 'frozen') throw new TaxDbError(`The ${taxYear} report is already frozen`);
    return liveRows(database, ws, report);
  })();

  return database.transaction(async (tx) => {
    const report = await reportRowTx(tx, ws, taxYear);
    const now = new Date().toISOString();
    await tx.delete(taxYearRows).where(and(eq(taxYearRows.reportId, report.id), eq(taxYearRows.workspaceId, ws.workspaceId)));
    await Promise.all(
      rows.map((row, index) =>
        tx.insert(taxYearRows).values({
          id: uuidv7(),
          reportId: report.id,
          workspaceId: ws.workspaceId,
          section: row.section,
          code: row.code,
          // The key carries the account, and the year too when rows are split.
          accountId: row.key.split(':')[0] ?? null,
          rowKey: row.key,
          name: row.name,
          acquiredYear: row.acquiredYear,
          sort: index,
          fieldsJson: JSON.stringify(row.fields),
          costMinor: row.costMinor,
          valueMinor: row.valueMinor,
          balanceMinor: row.balanceMinor,
          source: row.source,
          alreadyFiled: 0,
          createdAt: now,
        }),
      ),
    );
    await tx.update(taxYearReports).set({ status: 'frozen', frozenAt: now }).where(eq(taxYearReports.id, report.id));
    return { rows: rows.length };
  });
}

/** Marks a frozen report filed. From then on it is read-only, and next year carries over from it. */
export async function markFiled(database: Database, ws: WorkspaceContext, taxYear: number, filedOn: string): Promise<void> {
  await database.transaction(async (tx) => {
    const report = await reportRowTx(tx, ws, taxYear);
    if (report.status === 'draft') throw new TaxDbError(`The ${taxYear} report has to be frozen before it can be filed`);
    await tx.update(taxYearReports).set({ status: 'filed', filedOn }).where(eq(taxYearReports.id, report.id));
  });
}

/** The rows a frozen or filed report holds. A draft has none saved: it reads the ledger live. */
export async function savedRows(database: Database, ws: WorkspaceContext, taxYear: number): Promise<CoretaxRow[]> {
  const report = await reportFor(database, ws, taxYear);
  if (!report) return [];
  const rows = await database.db
    .select()
    .from(taxYearRows)
    .where(and(eq(taxYearRows.reportId, report.id), eq(taxYearRows.workspaceId, ws.workspaceId)))
    .orderBy(asc(taxYearRows.sort));
  return rows.map((row) => ({
    key: row.rowKey,
    section: row.section as CoretaxRow['section'],
    code: row.code,
    name: row.name,
    acquiredYear: row.acquiredYear,
    costMinor: row.costMinor,
    valueMinor: row.valueMinor,
    balanceMinor: row.balanceMinor,
    fields: JSON.parse(row.fieldsJson) as Record<string, string>,
    source: row.source,
    note: null,
  }));
}

export interface RowDifference {
  rowKey: string;
  name: string;
  field: 'costMinor' | 'valueMinor' | 'balanceMinor';
  savedMinor: number;
  ledgerMinor: number;
}

const COMPARED: RowDifference['field'][] = ['costMinor', 'valueMinor', 'balanceMinor'];

/** What the ledger says now against what the frozen report holds. A draft has nothing to compare. */
export async function rowDifferences(database: Database, ws: WorkspaceContext, taxYear: number): Promise<RowDifference[]> {
  const report = await reportFor(database, ws, taxYear);
  if (!report || report.status === 'draft') return [];
  const saved = await savedRows(database, ws, taxYear);
  const live = new Map((await liveRows(database, ws, report)).map((row) => [row.key, row]));

  const differences: RowDifference[] = [];
  for (const row of saved) {
    const now = live.get(row.key);
    if (!now) continue;
    for (const field of COMPARED) {
      if (row[field] !== now[field]) differences.push({ rowKey: row.key, name: row.name, field, savedMinor: row[field], ledgerMinor: now[field] });
    }
  }
  return differences;
}

/** Takes the ledger's figures for one row into a frozen report, and marks that row edited. */
export async function acceptLedgerValue(database: Database, ws: WorkspaceContext, taxYear: number, rowKey: string): Promise<void> {
  const report = await reportFor(database, ws, taxYear);
  if (!report) throw new TaxDbError(`There is no ${taxYear} report`);
  if (report.status === 'filed') throw new TaxDbError(`The ${taxYear} report is filed, so its rows cannot be changed`);
  const now = (await liveRows(database, ws, report)).find((row) => row.key === rowKey);
  if (!now) throw new TaxDbError('That row is no longer in the ledger');

  await database.db
    .update(taxYearRows)
    .set({ costMinor: now.costMinor, valueMinor: now.valueMinor, balanceMinor: now.balanceMinor, source: 'edited' })
    .where(and(eq(taxYearRows.reportId, report.id), eq(taxYearRows.workspaceId, ws.workspaceId), eq(taxYearRows.rowKey, rowKey)));
}
