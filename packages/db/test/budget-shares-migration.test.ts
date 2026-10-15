import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { budgetSharesExist } from '../src/index';
import { setupDb } from './helpers';

describe('migration 0069: budget shares', () => {
  it('adds the table, and the guard sees it', async () => {
    const { database } = await setupDb();
    expect(await budgetSharesExist(database.db)).toBe(true);
    const columns = await database.db.values<[string]>(sql`SELECT name FROM pragma_table_info('budget_shares') ORDER BY cid`);
    expect(columns.map(([name]) => name)).toEqual(['budget_id', 'workspace_id', 'basis', 'share_bp']);
  });

  it('refuses a basis it does not know and a share out of range', async () => {
    const { database } = await setupDb();
    await expect(database.db.run(sql`INSERT INTO budget_shares VALUES ('b1', 'w', 'salary', 100)`)).rejects.toThrow();
    await expect(database.db.run(sql`INSERT INTO budget_shares VALUES ('b2', 'w', 'parent', 0)`)).rejects.toThrow();
    await expect(database.db.run(sql`INSERT INTO budget_shares VALUES ('b3', 'w', 'parent', 10001)`)).rejects.toThrow();
    await database.db.run(sql`INSERT INTO budget_shares VALUES ('b4', 'w', 'take-home', 10000)`);
  });
});
