import { type SQL, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  deleteGoal,
  GoalDbError,
  goalContributionsFor,
  goalShareOf,
  goalSharesOf,
  leaveSharedGoal,
  listEarmarks,
  listGoals,
  markGoalDeletedTx,
  personalBook,
  privateCopyOf,
  saveEarmark,
  saveGoal,
  shareGoal,
  stopSharingGoal,
  type Database,
} from '../../src/index';
import { withCapture } from '../../src/sync/capture';
import { ownGoalFunding } from '../../src/sync/goals/summaries';
import { localDate } from '../../src/sync/net-worth/summaries';
import { Household, skipsOf, type Device } from './household';
import { clearOutbox, outboxOps } from './sync-helpers';

/*
 * Share, off, delete, Leave and the end of a household share (shared goals §8.2, §8.3, C13–C15, C30, D7, D10), on two
 * phones over one relay. Bima shares 'Trip Fund'; Rina puts money of her own toward it. Whoever stops counting keeps a
 * private copy with their own money; the sharer keeps the goal itself.
 */

const today = () => localDate(Date.now());

/** Every row of a table, by column name. */
async function rowsOf(database: Database, table: string, where: SQL = sql`1 = 1`): Promise<Record<string, unknown>[]> {
  const columns = (await database.db.values<[string]>(sql`SELECT name FROM pragma_table_info(${table})`)).map((row) => row[0]);
  const rows = await database.db.values<unknown[]>(sql`SELECT ${sql.raw(columns.join(', '))} FROM ${sql.raw(table)} WHERE ${where}`);
  return rows.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

async function rowOf(database: Database, table: string, goalId: string, memberId: string): Promise<Record<string, unknown>> {
  const [row] = await rowsOf(database, table, sql`goal_id = ${goalId} AND member_id = ${memberId}`);
  return row!;
}

const logOf = (database: Database, goalId: string) => rowsOf(database, 'goal_share_log', sql`goal_id = ${goalId} ORDER BY occurred_on, id`);

/**
 * Rina's line goes out as her phone works it out. Until money changes send it by themselves (Task 9), the test writes
 * it under capture, as that send will.
 */
async function sendLine(device: Device, goalId: string): Promise<void> {
  const funding = await ownGoalFunding(device.database, device.ws, goalId, today());
  await device.database.transaction((tx) =>
    withCapture(tx, { entity: 'goal_member_funding', id: `${goalId}|${device.memberId}` }, () =>
      tx.run(sql`
        INSERT INTO goal_member_funding (goal_id, member_id, workspace_id, lines_json, planned_monthly_minor, as_of)
        VALUES (${goalId}, ${device.memberId}, ${device.ws.workspaceId}, ${JSON.stringify(funding.lines)}, ${funding.plannedMonthlyMinor}, ${today()})
        ON CONFLICT (goal_id, member_id) DO UPDATE SET lines_json = excluded.lines_json, planned_monthly_minor = excluded.planned_monthly_minor, as_of = excluded.as_of`),
    ),
  );
}

/** A rename of the shared goal, as Edit goal will send it once goal writes are captured (Task 10). */
async function rename(device: Device, goalId: string, name: string): Promise<void> {
  await device.database.transaction((tx) => withCapture(tx, { entity: 'goal', id: goalId }, () => tx.run(sql`UPDATE goals SET name = ${name} WHERE id = ${goalId}`)));
}

/** Bima's household with Rina, both on 0.5.0; Bima's goal 'Trip Fund', not shared yet. */
async function world(options: { tablet?: boolean; rinaTablet?: boolean } = {}) {
  const h = new Household();
  const bima = await h.device('Bima', 'member-Bima', 'IDR', '0.5.0');
  const rina = await h.device('Rina', 'member-Rina', 'IDR', '0.5.0');
  const rinaSavings = (
    await createAccount(rina.database, rina.ws, { name: 'Partner Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-01-01' })
  ).id;
  const bookId = await h.share(bima);
  await h.join(rina, bima);
  const tablet = options.tablet ? await h.device('BimaTablet', 'member-Bima', 'IDR', '0.5.0') : undefined;
  if (tablet) {
    // Bima's second device joins as Bima (S§8.3).
    const { code } = await bima.engine.createInvite(bookId, { inviterName: 'Bima', sameMember: true, memberId: bima.memberId });
    await tablet.engine.joinBook(code, { ws: tablet.ws, memberName: 'Bima', deviceName: "Bima's tablet", memberId: bima.memberId });
  }
  const rinaTablet = options.rinaTablet ? await h.device('RinaTablet', 'member-Rina', 'IDR', '0.5.0') : undefined;
  if (rinaTablet) {
    const { code } = await bima.engine.createInvite(bookId, { inviterName: 'Bima', sameMember: true, memberId: rina.memberId });
    await rinaTablet.engine.joinBook(code, { ws: rinaTablet.ws, memberName: 'Rina', deviceName: "Rina's tablet", memberId: rina.memberId });
  }
  await h.settle();
  const goalId = await saveGoal(bima.database, bima.ws, {
    name: 'Trip Fund',
    kind: 'holiday',
    growthBps: 0,
    returnBps: 0,
    stages: [{ name: 'Trip', targetMinor: 180_000_000, targetMonths: null, dueOn: '2030-06-01' }],
  });
  return { h, bima, rina, tablet, rinaTablet, rinaSavings, bookId, goalId };
}

/** The world with the goal shared and Rina's 10_000_000 set aside from Partner Savings, her line on every phone. */
async function shared(options: { tablet?: boolean; rinaTablet?: boolean } = {}) {
  const w = await world(options);
  await shareGoal(w.bima.database, w.bima.ws, w.goalId, w.bookId);
  await w.h.settle();
  await saveEarmark(w.rina.database, w.rina.ws, { goalId: w.goalId, accountId: w.rinaSavings, amountMinor: 10_000_000 });
  await sendLine(w.rina, w.goalId);
  await w.h.settle();
  return w;
}

/** Clock rows (field and kept) of the goal's own rows naming any of `ids` (the link's are the link's). */
async function clocksNaming(database: Database, ids: readonly string[]): Promise<number> {
  let count = 0;
  for (const table of ['sync_field_clocks', 'sync_kept_clocks']) {
    for (const id of ids) {
      const [row] = await database.db.values<[number]>(sql`SELECT count(*) FROM ${sql.raw(table)} WHERE entity NOT IN ('goal_share', 'goal_share_leave') AND (id = ${id} OR substr(id, 1, ${id.length + 1}) = ${`${id}|`})`);
      count += Number(row![0]);
    }
  }
  return count;
}

describe('sharing a goal', () => {
  it('shared: Rina sees one goal, Bima sees her line', async () => {
    const { bima, rina, goalId, bookId } = await shared();
    expect((await listGoals(rina.database, rina.ws)).map((g) => [g.id, g.name])).toEqual([[goalId, 'Trip Fund']]);
    expect(JSON.parse(String((await rowOf(bima.database, 'goal_member_funding', goalId, 'member-Rina')).lines_json))).toEqual([
      expect.objectContaining({ name: 'Partner Savings', amountMinor: 10_000_000 }),
    ]);
    expect(await goalShareOf(rina.database, goalId)).toEqual({
      goalId,
      bookId,
      bookName: 'Personal',
      sharedBy: 'member-Bima',
      sharedByName: 'Bima',
      state: 'on',
      round: 1,
      me: 'member-Rina',
      isSharer: false,
      members: [
        { memberId: 'member-Bima', name: 'Bima' },
        { memberId: 'member-Rina', name: 'Rina' },
      ],
      left: [],
    });
    expect(Object.keys(await goalSharesOf(bima.database))).toEqual([goalId]);
    expect((await goalSharesOf(bima.database))[goalId]!.isSharer).toBe(true);
    expect(await logOf(bima.database, goalId)).toEqual([expect.objectContaining({ kind: 'shared', member_name: 'Rina', amount_minor: null })]);
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);
  });

  it('sends the link first, then the goal, its stage, and nothing of Rina', async () => {
    const { h, bima, goalId, bookId } = await world();
    await h.settle();
    await clearOutbox(bima.database);
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    expect((await outboxOps(bima.database)).map((op) => [op.entity, op.op])).toEqual([
      ['goal_share', 'upsert'],
      ['goal', 'upsert'],
      ['goal_stage', 'upsert'],
    ]);
    // Shared already: a second switch-on changes nothing and sends nothing.
    await clearOutbox(bima.database);
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    expect(await outboxOps(bima.database)).toEqual([]);
  });

  it('refused into a workspace that is no target', async () => {
    const { bima, goalId } = await world();
    await expect(shareGoal(bima.database, bima.ws, goalId, 'no-such-book')).rejects.toThrow(GoalDbError);
    expect(await goalShareOf(bima.database, goalId)).toBeNull();
  });
});

describe('turning it off', () => {
  it('off: Bima keeps the goal, Rina keeps a private copy with her money', async () => {
    const { h, bima, rina, rinaSavings, goalId } = await shared();
    const [[stageId]] = (await bima.database.db.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${goalId}`)) as [[string]];
    await stopSharingGoal(bima.database, bima.ws, goalId);
    await h.settle();
    expect((await listGoals(bima.database, bima.ws)).map((g) => g.id)).toEqual([goalId]);
    expect(await rowsOf(bima.database, 'goal_member_funding')).toEqual([]);
    const [copy] = await listGoals(rina.database, rina.ws);
    expect(copy!.id).not.toBe(goalId);
    expect(copy!.name).toBe('Trip Fund');
    expect(await listEarmarks(rina.database, rina.ws)).toEqual([{ goalId: copy!.id, accountId: rinaSavings, amountMinor: 10_000_000 }]);
    expect((await goalContributionsFor(rina.database, rina.ws, today().slice(0, 7)))[copy!.id]).toBe(10_000_000);
    expect(await privateCopyOf(rina.database, goalId)).toBe(copy!.id);
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);

    // History on each phone: Bima's goal says it stopped; Rina's copy says whose it was.
    expect(await logOf(bima.database, goalId)).toEqual([
      expect.objectContaining({ kind: 'shared', member_name: 'Rina' }),
      expect.objectContaining({ kind: 'stopped', member_name: 'Rina', amount_minor: null }),
    ]);
    expect(await logOf(rina.database, copy!.id)).toEqual([expect.objectContaining({ kind: 'unshared', member_name: 'Bima', copied_from: goalId })]);
    expect((await goalShareOf(bima.database, goalId))!.state).toBe('off');
    expect(await goalSharesOf(bima.database)).toEqual({});

    // Carried (c): no clock on either phone still names the shared goal or its stage, so nothing stale comes back.
    expect(await clocksNaming(rina.database, [goalId, stageId])).toBe(0);
    expect(await clocksNaming(bima.database, [goalId, stageId])).toBe(0);
  });

  it('off and on while Rina is offline', async () => {
    const { h, bima, rina, goalId, bookId } = await shared();
    // Carried (a): Bima's phone holds Rina's line when it turns sharing on again; that must not be his to send.
    await stopSharingGoal(bima.database, bima.ws, goalId);
    expect(await rowsOf(bima.database, 'goal_member_funding')).toEqual([]);
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    expect((await goalShareOf(bima.database, goalId))!.round).toBe(2);
    await h.settle();
    const goals = await listGoals(rina.database, rina.ws);
    expect(goals.map((g) => g.name)).toEqual(['Trip Fund', 'Trip Fund']);
    expect(new Set(goals.map((g) => g.id)).has(goalId)).toBe(true);
    expect((await listEarmarks(rina.database, rina.ws)).map((e) => e.goalId)).not.toContain(goalId);
    expect((await goalShareOf(rina.database, goalId))!).toMatchObject({ state: 'on', round: 2, left: [] });
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);
  });

  it('on again with Rina online: her copy stays, the shared goal comes back beside it with none of her money', async () => {
    const { h, bima, rina, goalId, bookId } = await shared();
    await stopSharingGoal(bima.database, bima.ws, goalId);
    await h.settle();
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    const goals = await listGoals(rina.database, rina.ws);
    expect(goals).toHaveLength(2);
    const copyId = goals.find((g) => g.id !== goalId)!.id;
    expect(await listEarmarks(rina.database, rina.ws)).toEqual([expect.objectContaining({ goalId: copyId, amountMinor: 10_000_000 })]);
    expect(await rowsOf(bima.database, 'goal_member_funding')).toEqual([]);
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);
  });
});

describe('leaving', () => {
  it('Rina leaves: still shared for Bima, her line gone, a History line with her total', async () => {
    const { h, bima, rina, rinaSavings, goalId, bookId } = await shared();
    const { copyGoalId } = await leaveSharedGoal(rina.database, rina.ws, goalId);
    await h.settle();
    expect((await goalShareOf(bima.database, goalId))!.state).toBe('on');
    expect((await goalShareOf(bima.database, goalId))!.left).toEqual(['member-Rina']);
    expect(await rowsOf(bima.database, 'goal_member_funding')).toEqual([]);
    expect(await logOf(bima.database, goalId)).toEqual([
      expect.objectContaining({ kind: 'shared', member_name: 'Rina' }),
      expect.objectContaining({ kind: 'left', member_name: 'Rina', amount_minor: 10_000_000 }),
    ]);
    // Rina's phone: a private copy with her money, the shared goal gone from her list.
    expect((await listGoals(rina.database, rina.ws)).map((g) => g.id)).toEqual([copyGoalId]);
    expect(await listEarmarks(rina.database, rina.ws)).toEqual([{ goalId: copyGoalId, accountId: rinaSavings, amountMinor: 10_000_000 }]);
    expect(await privateCopyOf(rina.database, goalId)).toBe(copyGoalId);
    // Bima renames the shared goal; Rina's copy keeps its own name
    await rename(bima, goalId, 'Coast Trip');
    await h.settle();
    expect((await listGoals(rina.database, rina.ws))[0]!.name).toBe('Trip Fund');
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);

    // Off and on again brings Rina back in: a new round, the goal beside her copy.
    await stopSharingGoal(bima.database, bima.ws, goalId);
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    expect((await listGoals(rina.database, rina.ws)).map((g) => g.name).sort()).toEqual(['Coast Trip', 'Trip Fund']);
    expect((await goalShareOf(rina.database, goalId))!).toMatchObject({ round: 2, left: [] });
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);
  });

  it("Rina's tablet follows her leave with a copy of its own; Bima's phone counts her total once", async () => {
    const { h, bima, rina, rinaTablet, goalId } = await shared({ rinaTablet: true });
    expect((await listGoals(rinaTablet!.database, rinaTablet!.ws)).map((g) => g.id)).toEqual([goalId]);
    await leaveSharedGoal(rina.database, rina.ws, goalId);
    await h.settle();
    const [copy] = await listGoals(rinaTablet!.database, rinaTablet!.ws);
    expect(copy!.id).not.toBe(goalId);
    expect(await logOf(rinaTablet!.database, copy!.id)).toEqual([expect.objectContaining({ kind: 'unshared', member_name: 'Bima', copied_from: goalId })]);
    expect(await rowsOf(rinaTablet!.database, 'goal_member_funding')).toEqual([]);
    expect((await logOf(bima.database, goalId)).filter((line) => line.kind === 'left')).toEqual([expect.objectContaining({ member_name: 'Rina', amount_minor: 10_000_000 })]);
    for (const d of [bima, rina, rinaTablet!]) expect(await skipsOf(d.database)).toEqual([]);
  });

  it('only the sharer turns it off, only another member leaves', async () => {
    const { bima, rina, goalId } = await shared();
    await expect(stopSharingGoal(rina.database, rina.ws, goalId)).rejects.toThrow(GoalDbError);
    await expect(stopSharingGoal(rina.database, rina.ws, goalId)).rejects.toThrow('Only Bima can stop sharing this goal');
    await expect(leaveSharedGoal(bima.database, bima.ws, goalId)).rejects.toThrow(GoalDbError);
    await expect(leaveSharedGoal(bima.database, bima.ws, goalId)).rejects.toThrow('Bima shared this goal, so it is turned off rather than left');
    expect((await goalShareOf(bima.database, goalId))!.state).toBe('on');
  });
});

describe('deleting', () => {
  it('Bima deletes it: Rina keeps a copy, and Bima’s tablet deletes it too', async () => {
    const { h, bima, rina, tablet, rinaSavings, goalId } = await shared({ tablet: true });
    expect((await listGoals(tablet!.database, tablet!.ws)).map((g) => g.id)).toEqual([goalId]);
    await clearOutbox(bima.database);
    expect(await bima.database.transaction((tx) => markGoalDeletedTx(tx, goalId))).toBe(true);
    await deleteGoal(bima.database, bima.ws, goalId);
    expect((await outboxOps(bima.database)).map((op) => [op.entity, op.op])).toEqual([['goal_share', 'upsert']]);
    await h.settle();
    expect(await listGoals(bima.database, bima.ws)).toEqual([]);
    expect(await rowsOf(bima.database, 'goal_member_funding')).toEqual([]);
    expect(await listGoals(tablet!.database, tablet!.ws)).toEqual([]);
    expect(await rowsOf(tablet!.database, 'goal_member_funding')).toEqual([]);
    const [copy] = await listGoals(rina.database, rina.ws);
    expect(copy!.id).not.toBe(goalId);
    expect(await listEarmarks(rina.database, rina.ws)).toEqual([{ goalId: copy!.id, accountId: rinaSavings, amountMinor: 10_000_000 }]);
    expect((await goalShareOf(rina.database, goalId))!.state).toBe('deleted');
    for (const d of [bima, rina, tablet!]) expect(await skipsOf(d.database)).toEqual([]);
  });

  it('a goal never shared is no shared delete', async () => {
    const { bima, goalId } = await world();
    expect(await bima.database.transaction((tx) => markGoalDeletedTx(tx, goalId))).toBe(false);
  });
});

describe('the household share ends (C15)', () => {
  it('Bima stops sharing the workspace: both keep private goals', async () => {
    const { h, bima, rina, rinaSavings, goalId } = await shared();
    await bima.engine.stopSharing(h.bookId);
    await h.settle([rina]);
    expect((await listGoals(bima.database, bima.ws)).map((g) => g.id)).toEqual([goalId]);
    const [copy] = await listGoals(rina.database, rina.ws);
    expect(copy!.id).not.toBe(goalId);
    await expect(saveEarmark(rina.database, rina.ws, { goalId: copy!.id, accountId: rinaSavings, amountMinor: 11_000_000 })).resolves.toBeUndefined();
    expect(await logOf(rina.database, copy!.id)).toEqual([expect.objectContaining({ kind: 'ended', member_name: 'Bima', copied_from: goalId })]);
    expect(await logOf(bima.database, goalId)).toEqual([expect.objectContaining({ kind: 'shared' }), expect.objectContaining({ kind: 'ended', member_name: 'Rina' })]);
    // Nothing of the share is left to send or to judge by: no link, no leave, no partner line on either phone.
    for (const d of [bima, rina]) {
      for (const table of ['goal_shares', 'goal_share_leaves', 'goal_member_funding', 'goal_member_moves']) expect(await rowsOf(d.database, table)).toEqual([]);
    }
  });

  it('a stopped workspace shared again carries no goal of the old share, and the switch starts a new one', async () => {
    const { h, bima, rina, goalId } = await shared();
    await bima.engine.stopSharing(h.bookId);
    await h.settle([rina]);
    await rina.engine.forgetSharing(h.bookId);
    // Carried (b): the seed sends only what Bima may write.
    const again = await bima.engine.shareBook(h.bookId, { memberName: 'Bima', deviceName: "Bima's phone" });
    h.relayBookId = again.relayBookId;
    expect((await outboxOps(bima.database)).filter((op) => op.entity.startsWith('goal'))).toEqual([]);
    await bima.engine.syncOnce(h.bookId);
    const { code } = await bima.engine.createInvite(h.bookId, { inviterName: 'Bima', sameMember: true, memberId: rina.memberId });
    await rina.engine.joinBook(code, { ws: rina.ws, memberName: 'Rina', deviceName: "Rina's phone" });
    await h.settle();
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);
    expect(await listGoals(rina.database, rina.ws)).toHaveLength(1);
    expect(await goalShareOf(bima.database, goalId)).toBeNull();

    await shareGoal(bima.database, bima.ws, goalId, h.bookId);
    await h.settle();
    expect((await goalShareOf(rina.database, goalId))!).toMatchObject({ state: 'on', round: 1, isSharer: false });
    expect((await listGoals(rina.database, rina.ws)).map((g) => g.id)).toContain(goalId);
    expect(await listGoals(rina.database, rina.ws)).toHaveLength(2);
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await skipsOf(bima.database)).toEqual([]);
  });
});

describe('seeding a workspace with goal rows in it (carried b)', () => {
  it('sends only the links, leaves, lines and moves this member may write', async () => {
    const h = new Household();
    const bima = await h.device('Bima', 'member-Bima', 'IDR', '0.5.0');
    const bookId = (await personalBook(bima.database, bima.ws)).id;
    const goal = (name: string) => saveGoal(bima.database, bima.ws, { name, kind: 'holiday', growthBps: 0, returnBps: 0, stages: [{ name: 'Trip', targetMinor: 2_340_000, targetMonths: null, dueOn: '2031-02-01' }] });
    const own = await goal('Coast Trip');
    const theirs = await goal('Lake Trip');
    const ownOff = await goal('Hill Trip');
    const w = bima.ws.workspaceId;
    await bima.database.execScript(`
      INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES
        ('${own}', '${bookId}', '${w}', 'member-Bima', 'on', '2030-02-01', 1),
        ('${theirs}', '${bookId}', '${w}', 'member-Rina', 'on', '2030-02-01', 1),
        ('${ownOff}', '${bookId}', '${w}', 'member-Bima', 'off', '2030-02-01', 1);
      INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES ('${own}', 'member-Rina', '${w}', 1, '2030-03-01');
      INSERT INTO goal_member_funding (goal_id, member_id, workspace_id, lines_json, planned_monthly_minor, as_of) VALUES
        ('${own}', 'member-Bima', '${w}', '[]', 0, '2030-03-01'),
        ('${own}', 'member-Rina', '${w}', '[]', 415000, '2030-03-01');
      INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text, stage_id) VALUES
        ('move-r', '${own}', '${w}', 'member-Rina', 'set-aside', '2030-03-01', 415000, 'IDR', 'Lake Account', NULL);
    `);
    await h.share(bima);
    const ops = (await outboxOps(bima.database)).filter((op) => op.entity.startsWith('goal'));
    expect(ops.map((op) => [op.entity, op.id])).toEqual([
      ['goal_share', own],
      ['goal', own],
      ['goal_stage', expect.any(String)],
      ['goal_member_funding', `${own}|member-Bima`],
    ]);
  });
});
