import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  createWorkspace,
  getLifeCoverDraft,
  listGoalCalculators,
  listGoals,
  migrate,
  MIGRATIONS,
  saveLifeCoverDraft,
  upgradeCalculatorGoals,
  type LifeCoverSaved,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const draft: LifeCoverSaved = {
  annualNeed: '120.000.000',
  years: '10',
  inflation: '3,5',
  returnPercent: '5',
  finalExpenses: '',
  inForce: '500.000.000',
  debts: undefined,
  education: '0',
  liquidAssets: undefined,
};

describe('the life-cover figures', () => {
  it('are remembered per workspace as typed, in their own table, and no goal reader ever sees them', async () => {
    const { database, ws } = await setupDb();
    expect(await getLifeCoverDraft(database, ws)).toBeNull();
    await saveLifeCoverDraft(database, ws, draft);
    await saveLifeCoverDraft(database, ws, { ...draft, years: '15' });
    // Untouched prefilled boxes stay untouched (undefined), so they keep following the balance sheet.
    expect(await getLifeCoverDraft(database, ws)).toEqual({ ...draft, years: '15', debts: undefined, liquidAssets: undefined });
    // One row, in calculator_inputs; nothing reaches the goals.
    const rows = await database.db.values<[string, string]>(
      sql`SELECT kind, inputs_json FROM calculator_inputs WHERE workspace_id = ${ws.workspaceId}`,
    );
    expect(rows.map((row) => row[0])).toEqual(['life_cover']);
    expect(JSON.parse(rows[0]![1])).toMatchObject({ version: 1, draft: { years: '15', education: '0' } });
    expect(await listGoalCalculators(database, ws)).toEqual([]);
    expect(await listGoals(database, ws)).toEqual([]);
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
  });

  it('keeps each workspace to its own figures', async () => {
    const { database, ws } = await setupDb();
    const other = await createWorkspace(database, { name: 'Family', type: 'personal', baseCurrency: 'USD' });
    await saveLifeCoverDraft(database, ws, draft);
    expect(await getLifeCoverDraft(database, other)).toBeNull();
    await saveLifeCoverDraft(database, other, { ...draft, annualNeed: '30.000,00' });
    expect((await getLifeCoverDraft(database, ws))?.annualNeed).toBe('120.000.000');
    expect((await getLifeCoverDraft(database, other))?.annualNeed).toBe('30.000,00');
  });

  it('reads a row it cannot make sense of as nothing typed, box by box', async () => {
    const { database, ws } = await setupDb();
    await database.db.run(
      sql`INSERT INTO calculator_inputs (workspace_id, kind, inputs_json, updated_at) VALUES (${ws.workspaceId}, 'life_cover', ${JSON.stringify({ version: 1, draft: { annualNeed: 5, years: '12', debts: null } })}, '2026-09-21')`,
    );
    expect(await getLifeCoverDraft(database, ws)).toEqual({
      annualNeed: '',
      years: '12',
      inflation: '',
      returnPercent: '',
      finalExpenses: '',
      inForce: '',
      debts: undefined,
      education: undefined,
      liquidAssets: undefined,
    });
  });

  it('remembers nothing on a database stopped before 0053, and refuses to write', async () => {
    const executor = createNodeExecutor();
    try {
      const database = createDatabase(executor);
      await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      expect(await getLifeCoverDraft(database, ws)).toBeNull();
      await expect(saveLifeCoverDraft(database, ws, draft)).rejects.toMatchObject({ code: 'NO_TABLES' });
    } finally {
      executor.close();
    }
  });
});
