import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LATEST_VERSION } from '../src/migrations';
import { goalSharingTablesExist } from '../src/repos/goal-sharing-tables';
import { setupDb } from './helpers';

/** drizzle wraps the driver error; the CHECK text sits on the cause. */
const refusedByCheck = async (run: Promise<unknown>) => {
  const err = await run.then(() => null, (e: Error & { cause?: Error }) => e);
  expect(`${err?.message} ${err?.cause?.message}`).toMatch(/CHECK/);
};

describe('migration 0109', () => {
  it('is the latest and makes the five tables', async () => {
    const { database } = await setupDb();
    expect(LATEST_VERSION).toBe(109);
    expect(await goalSharingTablesExist(database.db)).toBe(true);
    const names = (await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'goal_share%' OR name LIKE 'goal_member%') ORDER BY name`)).map(([n]) => n);
    expect(names).toEqual(['goal_member_funding', 'goal_member_moves', 'goal_share_leaves', 'goal_share_log', 'goal_shares']);
  });
  it('a link starts at round 1 and has no left state', async () => {
    const { database } = await setupDb();
    await database.db.run(sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on) VALUES ('g1', 'b1', 'w1', 'member-a', 'on', '2026-11-10')`);
    expect(await database.db.values(sql`SELECT round FROM goal_shares`)).toEqual([[1]]);
    await refusedByCheck(database.db.run(sql`UPDATE goal_shares SET state = 'left'`));
  });
  it('a move kind outside the five is refused', async () => {
    const { database } = await setupDb();
    await refusedByCheck(database.db.run(sql`INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text) VALUES ('m1','g1','w1','member-a','bought','2026-11-10',1,'IDR','x')`));
  });
});
