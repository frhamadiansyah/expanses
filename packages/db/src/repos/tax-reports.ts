import { isoDate, type ReportSettings, uuidv7 } from '@expanses/core';
import { and, desc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { taxYearReports } from '../schema-tax';

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
