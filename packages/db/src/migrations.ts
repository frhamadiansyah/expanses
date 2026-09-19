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
import eventTables from '../migrations/0026_events.sql?raw';
import categoryRevamp from '../migrations/0027_category_revamp.sql?raw';
import categorySetTables from '../migrations/0028_category_sets.sql?raw';
import eventFinished from '../migrations/0029_event_finished.sql?raw';
import draftTransactionTables from '../migrations/0030_draft_transactions.sql?raw';
import memberLevels from '../migrations/0031_member_levels.sql?raw';
import categoryChoice from '../migrations/0032_category_choice.sql?raw';
import cycleFloor from '../migrations/0033_cycle_floor.sql?raw';
import cardIdentity from '../migrations/0034_card_identity.sql?raw';
import redemptionCaps from '../migrations/0035_redemption_caps.sql?raw';
import transferMinimum from '../migrations/0036_transfer_minimum.sql?raw';
import draftCard from '../migrations/0037_draft_card.sql?raw';
import cardStatements from '../migrations/0038_card_statements.sql?raw';
import jeniusEntryId from '../migrations/0039_jenius_entry_id.sql?raw';
import cycleGates from '../migrations/0040_cycle_gates.sql?raw';
import billSkips from '../migrations/0041_bill_skips.sql?raw';
import books from '../migrations/0042_books.sql?raw';
import categorySystemKeyPerBook from '../migrations/0043_category_system_key_per_book.sql?raw';
import billMonths from '../migrations/0044_bill_months.sql?raw';
import accountTypes from '../migrations/0045_account_types.sql?raw';
import bookIndexes from '../migrations/0046_book_indexes.sql?raw';
import cashEquivalents from '../migrations/0047_cash_equivalents.sql?raw';
// 0048 is left free on purpose: the Add Transaction plan already claims that number.
import eventPlanItems from '../migrations/0049_event_plan_items.sql?raw';
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
  { version: 26, name: 'events', sql: eventTables },
  { version: 27, name: 'category_revamp', sql: categoryRevamp },
  { version: 28, name: 'category_sets', sql: categorySetTables },
  { version: 29, name: 'event_finished', sql: eventFinished },
  { version: 30, name: 'draft_transactions', sql: draftTransactionTables },
  { version: 31, name: 'member_levels', sql: memberLevels },
  { version: 32, name: 'category_choice', sql: categoryChoice },
  { version: 33, name: 'cycle_floor', sql: cycleFloor },
  { version: 34, name: 'card_identity', sql: cardIdentity },
  { version: 35, name: 'redemption_caps', sql: redemptionCaps },
  { version: 36, name: 'transfer_minimum', sql: transferMinimum },
  { version: 37, name: 'draft_card', sql: draftCard },
  { version: 38, name: 'card_statements', sql: cardStatements },
  { version: 39, name: 'jenius_entry_id', sql: jeniusEntryId },
  { version: 40, name: 'cycle_gates', sql: cycleGates },
  { version: 41, name: 'bill_skips', sql: billSkips },
  { version: 42, name: 'books', sql: books },
  { version: 43, name: 'category_system_key_per_book', sql: categorySystemKeyPerBook },
  { version: 44, name: 'bill_months', sql: billMonths },
  { version: 45, name: 'account_types', sql: accountTypes },
  { version: 46, name: 'book_indexes', sql: bookIndexes },
  { version: 47, name: 'cash_equivalents', sql: cashEquivalents },
  { version: 49, name: 'event_plan_items', sql: eventPlanItems },
];

/** The highest version this build of the app knows how to produce. */
export const LATEST_VERSION: number = Math.max(...MIGRATIONS.map((m) => m.version));

/** Versions already recorded in the file. Empty for a database that has never been migrated. */
async function recordedVersions(database: Database): Promise<number[]> {
  const tables = await database.db.values<[string]>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
  );
  if (!tables.length) return [];
  const rows = await database.db.values<[number]>(sql`SELECT version FROM schema_migrations ORDER BY version`);
  return rows.map((r) => Number(r[0]));
}

/** The highest version recorded in the file, or 0. Read before anything runs, so a newer file is never touched. */
export async function databaseVersion(database: Database): Promise<number> {
  const versions = await recordedVersions(database);
  return versions.length ? versions[versions.length - 1]! : 0;
}

/** Versions the file records that this build does not know. Non-empty means: do not run, do not write. */
export async function futureVersions(database: Database, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  const latest = Math.max(...migrations.map((m) => m.version));
  return (await recordedVersions(database)).filter((version) => version > latest);
}

/** What this build would apply next, in order. Used to decide whether a snapshot is needed. */
export async function pendingMigrations(database: Database, migrations: Migration[] = MIGRATIONS): Promise<Migration[]> {
  const done = new Set(await recordedVersions(database));
  return [...migrations].sort((a, b) => a.version - b.version).filter((m) => !done.has(m.version));
}

export interface MigrateOptions {
  /**
   * Called before each migration with (finished so far, total, the name about to run, its version), and
   * once at the end. The version is reported by the migration itself rather than left to be looked up by
   * the count: the list this walks is recomputed here — a version recorded under another name is dropped
   * and put back into it — so a caller that indexed its own list with `done` would name the wrong one,
   * and a caller that blocks a failed update would block a migration that never ran.
   */
  onProgress?: (done: number, total: number, name: string, version: number) => void;
}

/** Applies pending migrations in order, each atomically. Returns applied versions. */
export async function migrate(
  database: Database,
  migrations: Migration[] = MIGRATIONS,
  options: MigrateOptions = {},
): Promise<number[]> {
  await database.execScript(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const rows = await database.db.values<[number, string]>(sql`SELECT version, name FROM schema_migrations`);
  const recorded = new Map(rows.map((r) => [Number(r[0]), String(r[1])]));
  const expected = new Map(migrations.map((m) => [m.version, m.name]));

  /*
   * A version recorded under a different name came from a migration that no longer exists, because a
   * branch renumbered one. Matching on the number alone would skip this build's migration for ever,
   * and the divergence surfaces much later as an opaque failed query against a missing column. The
   * row is dropped so the real migration runs; if its change is somehow already present the attempt
   * fails loudly and rolls back, which is the outcome worth having.
   */
  for (const [version, name] of recorded) {
    if (!expected.has(version) || expected.get(version) === name) continue;
    await database.execScript(`DELETE FROM schema_migrations WHERE version = ${version}`);
    recorded.delete(version);
  }

  const done = new Set(recorded.keys());
  const todo = [...migrations].sort((a, b) => a.version - b.version).filter((m) => !done.has(m.version));
  const applied: number[] = [];
  for (const m of todo) {
    options.onProgress?.(applied.length, todo.length, m.name, m.version);
    const script = `BEGIN IMMEDIATE;\n${m.sql}\nINSERT INTO schema_migrations (version, name, applied_at) VALUES (${m.version}, '${m.name}', '${new Date().toISOString()}');\nCOMMIT;`;
    try {
      await database.execScript(script);
    } catch (error) {
      await database.execScript('ROLLBACK').catch(() => undefined);
      throw error;
    }
    applied.push(m.version);
  }
  // A last call with the finished count, so a watching screen can show the run complete rather than stopping a step short.
  if (todo.length) options.onProgress?.(todo.length, todo.length, todo[todo.length - 1]!.name, todo[todo.length - 1]!.version);
  return applied;
}
