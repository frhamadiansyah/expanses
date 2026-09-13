import { sql } from 'drizzle-orm';
import ledger from '../migrations/0001_ledger.sql?raw';
import fx from '../migrations/0002_fx.sql?raw';
import points from '../migrations/0003_points.sql?raw';
import incrementRounding from '../migrations/0004_increment_rounding.sql?raw';
import catalog from '../migrations/0005_catalog.sql?raw';
import mccPoints from '../migrations/0006_mcc_points.sql?raw';
import assets from '../migrations/0007_assets.sql?raw';
import goals from '../migrations/0008_goals.sql?raw';
import buyFlow from '../migrations/0009_buy_flow.sql?raw';
import debts from '../migrations/0010_debts.sql?raw';
import loans from '../migrations/0011_loans.sql?raw';
import taxReports from '../migrations/0012_tax_reports.sql?raw';
import coretaxCodes from '../migrations/0013_coretax_codes.sql?raw';
import utangCodes from '../migrations/0014_utang_codes.sql?raw';
import budgetTables from '../migrations/0015_budgets.sql?raw';
import goalContributionTables from '../migrations/0016_goal_contributions.sql?raw';
import goalCalculatorTables from '../migrations/0017_goal_calculators.sql?raw';
import pointEntryTables from '../migrations/0018_point_entries.sql?raw';
import pointEntrySystemSource from '../migrations/0019_point_entry_system_source.sql?raw';
import pointEntryValue from '../migrations/0020_point_entry_value.sql?raw';
import assetReportable from '../migrations/0021_asset_reportable.sql?raw';
import incomeTreatment from '../migrations/0022_income_treatment.sql?raw';
import incomeSources from '../migrations/0023_income_sources.sql?raw';
import fxRateNote from '../migrations/0024_fx_rate_note.sql?raw';
import expenseTemplates from '../migrations/0025_expense_templates.sql?raw';
import type { Database } from './database';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'ledger', sql: ledger },
  { version: 2, name: 'fx', sql: fx },
  { version: 3, name: 'points', sql: points },
  { version: 4, name: 'increment_rounding', sql: incrementRounding },
  { version: 5, name: 'catalog', sql: catalog },
  { version: 6, name: 'mcc_points', sql: mccPoints },
  { version: 7, name: 'assets', sql: assets },
  { version: 8, name: 'goals', sql: goals },
  { version: 9, name: 'buy_flow', sql: buyFlow },
  { version: 10, name: 'debts', sql: debts },
  { version: 11, name: 'loans', sql: loans },
  { version: 12, name: 'tax_reports', sql: taxReports },
  { version: 13, name: 'coretax_codes', sql: coretaxCodes },
  { version: 14, name: 'utang_codes', sql: utangCodes },
  { version: 15, name: 'budgets', sql: budgetTables },
  { version: 16, name: 'goal_contributions', sql: goalContributionTables },
  { version: 17, name: 'goal_calculators', sql: goalCalculatorTables },
  { version: 18, name: 'point_entries', sql: pointEntryTables },
  { version: 19, name: 'point_entry_system_source', sql: pointEntrySystemSource },
  { version: 20, name: 'point_entry_value', sql: pointEntryValue },
  { version: 21, name: 'asset_reportable', sql: assetReportable },
  { version: 22, name: 'income_treatment', sql: incomeTreatment },
  { version: 23, name: 'income_sources', sql: incomeSources },
  { version: 24, name: 'fx_rate_note', sql: fxRateNote },
  { version: 25, name: 'expense_templates', sql: expenseTemplates },
];

/** Applies pending migrations in order, each atomically. Returns applied versions. */
export async function migrate(database: Database, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  await database.execScript(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const rows = await database.db.values<[number]>(sql`SELECT version FROM schema_migrations`);
  const done = new Set(rows.map((r) => Number(r[0])));
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    const script = `BEGIN IMMEDIATE;\n${m.sql}\nINSERT INTO schema_migrations (version, name, applied_at) VALUES (${m.version}, '${m.name}', '${new Date().toISOString()}');\nCOMMIT;`;
    try {
      await database.execScript(script);
    } catch (error) {
      await database.execScript('ROLLBACK').catch(() => undefined);
      throw error;
    }
    applied.push(m.version);
  }
  return applied;
}
