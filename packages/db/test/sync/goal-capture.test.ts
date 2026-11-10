import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, createBook, listGoals, personalBook, saveEarmark, saveGoal } from '../../src/index';
import type { Database } from '../../src/database';
import type { NodeExecutor } from '../../src/node';
import { applyChangeSet } from '../../src/sync/apply';
import { configureCapture, withCapture } from '../../src/sync/capture';
import { goalLinkOfTx, goalOfRowTx, leftWithLinkTx, memberLeftTx } from '../../src/sync/goals/scope';
import { encodeHlc } from '../../src/sync/hlc';
import type { Op } from '../../src/sync/types';
import { setupDb } from '../helpers';
import { Household } from './household';
import { clearOutbox, outboxChangeSets, outboxOps } from './sync-helpers';

/*
 * A shared goal's rows in the household book's log (shared goals §8.3 option b, §8.4, C29): captured whole when the
 * link turns on, judged by one predicate at capture and on apply, and never deleted when they leave with their link.
 * Bima (member-f) shares; Rina (member-r) is the other member.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

/** Marks the Personal book shared here as `member`; the capture run has shared it from birth, as another member. */
async function shareAs(database: Database, bookId: string, member: string): Promise<void> {
  configureCapture(database, { standInDeviceId: true });
  await database.db.run(sql`
    INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${`relay-${bookId}`}, 1, ${member}, 'active', '2030-01-01T00:00:00Z')
    ON CONFLICT (book_id) DO UPDATE SET member_id = excluded.member_id`);
}

const stages = [
  { name: 'Flights', targetMinor: 4_350_000, targetMonths: null, dueOn: '2031-03-01' },
  { name: 'Stay', targetMinor: 6_120_000, targetMonths: null, dueOn: '2031-04-01' },
];

/** This phone, as `me`, with Bima's and Rina's devices in the book's authority view. */
async function household(me: string) {
  const t = await setupDb();
  executor = t.executor;
  const bookId = (await personalBook(t.database, t.ws)).id;
  await shareAs(t.database, bookId, me);
  await t.database.execScript(`
    INSERT INTO sync_authority (book_id, member_id, role, role_hlc, deleted, row_hlc) VALUES ('${bookId}', 'member-f', 'owner', '0', 0, '0'), ('${bookId}', 'member-r', 'member', '0', 0, '0');
    INSERT INTO sync_authority_devices (book_id, device_id, member_id, removed_seq, added_seq) VALUES ('${bookId}', 'dev-f', 'member-f', NULL, 1), ('${bookId}', 'dev-r', 'member-r', NULL, 2);
  `);
  return { ...t, bookId };
}

/** The household with Bima's goal here, not shared yet. */
async function withTripFund(me: string) {
  const t = await household(me);
  const goalId = await saveGoal(t.database, t.ws, { name: 'Trip Fund', kind: 'holiday', growthBps: 0, returnBps: 0, stages });
  return { ...t, goalId };
}

const linkSql = (t: { bookId: string; ws: { workspaceId: string } }, goalId: string, state: string, sharedBy = 'member-f', round = 1) =>
  sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES (${goalId}, ${t.bookId}, ${t.ws.workspaceId}, ${sharedBy}, ${state}, '2030-02-01', ${round})`;

/** A fixture link, written as a test's own SQL (the capture run drops it from its watch). */
async function linkHere(t: { database: Database; bookId: string; ws: { workspaceId: string } }, goalId: string, state: string, sharedBy = 'member-f', round = 1) {
  await t.database.execScript(
    `INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES ('${goalId}', '${t.bookId}', '${t.ws.workspaceId}', '${sharedBy}', '${state}', '2030-02-01', ${round})`,
  );
}

let tick = 0;
/** A change-set from one of the household's other devices, applied here. */
async function fromDevice(database: Database, bookId: string, device: string, ops: Op[]) {
  await applyChangeSet(database, bookId, { v: 1, hlc: encodeHlc(Date.now(), (tick += 1), device), member: device === 'dev-f' ? 'member-f' : 'member-r', ops });
}

async function skipsOf(database: Database) {
  const rows = await database.db.values<[string, string, string]>(sql`SELECT entity, id, error FROM sync_skipped ORDER BY seq, rowid`);
  return rows.map(([entity, id, error]) => ({ entity, id, error }));
}

const linkOp = (goalId: string, state: 'on' | 'off' | 'deleted', round = 1, sharedBy = 'member-f'): Op => ({
  entity: 'goal_share',
  id: goalId,
  op: 'upsert',
  fields: { sharedBy, state, stateOn: '2030-02-01', round },
});

const goalOp = (goalId: string, name = 'Trip Fund'): Op => ({
  entity: 'goal',
  id: goalId,
  op: 'upsert',
  fields: { name, kind: 'holiday', growthBps: 0, returnBps: 0, currency: 'IDR', status: 'active' },
});

const stageOp = (goalId: string, id: string, name: string, sort = 0): Op => ({
  entity: 'goal_stage',
  id,
  op: 'upsert',
  fields: { goalId, name, targetMinor: 2_780_000, targetMonths: null, dueOn: '2031-05-01', sort, paidOn: null },
});

const newId = (n: number) => `01a0e100-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('capturing a shared goal', () => {
  it('a link and its goal go out in order, in one change-set', async () => {
    const t = await withTripFund('member-f');
    await t.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal_share', id: t.goalId }, { entity: 'goal', id: t.goalId }, { entity: 'goal_stage' }], () => tx.run(linkSql(t, t.goalId, 'on'))),
    );
    expect((await outboxOps(t.database)).map((op) => [op.entity, op.op])).toEqual([
      ['goal_share', 'upsert'],
      ['goal', 'upsert'],
      ['goal_stage', 'upsert'],
      ['goal_stage', 'upsert'],
    ]);
    expect(await outboxChangeSets(t.database)).toHaveLength(1);
  });

  it("off sends only the link, even with a partner's summary here", async () => {
    const t = await withTripFund('member-f');
    await linkHere(t, t.goalId, 'on');
    await t.database.execScript(
      `INSERT INTO goal_member_funding (goal_id, member_id, workspace_id, lines_json, planned_monthly_minor, as_of) VALUES ('${t.goalId}', 'member-r', '${t.ws.workspaceId}', '[]', 315000, '2030-02-10')`,
    );
    await clearOutbox(t.database);
    await t.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal_share', id: t.goalId }, { entity: 'goal_member_funding' }, { entity: 'goal' }, { entity: 'goal_stage' }], () =>
        tx.run(sql`UPDATE goal_shares SET state = 'off' WHERE goal_id = ${t.goalId}`),
      ),
    );
    expect((await outboxOps(t.database)).map((op) => [op.entity, op.op, op.op === 'upsert' ? op.fields.state : null])).toEqual([['goal_share', 'upsert', 'off']]);
  });

  it('deleting a shared goal sends only its link going to deleted', async () => {
    const t = await withTripFund('member-f');
    await linkHere(t, t.goalId, 'on');
    await t.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal_share', id: t.goalId }, { entity: 'goal', id: t.goalId }, { entity: 'goal_stage' }], async () => {
        await tx.run(sql`UPDATE goal_shares SET state = 'deleted' WHERE goal_id = ${t.goalId}`);
        await tx.run(sql`DELETE FROM goal_stages WHERE goal_id = ${t.goalId}`);
        await tx.run(sql`DELETE FROM goals WHERE id = ${t.goalId}`);
      }),
    );
    expect((await outboxOps(t.database)).map((op) => [op.entity, op.op, op.op === 'upsert' ? op.fields.state : null])).toEqual([['goal_share', 'upsert', 'deleted']]);
  });

  it('a stage removed while the goal is shared still goes out as a delete', async () => {
    const t = await withTripFund('member-r');
    await linkHere(t, t.goalId, 'on');
    const [stageId] = (await t.database.db.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${t.goalId} AND name = 'Stay'`)).map((r) => r[0]);
    await t.database.transaction((tx) => withCapture(tx, { entity: 'goal_stage', id: stageId! }, () => tx.run(sql`DELETE FROM goal_stages WHERE id = ${stageId!}`)));
    expect(await outboxOps(t.database)).toEqual([{ entity: 'goal_stage', id: stageId, op: 'delete' }]);
  });

  it('a member who left this round sends no deletes for the rows it drops', async () => {
    const t = await withTripFund('member-r');
    await linkHere(t, t.goalId, 'on');
    await t.database.execScript(`INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES ('${t.goalId}', 'member-r', '${t.ws.workspaceId}', 1, '2030-03-01')`);
    await t.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal', id: t.goalId }, { entity: 'goal_stage' }], async () => {
        await tx.run(sql`DELETE FROM goal_stages WHERE goal_id = ${t.goalId}`);
        await tx.run(sql`DELETE FROM goals WHERE id = ${t.goalId}`);
      }),
    );
    expect(await outboxOps(t.database)).toEqual([]);
  });

  it('another member cannot archive on this phone', async () => {
    const t = await withTripFund('member-r');
    await linkHere(t, t.goalId, 'on');
    await expect(
      t.database.transaction((tx) => withCapture(tx, { entity: 'goal', id: t.goalId }, () => tx.run(sql`UPDATE goals SET status = 'archived' WHERE id = ${t.goalId}`))),
    ).rejects.toThrow(/only the sharer archives/);
    expect(await t.database.db.values(sql`SELECT status FROM goals WHERE id = ${t.goalId}`)).toEqual([['active']]);
  });

  it('the sharer archives, and another member renames', async () => {
    const t = await withTripFund('member-f');
    await linkHere(t, t.goalId, 'on');
    await t.database.transaction((tx) => withCapture(tx, { entity: 'goal', id: t.goalId }, () => tx.run(sql`UPDATE goals SET status = 'archived' WHERE id = ${t.goalId}`)));
    await shareAs(t.database, t.bookId, 'member-r');
    await t.database.transaction((tx) => withCapture(tx, { entity: 'goal', id: t.goalId }, () => tx.run(sql`UPDATE goals SET name = 'Coast Trip' WHERE id = ${t.goalId}`)));
    expect((await outboxOps(t.database)).map((op) => (op.op === 'upsert' ? op.fields : null))).toEqual([{ status: 'archived' }, { name: 'Coast Trip' }]);
  });

  it('a leave is written only by the member it names', async () => {
    const t = await withTripFund('member-r');
    await linkHere(t, t.goalId, 'on');
    const leave = (member: string) =>
      t.database.transaction((tx) =>
        withCapture(tx, { entity: 'goal_share_leave', id: `${t.goalId}|${member}` }, () =>
          tx.run(sql`INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES (${t.goalId}, ${member}, ${t.ws.workspaceId}, 1, '2030-03-01')`),
        ),
      );
    await expect(leave('member-f')).rejects.toThrow(/each member leaves only for themselves/);
    await leave('member-r');
    expect((await outboxOps(t.database)).map((op) => [op.entity, op.id])).toEqual([['goal_share_leave', `${t.goalId}|member-r`]]);
  });
});

describe('the scope helpers', () => {
  it('find the goal a row belongs to, its link, and whether a member left this round', async () => {
    const t = await withTripFund('member-r');
    await linkHere(t, t.goalId, 'on', 'member-f', 2);
    const [stageId] = (await t.database.db.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${t.goalId} AND name = 'Flights'`)).map((r) => r[0]);
    await t.database.execScript(`INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES ('${t.goalId}', 'member-r', '${t.ws.workspaceId}', 1, '2030-03-01')`);
    const seen = await t.database.transaction(async (tx) => ({
      link: await goalLinkOfTx(tx, t.goalId),
      none: await goalLinkOfTx(tx, 'no-such-goal'),
      ofStage: await goalOfRowTx(tx, 'goal_stage', { id: stageId! }, {}),
      ofNewStage: await goalOfRowTx(tx, 'goal_stage', { id: 'stage-new' }, { goalId: 'g-from-fields' }),
      ofFunding: await goalOfRowTx(tx, 'goal_member_funding', { goal_id: t.goalId, member_id: 'member-r' }, {}),
      ofGoal: await goalOfRowTx(tx, 'goal', { id: t.goalId }, {}),
      // A leave from round 1 is stale once the link is in round 2: the member is back in.
      leftRound1: await memberLeftTx(tx, t.goalId, 'member-r'),
      leftWithLink: await leftWithLinkTx(tx, 'goal_stage', { id: stageId! }, { goalId: t.goalId }),
    }));
    expect(seen).toEqual({
      link: { bookId: t.bookId, sharedBy: 'member-f', state: 'on', round: 2 },
      none: null,
      ofStage: t.goalId,
      ofNewStage: 'g-from-fields',
      ofFunding: t.goalId,
      ofGoal: t.goalId,
      leftRound1: false,
      leftWithLink: false,
    });
  });
});

describe('applying a shared goal', () => {
  it('an op for a goal no longer shared is dropped, not skipped', async () => {
    const t = await household('member-r');
    const goalId = newId(1);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId), stageOp(goalId, newId(2), 'Flights')]);
    // Money of Rina's set aside here: something of hers is in the goal, so the off keeps her a copy (Task 10).
    const savings = (await createAccount(t.database, t.ws, { name: 'Partner Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 9_000_000, openedOn: '2026-01-01' })).id;
    await saveEarmark(t.database, t.ws, { goalId, accountId: savings, amountMinor: 4_000_000 });
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'off')]);
    await fromDevice(t.database, t.bookId, 'dev-r', [stageOp(goalId, newId(3), 'From afar', 1)]);
    // A partial edit names no goal: the stage stored here does.
    await fromDevice(t.database, t.bookId, 'dev-r', [{ entity: 'goal_stage', id: newId(2), op: 'upsert', fields: { name: 'Ferry' } }]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM goal_stages WHERE goal_id = ${goalId} AND name = 'From afar'`)).toEqual([[0]]);
    // The off made Rina's copy private under new ids (Task 8): the edit after it reached neither.
    expect(await t.database.db.values(sql`SELECT name FROM goal_stages WHERE id = ${newId(2)}`)).toEqual([]);
    expect(await t.database.db.values(sql`SELECT name FROM goal_stages WHERE goal_id <> ${goalId}`)).toEqual([['Flights']]);
    expect(await skipsOf(t.database)).toEqual([]);
  });

  it('an op for a goal with no link here is dropped too', async () => {
    const t = await household('member-r');
    await fromDevice(t.database, t.bookId, 'dev-f', [goalOp(newId(4)), stageOp(newId(4), newId(5), 'Flights')]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM goals WHERE id = ${newId(4)}`)).toEqual([[0]]);
    expect(await skipsOf(t.database)).toEqual([]);
  });

  it('a forged off from another member is a recorded skip', async () => {
    const t = await withTripFund('member-f');
    await linkHere(t, t.goalId, 'on');
    await fromDevice(t.database, t.bookId, 'dev-r', [linkOp(t.goalId, 'off')]);
    expect((await skipsOf(t.database))[0]).toMatchObject({ entity: 'goal_share', error: expect.stringMatching(/^AUTHORITY: only the sharer changes the share/) });
    expect(await t.database.db.values(sql`SELECT state FROM goal_shares WHERE goal_id = ${t.goalId}`)).toEqual([['on']]);
  });

  it("an archive from another member is a recorded skip, and the sharer's is taken", async () => {
    const t = await household('member-r');
    const goalId = newId(6);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId)]);
    const archive: Op = { entity: 'goal', id: goalId, op: 'upsert', fields: { status: 'archived' } };
    // Rina's second phone: the same member as this one, still not the sharer.
    await fromDevice(t.database, t.bookId, 'dev-r', [archive]);
    expect((await skipsOf(t.database)).map((s) => s.error)).toEqual(['AUTHORITY: only the sharer archives']);
    await fromDevice(t.database, t.bookId, 'dev-f', [archive]);
    expect(await t.database.db.values(sql`SELECT status FROM goals WHERE id = ${goalId}`)).toEqual([['archived']]);
  });

  it('a goal is never deleted by an op, and a link never deleted', async () => {
    const t = await household('member-r');
    const goalId = newId(7);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId)]);
    await fromDevice(t.database, t.bookId, 'dev-f', [{ entity: 'goal', id: goalId, op: 'delete' }, { entity: 'goal_share', id: goalId, op: 'delete' }]);
    expect((await skipsOf(t.database)).map((s) => s.error)).toEqual(['AUTHORITY: a shared goal ends by its link', 'AUTHORITY: a share is turned off, never deleted']);
    expect(await t.database.db.values(sql`SELECT count(*) FROM goals WHERE id = ${goalId}`)).toEqual([[1]]);
  });

  it('a link for a goal shared in another book is a recorded skip, and its ops there are dropped', async () => {
    const t = await withTripFund('member-f');
    await linkHere(t, t.goalId, 'on');
    const other = await createBook(t.database, t.ws, { name: 'Side Business', kind: 'business', baseCurrency: 'IDR' });
    await shareAs(t.database, other, 'member-f');
    await t.database.execScript(`
      INSERT INTO sync_authority (book_id, member_id, role, role_hlc, deleted, row_hlc) VALUES ('${other}', 'member-f', 'owner', '0', 0, '0');
      INSERT INTO sync_authority_devices (book_id, device_id, member_id, removed_seq, added_seq) VALUES ('${other}', 'dev-f', 'member-f', NULL, 1);
    `);
    await fromDevice(t.database, other, 'dev-f', [linkOp(t.goalId, 'on'), goalOp(t.goalId, 'Elsewhere')]);
    expect((await skipsOf(t.database)).map((s) => [s.entity, s.error])).toEqual([['goal_share', 'AUTHORITY: the goal is shared in another book']]);
    expect(await t.database.db.values(sql`SELECT book_id FROM goal_shares WHERE goal_id = ${t.goalId}`)).toEqual([[t.bookId]]);
    expect(await t.database.db.values(sql`SELECT name FROM goals WHERE id = ${t.goalId}`)).toEqual([['Trip Fund']]);
  });

  it('a goal arriving on a phone goes to the end of its list', async () => {
    const t = await household('member-r');
    await saveGoal(t.database, t.ws, { name: 'First', kind: 'other', growthBps: 0, returnBps: 0, stages: [stages[0]!] });
    await saveGoal(t.database, t.ws, { name: 'Second', kind: 'other', growthBps: 0, returnBps: 0, stages: [stages[1]!] });
    const goalId = newId(8);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId), stageOp(goalId, newId(9), 'Flights')]);
    expect((await listGoals(t.database, t.ws)).map((g) => g.name)).toEqual(['First', 'Second', 'Trip Fund']);
    expect(await t.database.db.values(sql`SELECT rank, workspace_id FROM goals WHERE id = ${goalId}`)).toEqual([[2, t.ws.workspaceId]]);
    expect(await skipsOf(t.database)).toEqual([]);
  });

  it("a partner's summary is taken, and one written for someone else is a recorded skip", async () => {
    const t = await household('member-f');
    const goalId = newId(10);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId)]);
    const summary = (member: string): Op => ({
      entity: 'goal_member_funding',
      id: `${goalId}|${member}`,
      op: 'upsert',
      fields: { lines: '[]', plannedMonthlyMinor: 415_000, asOf: '2030-02-10' },
    });
    await fromDevice(t.database, t.bookId, 'dev-r', [summary('member-r')]);
    await fromDevice(t.database, t.bookId, 'dev-r', [summary('member-x')]);
    expect(await t.database.db.values(sql`SELECT member_id, planned_monthly_minor FROM goal_member_funding WHERE goal_id = ${goalId}`)).toEqual([['member-r', 415_000]]);
    expect((await skipsOf(t.database)).map((s) => [s.entity, s.error])).toEqual([['goal_member_funding', 'AUTHORITY: writer']]);
  });

  it("a stage for a goal missing here while its link is on is a recorded skip", async () => {
    const t = await household('member-r');
    const goalId = newId(11);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), stageOp(goalId, newId(12), 'Flights')]);
    expect((await skipsOf(t.database)).map((s) => [s.entity, s.error])).toEqual([['goal_stage', 'SkipOp: its parent is gone here']]);
  });

  it('on the phone of a member who left this round, the goal’s ops are dropped; the link’s still apply', async () => {
    const t = await household('member-r');
    const goalId = newId(13);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId)]);
    await t.database.execScript(`INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES ('${goalId}', 'member-r', '${t.ws.workspaceId}', 1, '2030-03-01')`);
    await fromDevice(t.database, t.bookId, 'dev-f', [goalOp(goalId, 'Coast Trip')]);
    expect(await t.database.db.values(sql`SELECT name FROM goals WHERE id = ${goalId}`)).toEqual([['Trip Fund']]);
    // Shared again: a new round, and the leave from round 1 no longer stands.
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'off')]);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on', 2), goalOp(goalId, 'Coast Trip')]);
    expect(await t.database.db.values(sql`SELECT name FROM goals WHERE id = ${goalId}`)).toEqual([['Coast Trip']]);
    expect(await skipsOf(t.database)).toEqual([]);
  });

  it("once Rina leaves, the summary and moves she still sends are dropped; Bima's own leave is refused", async () => {
    const t = await household('member-f');
    const goalId = newId(16);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId)]);
    const summary: Op = { entity: 'goal_member_funding', id: `${goalId}|member-r`, op: 'upsert', fields: { lines: '[]', plannedMonthlyMinor: 215_000, asOf: '2030-02-10' } };
    const move: Op = {
      entity: 'goal_member_move',
      id: newId(17),
      op: 'upsert',
      fields: { goalId, memberId: 'member-r', kind: 'set-aside', occurredOn: '2030-03-02', amountMinor: 125_000, currency: 'IDR', text: 'Savings', stageId: null },
    };
    const leave = (member: string): Op => ({ entity: 'goal_share_leave', id: `${goalId}|${member}`, op: 'upsert', fields: { round: 1, leftOn: '2030-03-01' } });
    await fromDevice(t.database, t.bookId, 'dev-r', [leave('member-r')]);
    await fromDevice(t.database, t.bookId, 'dev-r', [summary, move]);
    await fromDevice(t.database, t.bookId, 'dev-f', [leave('member-f')]);
    expect(await t.database.db.values(sql`SELECT member_id, round FROM goal_share_leaves WHERE goal_id = ${goalId}`)).toEqual([['member-r', 1]]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM goal_member_funding WHERE goal_id = ${goalId}`)).toEqual([[0]]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM goal_member_moves WHERE goal_id = ${goalId}`)).toEqual([[0]]);
    expect((await skipsOf(t.database)).map((s) => [s.entity, s.error])).toEqual([['goal_share_leave', 'AUTHORITY: the sharer turns it off instead']]);
  });

  it("the sharer's second phone, with its own off not sent yet, takes an edit the log has before that off", async () => {
    const t = await household('member-f');
    const goalId = newId(14);
    await fromDevice(t.database, t.bookId, 'dev-f', [linkOp(goalId, 'on'), goalOp(goalId), stageOp(goalId, newId(15), 'Flights')]);
    // This phone turns sharing off; the off is still in its outbox when Rina's edit, already in the log, arrives.
    await t.database.transaction((tx) => withCapture(tx, { entity: 'goal_share', id: goalId }, () => tx.run(sql`UPDATE goal_shares SET state = 'off' WHERE goal_id = ${goalId}`)));
    await fromDevice(t.database, t.bookId, 'dev-r', [{ entity: 'goal_stage', id: newId(15), op: 'upsert', fields: { name: 'Ferry' } }]);
    expect(await t.database.db.values(sql`SELECT name FROM goal_stages WHERE id = ${newId(15)}`)).toEqual([['Ferry']]);
    expect(await skipsOf(t.database)).toEqual([]);
  });
});

describe('a shared goal between two phones', () => {
  /** Bima and Rina in one household book, Bima's goal shared and on both phones. */
  async function sharedTrip() {
    const home = new Household();
    const bima = await home.device('Bima', 'member-f');
    const rina = await home.device('Rina', 'member-r');
    const bookId = await home.share(bima);
    await home.join(rina, bima);
    await home.settle();
    const goalId = await saveGoal(bima.database, bima.ws, { name: 'Trip Fund', kind: 'holiday', growthBps: 0, returnBps: 0, stages });
    await bima.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal_share', id: goalId }, { entity: 'goal', id: goalId }, { entity: 'goal_stage' }], () =>
        tx.run(sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES (${goalId}, ${bookId}, ${bima.ws.workspaceId}, 'member-f', 'on', '2030-02-01', 1)`),
      ),
    );
    await home.settle();
    const [stayId] = (await rina.database.db.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${goalId} AND name = 'Stay'`)).map((r) => r[0]);
    return { home, bima, rina, bookId, goalId, stayId: stayId! };
  }

  it("Bima's own off, still unsent, does not keep out Rina's edit the log has before it", async () => {
    const { bima, rina, bookId, goalId, stayId } = await sharedTrip();
    await rina.database.transaction((tx) => withCapture(tx, { entity: 'goal_stage', id: stayId }, () => tx.run(sql`UPDATE goal_stages SET name = 'Hotel' WHERE id = ${stayId}`)));
    await rina.engine.syncOnce(bookId);
    await bima.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal_share', id: goalId }, { entity: 'goal', id: goalId }, { entity: 'goal_stage' }], () =>
        tx.run(sql`UPDATE goal_shares SET state = 'off', state_on = '2030-03-01' WHERE goal_id = ${goalId}`),
      ),
    );
    await bima.engine.syncOnce(bookId);
    expect(await bima.database.db.values(sql`SELECT name FROM goal_stages WHERE id = ${stayId}`)).toEqual([['Hotel']]);
    expect(await bima.database.db.values(sql`SELECT count(*) FROM sync_skipped`)).toEqual([[0]]);
  });

  it('reaches Rina at the end of her list, her edit reaches Bima, and off sends no deletes', async () => {
    const home = new Household();
    const bima = await home.device('Bima', 'member-f');
    const rina = await home.device('Rina', 'member-r');
    const bookId = await home.share(bima);
    await home.join(rina, bima);
    await home.settle();
    await saveGoal(rina.database, rina.ws, { name: 'Own Car', kind: 'vehicle', growthBps: 0, returnBps: 0, stages: [stages[0]!] });
    const goalId = await saveGoal(bima.database, bima.ws, { name: 'Trip Fund', kind: 'holiday', growthBps: 0, returnBps: 0, stages });
    await bima.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal_share', id: goalId }, { entity: 'goal', id: goalId }, { entity: 'goal_stage' }], () =>
        tx.run(sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES (${goalId}, ${bookId}, ${bima.ws.workspaceId}, 'member-f', 'on', '2030-02-01', 1)`),
      ),
    );
    await home.settle();
    expect((await listGoals(rina.database, rina.ws)).map((g) => [g.name, g.stages.map((s) => [s.name, s.targetMinor])])).toEqual([
      ['Own Car', [['Flights', 4_350_000]]],
      ['Trip Fund', [['Flights', 4_350_000], ['Stay', 6_120_000]]],
    ]);

    const [stayId] = (await rina.database.db.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${goalId} AND name = 'Stay'`)).map((r) => r[0]);
    await rina.database.transaction((tx) => withCapture(tx, { entity: 'goal_stage', id: stayId! }, () => tx.run(sql`UPDATE goal_stages SET target_minor = ${6_480_000} WHERE id = ${stayId!}`)));
    await home.settle();
    expect(await bima.database.db.values(sql`SELECT target_minor FROM goal_stages WHERE id = ${stayId!}`)).toEqual([[6_480_000]]);
    // Money of Rina's own in it, so the off keeps her a private copy (Task 10: no money, no copy).
    await saveEarmark(rina.database, rina.ws, { goalId, accountId: rina.bank, amountMinor: 1_000_000 });
    await home.settle();

    // Bima turns sharing off while Rina, not yet told, renames a stage: the log has the off first.
    await bima.database.transaction((tx) =>
      withCapture(tx, [{ entity: 'goal_share', id: goalId }, { entity: 'goal', id: goalId }, { entity: 'goal_stage' }], () =>
        tx.run(sql`UPDATE goal_shares SET state = 'off', state_on = '2030-03-01' WHERE goal_id = ${goalId}`),
      ),
    );
    expect((await outboxOps(bima.database)).map((op) => op.entity)).toEqual(['goal_share']);
    await rina.database.transaction((tx) => withCapture(tx, { entity: 'goal_stage', id: stayId! }, () => tx.run(sql`UPDATE goal_stages SET name = 'Hotel' WHERE id = ${stayId!}`)));
    await home.settle();
    expect(await rina.database.db.values(sql`SELECT state FROM goal_shares WHERE goal_id = ${goalId}`)).toEqual([['off']]);
    // Nothing deleted: Rina's phone made its copy private under new ids (Task 8), her rename in it, and no tombstone
    // ends the goal for a later round.
    expect(await rina.database.db.values(sql`SELECT count(*) FROM goal_stages WHERE goal_id = ${goalId}`)).toEqual([[0]]);
    expect(await rina.database.db.values(sql`SELECT name FROM goal_stages WHERE goal_id IN (SELECT id FROM goals WHERE name = 'Trip Fund') ORDER BY sort`)).toEqual([['Flights'], ['Hotel']]);
    expect(await rina.database.db.values(sql`SELECT count(*) FROM sync_tombstones WHERE id = ${goalId} OR id = ${stayId!}`)).toEqual([[0]]);
    // Rina's rename came after the off in the log: dropped on Bima's phone, and recorded nowhere.
    expect(await bima.database.db.values(sql`SELECT name FROM goal_stages WHERE id = ${stayId!}`)).toEqual([['Stay']]);
    expect(await bima.database.db.values(sql`SELECT count(*) FROM sync_skipped`)).toEqual([[0]]);
    expect(await rina.database.db.values(sql`SELECT count(*) FROM sync_skipped`)).toEqual([[0]]);
  });
});
