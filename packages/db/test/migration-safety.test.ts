import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  databaseVersion,
  futureVersions,
  LATEST_VERSION,
  migrate,
  MIGRATIONS,
  pendingMigrations,
  type Migration,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const fresh = () => {
  executor = createNodeExecutor();
  return createDatabase(executor);
};

describe('versions', () => {
  it('answers 0 for a database that has never been migrated', async () => {
    expect(await databaseVersion(fresh())).toBe(0);
  });

  it('answers the highest applied version, and knows the build’s own', async () => {
    const database = fresh();
    await migrate(database);
    expect(LATEST_VERSION).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
    expect(await databaseVersion(database)).toBe(LATEST_VERSION);
    expect(await futureVersions(database)).toEqual([]);
    expect(await pendingMigrations(database)).toEqual([]);
  });

  it('names the versions a newer build wrote', async () => {
    const database = fresh();
    await migrate(database);
    await database.execScript(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (${LATEST_VERSION + 1}, 'from_the_future', '2027-01-01T00:00:00.000Z')`,
    );
    expect(await futureVersions(database)).toEqual([LATEST_VERSION + 1]);
    expect(await databaseVersion(database)).toBe(LATEST_VERSION + 1);
  });

  it('lists what is still to do on a half-migrated database', async () => {
    const database = fresh();
    await migrate(
      database,
      MIGRATIONS.filter((m) => m.version <= 44),
    );
    expect((await pendingMigrations(database)).map((m) => m.version)).toEqual(
      MIGRATIONS.filter((m) => m.version > 44).map((m) => m.version),
    );
  });
});

/**
 * The shape that makes a closed tab mid-update safe.
 *
 * `migrate` wraps each migration as its own `BEGIN IMMEDIATE … COMMIT` with that migration's row in
 * `schema_migrations` committed inside the same transaction. That — and only that — is why an interrupted
 * update is not a disaster: the rollback machinery in `open.ts` fires on a *thrown* migration, never on a
 * power cut or a closed tab, so an interruption is survived by the next launch simply resuming. A migration
 * that opened a transaction of its own, or wrote version rows itself, or covered two versions in one file,
 * would take that guarantee away silently, and nothing in the repo would fail.
 */
describe('the shape every migration must keep', () => {
  /** Comments are prose, not SQL: a migration may say the word BEGIN without opening a transaction. */
  const statementsOnly = (sql: string): string => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

  const opensItsOwnTransaction = (sql: string): boolean => /\b(BEGIN|COMMIT|END\s+TRANSACTION|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(statementsOnly(sql));
  const writesVersionRows = (sql: string): boolean => /\bschema_migrations\b/i.test(statementsOnly(sql));

  it('opens no transaction of its own', () => {
    expect(MIGRATIONS.filter((m) => opensItsOwnTransaction(m.sql)).map((m) => `${m.version} ${m.name}`)).toEqual([]);
  });

  it('writes no version row itself, so one migration is one version', () => {
    expect(MIGRATIONS.filter((m) => writesVersionRows(m.sql)).map((m) => `${m.version} ${m.name}`)).toEqual([]);
  });

  it('numbers each version once, in order', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it('records exactly one row per migration it applies', async () => {
    const database = fresh();
    const three = MIGRATIONS.filter((m) => m.version <= 3);
    await migrate(database, three);
    const rows = await database.db.values<[number, string]>(sql`SELECT version, name FROM schema_migrations ORDER BY version`);
    expect(rows.map((r) => [Number(r[0]), String(r[1])])).toEqual(three.map((m) => [m.version, m.name]));
  });

  it('would catch a migration that broke the rule', () => {
    // The guard has to bite, or it is decoration. Red on the shapes that matter:
    expect(opensItsOwnTransaction('BEGIN IMMEDIATE;\nCREATE TABLE x (a TEXT);\nCOMMIT;')).toBe(true);
    expect(opensItsOwnTransaction('SAVEPOINT half_way;')).toBe(true);
    expect(writesVersionRows("INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'two_at_once', '')")).toBe(true);
    // And green on prose that merely mentions them, so it does not cost anyone a comment.
    expect(opensItsOwnTransaction('-- no BEGIN and no COMMIT below this line\nCREATE TABLE x (a TEXT);')).toBe(false);
    expect(writesVersionRows('/* nothing here touches schema_migrations */\nCREATE TABLE x (a TEXT);')).toBe(false);
  });
});

describe('migrate', () => {
  it('reports each step as it starts it, and once when it is done', async () => {
    const database = fresh();
    const steps: [number, number, string][] = [];
    await migrate(
      database,
      MIGRATIONS.filter((m) => m.version <= 3),
      { onProgress: (done, total, name) => steps.push([done, total, name]) },
    );
    expect(steps).toEqual([
      [0, 3, 'ledger'],
      [1, 3, 'fx'],
      [2, 3, 'points'],
      [3, 3, 'points'],
    ]);
  });

  it('leaves the versions that committed, so the next open carries on where it stopped', async () => {
    const database = fresh();
    const boom: Migration = { version: 99, name: 'boom', sql: 'CREATE TABLE boom (x TEXT);\nINSERT INTO nope (x) VALUES (1);' };
    await expect(migrate(database, [...MIGRATIONS.filter((m) => m.version <= 3), boom])).rejects.toThrow();
    expect(await databaseVersion(database)).toBe(3);
    // The failed migration's own table rolled back with it.
    expect(await database.db.values(sql`SELECT name FROM sqlite_master WHERE name = 'boom'`)).toEqual([]);
    // And the run resumes from 4 with no repair.
    expect(await migrate(database)).toEqual(MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version));
  });
});
