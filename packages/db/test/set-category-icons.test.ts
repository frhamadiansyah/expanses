import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ensureDefaultCategorySets, retireDefaultSetCategories } from '../src/index';
import { setupDb } from './helpers';

const iconsOf = async (database: Awaited<ReturnType<typeof setupDb>>['database'], names: string[]) =>
  Object.fromEntries(
    await database.db.values<[string, string | null]>(
      sql`SELECT name, icon FROM accounts WHERE id IN (SELECT category_account_id FROM category_set_members) AND name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`,
    ),
  );

describe('the default sets’ category icons', () => {
  it('are given when the sets are made', async () => {
    const { database, ws } = await setupDb();
    await ensureDefaultCategorySets(database, ws);
    expect(await iconsOf(database, ['Flights', 'Diapering', 'Lighting & Sockets'])).toEqual({ Flights: 'plane', Diapering: 'baby', 'Lighting & Sockets': 'lightbulb' });
  });

  it('migration 0077 gives them to sets made before, and leaves an icon already chosen', async () => {
    const { database, ws } = await setupDb();
    await ensureDefaultCategorySets(database, ws);
    // As a set made before 0077 had them: no icon on any, except one the owner chose.
    await database.db.run(sql`UPDATE accounts SET icon = NULL WHERE id IN (SELECT category_account_id FROM category_set_members)`);
    await database.db.run(sql`UPDATE accounts SET icon = 'tent' WHERE name = 'Lodging'`);
    // A monthly category with a set category's name stays as it is: it belongs to no set.
    await database.db.run(sql`INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
      VALUES ('own-photo', ${ws.workspaceId}, NULL, 'expense', 'category', 'Photo', NULL, NULL, 'derived', NULL, 99, NULL, '2026-01-01')`);
    const migration = readFileSync(new URL('../migrations/0077_set_category_icons.sql', import.meta.url), 'utf8');
    await database.db.run(sql.raw(migration));
    expect(await iconsOf(database, ['Flights', 'Lodging', 'Photo', 'Vaccination'])).toEqual({ Flights: 'plane', Lodging: 'tent', Photo: 'camera', Vaccination: 'syringe' });
    const own = await database.db.values<[string | null]>(sql`SELECT icon FROM accounts WHERE id = 'own-photo'`);
    expect(own[0]![0]).toBeNull();
  });
});

describe('a retired default set category', () => {
  const holidayWithBusinessH = async () => {
    const { database, ws } = await setupDb();
    await ensureDefaultCategorySets(database, ws);
    // As a Holiday set made before Business H left the defaults had it.
    const setId = (await database.db.values<[string]>(sql`SELECT id FROM category_sets WHERE name = 'Holiday'`))[0]![0];
    await database.db.run(sql`INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
      VALUES ('business-h', ${ws.workspaceId}, NULL, 'expense', 'category', 'Business H', NULL, NULL, 'derived', NULL, 8, NULL, '2026-01-01')`);
    await database.db.run(sql`INSERT INTO category_set_members (category_account_id, workspace_id, set_id) VALUES ('business-h', ${ws.workspaceId}, ${setId})`);
    return { database, ws };
  };
  const stillThere = async (database: Awaited<ReturnType<typeof setupDb>>['database']) =>
    (await database.db.values<[number]>(sql`SELECT count(*) FROM accounts WHERE id = 'business-h'`))[0]![0] === 1;

  it('is no longer made for a new workspace', async () => {
    const { database, ws } = await setupDb();
    await ensureDefaultCategorySets(database, ws);
    expect(await iconsOf(database, ['Business H'])).toEqual({});
  });

  it('is removed on open where nothing uses it', async () => {
    const { database, ws } = await holidayWithBusinessH();
    expect(await retireDefaultSetCategories(database, ws)).toBe(1);
    expect(await stillThere(database)).toBe(false);
    expect(await retireDefaultSetCategories(database, ws)).toBe(0);
  });

  it('stays where something uses it', async () => {
    const { database, ws } = await holidayWithBusinessH();
    await database.db.run(sql`INSERT INTO budgets (id, workspace_id, category_account_id, amount_minor, created_at, updated_at) VALUES ('b1', ${ws.workspaceId}, 'business-h', 100000, '2026-01-01', '2026-01-01')`);
    expect(await retireDefaultSetCategories(database, ws)).toBe(0);
    expect(await stillThere(database)).toBe(true);
  });
});
