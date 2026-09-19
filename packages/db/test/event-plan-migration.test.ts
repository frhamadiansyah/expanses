import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, migrate, MIGRATIONS, saveEvent } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('migration 0049', () => {
  it('is version 49 and named event_plan_items', () => {
    expect(MIGRATIONS.find((m) => m.version === 49)).toMatchObject({ name: 'event_plan_items' });
  });

  it('turns every cap that carried a figure into one item named after its category, and drops the table', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(
      older,
      MIGRATIONS.filter((m) => m.version <= 48),
    );
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const gear = await createAccount(older, ws, { name: 'Baby gear', kind: 'expense', subtype: 'category', currency: null });
    const clothes = await createAccount(older, ws, { name: 'Clothes', kind: 'expense', subtype: 'category', currency: null });
    const eventId = await saveEvent(older, ws, { name: 'Newborn', startsOn: '2026-09-18', endsOn: '2026-09-28' });
    // Written as a version 48 build wrote them: event_budgets is still there, event_items is not.
    await older.db.values(sql`INSERT INTO event_budgets (id, workspace_id, event_id, category_account_id, planned_minor, created_at)
      VALUES ('b1', ${ws.workspaceId}, ${eventId}, ${gear.id}, 26000000, '2026-09-01T00:00:00Z'),
             ('b2', ${ws.workspaceId}, ${eventId}, ${clothes.id}, NULL, '2026-09-02T00:00:00Z')`);

    expect(await migrate(older)).toEqual([49]);

    // One of the thing, at the price the cap named: a cap with no figure was never a plan, so it is dropped.
    expect(
      await older.db.values(
        sql`SELECT id, event_id, name, quantity, unit_price_minor, category_account_id, transaction_id, share_minor, sort_order FROM event_items`,
      ),
    ).toEqual([['b1', eventId, 'Baby gear', 1, 26_000_000, gear.id, null, null, 0]]);
    expect(await older.db.values(sql`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'event_budgets'`)).toEqual([[0]]);
  });
});
