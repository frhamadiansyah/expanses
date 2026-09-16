import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createProgram, createWorkspace, listEarnRules, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor } from '../src/node';

describe('migration 0040', () => {
  it('is version 40 and named cycle_gates', () => {
    expect(MIGRATIONS.find((m) => m.version === 40)).toMatchObject({ name: 'cycle_gates' });
  });

  it('adds the three columns to a database already holding rules, keeping them', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 39));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const card = await createAccount(older, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const program = await createProgram(older, ws, { cardAccountId: card.id, name: 'Points', unit: 'points', cycleAnchor: 'statement' });
    // Written the way a version 39 database held it, naming only the columns that existed then.
    await older.db.values(sql`INSERT INTO earn_rules
      (id, workspace_id, program_id, name, priority, stackable, match_json, rate_num, rate_den, rounding, created_at)
      VALUES ('r1', ${ws.workspaceId}, ${program.id}, 'Base', 0, 0, '{}', 1, 10000, 'per_increment', '2026-09-16T00:00:00.000Z')`);

    const applied = await migrate(older);
    expect(applied).toContain(40);

    const columns = (await older.db.values<unknown[]>(sql.raw('PRAGMA table_info(earn_rules)'))).map((row) => String(row[1]));
    expect(columns).toEqual(expect.arrayContaining(['min_cycle_total_minor', 'min_cycle_purchases', 'min_cycle_purchase_minor']));

    // The rule written before the upgrade survives it, with the new floors empty.
    const [rule] = await listEarnRules(older, ws, program.id);
    expect(rule).toMatchObject({ name: 'Base', minCycleTotalMinor: null, minCyclePurchases: null, minCyclePurchaseMinor: null });
  });
});
