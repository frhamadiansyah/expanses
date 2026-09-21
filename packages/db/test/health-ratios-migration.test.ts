import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, healthTablesExist, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const TABLES = ['category_needs', 'budget_frequencies', 'goal_stage_terms', 'calculator_inputs'];

describe('migration 0053', () => {
  it('is version 53 and named health_ratios', () => {
    expect(MIGRATIONS.find((m) => m.version === 53)).toMatchObject({ name: 'health_ratios' });
  });

  it('adds four empty tables to a database stopped at 49, and the guard only says so afterwards', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    // A "no" is not remembered: migrate may still run on this same handle.
    expect(await healthTablesExist(database.db)).toBe(false);
    for (const table of TABLES) {
      const rows = await database.db.values<[number]>(sql.raw(`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '${table}'`));
      expect(Number(rows[0]![0])).toBe(0);
    }

    expect(await migrate(database)).toContain(53);
    expect(await healthTablesExist(database.db)).toBe(true);
    for (const table of TABLES) {
      const rows = await database.db.values<[number]>(sql.raw(`SELECT count(*) FROM ${table}`));
      expect(Number(rows[0]![0])).toBe(0);
    }
  });

  it('refuses a mark that is neither essential nor lifestyle', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    await expect(
      database.execScript(`INSERT INTO category_needs (category_account_id, workspace_id, need) VALUES ('c', 'w', 'luxury')`),
    ).rejects.toThrow();
  });

  it('has no row for monthly: monthly is the absence of a row', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    await expect(
      database.execScript(`INSERT INTO budget_frequencies (budget_id, workspace_id, frequency, amount_as_set_minor) VALUES ('b', 'w', 'monthly', 100)`),
    ).rejects.toThrow();
    await expect(
      database.execScript(`INSERT INTO budget_frequencies (budget_id, workspace_id, frequency, amount_as_set_minor) VALUES ('b', 'w', 'weekly', 0)`),
    ).rejects.toThrow();
  });

  it('remembers one set of calculator inputs per workspace and kind', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const insert = (ws: string, kind: string) =>
      database.execScript(`INSERT INTO calculator_inputs (workspace_id, kind, inputs_json, updated_at) VALUES ('${ws}', '${kind}', '{}', '2026-09-21')`);
    await insert('w', 'life_cover');
    await insert('other', 'life_cover');
    await expect(insert('w', 'life_cover')).rejects.toThrow();
    await expect(insert('w', '')).rejects.toThrow();
    await expect(
      database.execScript(`INSERT INTO calculator_inputs (workspace_id, kind, inputs_json, updated_at) VALUES ('w', 'x', 'not json', '2026-09-21')`),
    ).rejects.toThrow();
  });

  it('refuses a negative return on a goal stage term', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    await expect(
      database.execScript(`INSERT INTO goal_stage_terms (stage_id, workspace_id, goal_id, return_bps) VALUES ('s', 'w', 'g', -1)`),
    ).rejects.toThrow();
    // A null return (the goal's own, not derived) is still allowed.
    await expect(
      database.execScript(`INSERT INTO goal_stage_terms (stage_id, workspace_id, goal_id, return_bps) VALUES ('s2', 'w', 'g', NULL)`),
    ).resolves.not.toThrow();
  });

  it('refuses a calculator inputs row with no updated_at', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    await expect(
      database.execScript(`INSERT INTO calculator_inputs (workspace_id, kind, inputs_json, updated_at) VALUES ('w', 'life_cover', '{}', NULL)`),
    ).rejects.toThrow();
  });
});
