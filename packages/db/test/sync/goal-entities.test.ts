import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { saveGoal } from '../../src/index';
import { rowsInScopeTx } from '../../src/sync/seed';
import { buildOpId, entityOf, GOAL_FAMILY, NEVER_SYNCED_COLUMNS, type RowEntity } from '../../src/sync/shared-entities';
import { setupDb } from '../helpers';
import type { NodeExecutor } from '../../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function withLinkedGoal() {
  const db = await setupDb();
  executor = db.executor;
  const goalId = await saveGoal(db.database, db.ws, {
    name: 'Trip Fund',
    kind: 'holiday',
    growthBps: 0,
    returnBps: 0,
    stages: [{ name: 'Trip', targetMinor: 180_000_000, targetMonths: null, dueOn: '2030-06-01' }],
  });
  const bookId = 'book-household';
  await db.database.db.run(
    sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES (${goalId}, ${bookId}, ${db.ws.workspaceId}, 'member-bima', 'on', '2030-01-01', 1)`,
  );
  return { ...db, goalId, bookId };
}

const idsIn = async (db: Awaited<ReturnType<typeof withLinkedGoal>>, name: string) => {
  const entity = entityOf(name) as RowEntity;
  const rows = await db.database.db.values<[string]>(sql`SELECT t.id FROM ${sql.raw(entity.table)} t WHERE ${entity.scope(db.bookId)}`);
  return rows.map((r) => r[0]);
};

describe('goal entities', () => {
  it('a goal is in the book only while its link is on', async () => {
    const db = await withLinkedGoal();
    const onIds = await idsIn(db, 'goal');
    await db.database.db.run(sql`UPDATE goal_shares SET state = 'off' WHERE goal_id = ${db.goalId}`);
    const offIds = await idsIn(db, 'goal');
    expect(onIds).toEqual([db.goalId]);
    expect(offIds).toEqual([]);
    expect([...GOAL_FAMILY].sort()).toEqual(['goal', 'goal_calculator', 'goal_member_funding', 'goal_member_move', 'goal_stage', 'goal_stage_term']);
  });

  it('the link itself is in the book in any state', async () => {
    const db = await withLinkedGoal();
    await db.database.db.run(sql`UPDATE goal_shares SET state = 'deleted' WHERE goal_id = ${db.goalId}`);
    expect(await db.database.db.values(sql`SELECT 1 FROM goal_shares t WHERE ${(entityOf('goal_share') as RowEntity).scope(db.bookId)}`)).toHaveLength(1);
  });

  it('a member summary is keyed by goal and member', () => {
    expect(buildOpId(entityOf('goal_member_funding'), { goal_id: 'g1', member_id: 'member-rina' })).toBe('g1|member-rina');
  });

  it("a member summary and a move are their member's alone", () => {
    const funding = entityOf('goal_member_funding') as RowEntity;
    expect(funding.writer!({}, { goal_id: 'g1', member_id: 'member-rina' })).toBe('member-rina');
    const move = entityOf('goal_member_move') as RowEntity;
    expect(move.writer!({ memberId: 'member-rina' }, { id: 'm1' })).toBe('member-rina');
    expect((entityOf('goal_share_leave') as RowEntity).writer!({}, { goal_id: 'g1', member_id: 'member-rina' })).toBe('member-rina');
  });

  it('the seed sends the link before the goal before its stages', async () => {
    const db = await withLinkedGoal();
    const ops = await db.database.transaction((tx) =>
      rowsInScopeTx(tx, { bookId: db.bookId, memberId: 'member-bima', epoch: 1 }, () => true, { record: false, device: false }),
    );
    const order = ops.map((op) => op.entity).filter((e) => e.startsWith('goal'));
    expect(order.slice(0, 3)).toEqual(['goal_share', 'goal', 'goal_stage']);
  });

  it('rank, standing amount and note never travel', () => {
    expect(NEVER_SYNCED_COLUMNS.goals).toEqual(expect.arrayContaining(['rank', 'standing_monthly_minor', 'standing_note']));
  });
});
