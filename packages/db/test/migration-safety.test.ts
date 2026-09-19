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
