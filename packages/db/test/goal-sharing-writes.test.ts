import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveGoal,
  createAccount,
  deleteGoal,
  goalPlansFor,
  type GoalRow,
  listEarmarks,
  listGoals,
  personalBook,
  postTransaction,
  reorderGoals,
  type SaveGoalInput,
  saveEarmark,
  saveGoal,
  setStagePaid,
  setStandingMonthly,
  upsertRate,
  voidTransaction,
  type Database,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { applyChangeSet } from '../src/sync/apply';
import { configureCapture } from '../src/sync/capture';
import { encodeHlc } from '../src/sync/hlc';
import type { Op } from '../src/sync/types';
import { setupDb } from './helpers';
import { clearOutbox, outboxOps } from './sync/sync-helpers';

/*
 * Writes to a shared goal (shared goals §8.5, §9.1, §9.4, C10, C12/D10): every edit of its synced rows goes out, only
 * the sharer archives or deletes, and the partner's money locks the currency and the stages it paid. Bima (member-f)
 * shares 'Trip Fund'; Rina (member-r) is the other member. Each phone is a database of its own.
 */

const DAY = '2026-11-10';
const executors: NodeExecutor[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
});
afterEach(() => {
  vi.useRealTimers();
  for (const executor of executors.splice(0)) executor.close();
});

const stages = [
  { name: 'Deposit', targetMinor: 4_350_000, targetMonths: null, dueOn: '2031-03-01' },
  { name: 'Balance', targetMinor: 6_120_000, targetMonths: null, dueOn: '2031-04-01' },
];

/** A phone in the household book as `me`, with both members and their devices in the book's view. */
async function phone(me: 'member-f' | 'member-r') {
  const t = await setupDb();
  executors.push(t.executor);
  const bookId = (await personalBook(t.database, t.ws)).id;
  configureCapture(t.database, { standInDeviceId: true });
  await t.database.db.run(sql`
    INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${`relay-${bookId}`}, 1, ${me}, 'active', '2030-01-01T00:00:00Z')
    ON CONFLICT (book_id) DO UPDATE SET member_id = excluded.member_id`);
  await t.database.execScript(`
    INSERT INTO sync_authority (book_id, member_id, role, role_hlc, deleted, row_hlc) VALUES ('${bookId}', 'member-f', 'owner', '0', 0, '0'), ('${bookId}', 'member-r', 'member', '0', 0, '0');
    INSERT INTO sync_authority_devices (book_id, device_id, member_id, removed_seq, added_seq) VALUES ('${bookId}', 'dev-f', 'member-f', NULL, 1), ('${bookId}', 'dev-r', 'member-r', NULL, 2);
    INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES
      ('${bookId}', 'member-f', 'Bima', 'owner', '2030-01-01T00:00:00Z'), ('${bookId}', 'member-r', 'Rina', 'member', '2030-01-02T00:00:00Z')
      ON CONFLICT DO NOTHING;
  `);
  return { ...t, bookId };
}

/** The phone with 'Trip Fund' here, shared by Bima, and an outbox emptied of the set-up. */
async function sharedTrip(me: 'member-f' | 'member-r') {
  const t = await phone(me);
  const goalId = await saveGoal(t.database, t.ws, { name: 'Trip Fund', kind: 'holiday', growthBps: 0, returnBps: 0, stages });
  await t.database.execScript(
    `INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES ('${goalId}', '${t.bookId}', '${t.ws.workspaceId}', 'member-f', 'on', '2030-02-01', 1)`,
  );
  await clearOutbox(t.database);
  const goal = (await listGoals(t.database, t.ws)).find((g) => g.id === goalId)!;
  return { ...t, goalId, goal, stageId: goal.stages[0]!.id, balanceId: goal.stages[1]!.id };
}

const inputOf = (goal: GoalRow): SaveGoalInput => ({
  id: goal.id,
  name: goal.name,
  kind: goal.kind,
  growthBps: goal.growthBps,
  returnBps: goal.returnBps,
  standingMonthlyMinor: goal.standingMonthlyMinor,
  standingNote: goal.standingNote,
  currency: goal.currency,
  stages: goal.stages.map(({ id, name, targetMinor, targetMonths, dueOn, paidOn }) => ({ id, name, targetMinor, targetMonths, dueOn, paidOn })),
});

let tick = 0;
/** A change-set from one of the household's other devices, applied here. */
async function fromDevice(database: Database, bookId: string, device: 'dev-f' | 'dev-r', ops: Op[]) {
  await applyChangeSet(database, bookId, { v: 1, hlc: encodeHlc(Date.now(), (tick += 1), device), member: device === 'dev-f' ? 'member-f' : 'member-r', ops });
}

async function skipsOf(database: Database) {
  return database.db.values(sql`SELECT entity, id, error FROM sync_skipped`);
}

async function pendingGoals(database: Database): Promise<string[]> {
  const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = 'goal.pending_summaries'`);
  return row ? (JSON.parse(row[0]) as string[]) : [];
}

const partnerLine = (goalId: string, workspaceId: string, lines: string) =>
  `INSERT INTO goal_member_funding (goal_id, member_id, workspace_id, lines_json, planned_monthly_minor, as_of) VALUES ('${goalId}', 'member-r', '${workspaceId}', '${lines}', 0, '${DAY}')`;

describe('edits of a shared goal go out', () => {
  it('marking a payment paid goes out', async () => {
    const { database, ws, stageId } = await sharedTrip('member-f');
    await setStagePaid(database, ws, stageId, '2026-11-10');
    expect((await outboxOps(database)).find((o) => o.entity === 'goal_stage')).toMatchObject({ id: stageId, op: 'upsert', fields: expect.objectContaining({ paidOn: '2026-11-10' }) });
  });

  it('a rename goes out; standing amount and order do not', async () => {
    const { database, ws, goal, goalId } = await sharedTrip('member-f');
    const otherId = await saveGoal(database, ws, { name: 'Own Fund', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'All', targetMinor: 2_780_000, targetMonths: null, dueOn: '2031-05-01' }] });
    await clearOutbox(database);
    await saveGoal(database, ws, { ...inputOf(goal), name: 'Trip Fund 2030' });
    await setStandingMonthly(database, ws, goalId, 700_000);
    await reorderGoals(database, ws, [otherId, goalId]);
    expect((await outboxOps(database)).filter((o) => o.entity === 'goal').map((o) => o.op === 'upsert' && Object.keys(o.fields))).toEqual([['name']]);
  });

  it('a stage added and one removed go out', async () => {
    const { database, ws, goal, balanceId } = await sharedTrip('member-f');
    const kept = inputOf(goal).stages.filter((stage) => stage.id !== balanceId);
    await saveGoal(database, ws, { ...inputOf(goal), stages: [...kept, { name: 'Tours', targetMinor: 1_930_000, targetMonths: null, dueOn: '2031-06-01' }] });
    const ops = (await outboxOps(database)).filter((o) => o.entity === 'goal_stage');
    expect(ops.map((o) => [o.op, o.op === 'delete' ? o.id : o.fields.name])).toEqual([
      ['delete', balanceId],
      ['upsert', 'Tours'],
    ]);
    expect(ops[1]).toMatchObject({ fields: expect.objectContaining({ targetMinor: 1_930_000, dueOn: '2031-06-01', sort: 1 }) });
  });

  it('the sharer archives, and it goes out', async () => {
    const { database, ws, goalId } = await sharedTrip('member-f');
    await archiveGoal(database, ws, goalId);
    expect((await outboxOps(database)).filter((o) => o.entity === 'goal')).toEqual([{ entity: 'goal', id: goalId, op: 'upsert', fields: { status: 'archived' } }]);
  });

  it('a spend that pays a stage sends the paid mark, and its void takes it back', async () => {
    const { database, ws, goalId, stageId } = await sharedTrip('member-f');
    const main = (await createAccount(database, ws, { name: 'Main Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-01-01' })).id;
    const travel = (await createAccount(database, ws, { name: 'Travel', kind: 'expense', subtype: 'category', currency: null })).id;
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 10_000_000 });
    await clearOutbox(database);
    const spendId = await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'Deposit paid',
      lines: expenseLines({ categoryAccountId: travel, paymentAccountId: main, amountMinor: 4_350_000, currency: 'IDR' }),
      setAside: { accountId: main, goalId, intent: 'spend', overMinor: 4_350_000 },
    });
    expect((await outboxOps(database)).filter((o) => o.entity === 'goal_stage')).toEqual([{ entity: 'goal_stage', id: stageId, op: 'upsert', fields: { paidOn: DAY } }]);
    await clearOutbox(database);
    await voidTransaction(database, ws, spendId);
    expect((await outboxOps(database)).filter((o) => o.entity === 'goal_stage')).toEqual([{ entity: 'goal_stage', id: stageId, op: 'upsert', fields: { paidOn: null } }]);
  });

  it('a goal not shared sends nothing', async () => {
    const { database, ws } = await phone('member-f');
    const goalId = await saveGoal(database, ws, { name: 'Own Fund', kind: 'other', growthBps: 0, returnBps: 0, stages });
    const [stage] = (await listGoals(database, ws))[0]!.stages;
    await setStagePaid(database, ws, stage!.id, DAY);
    await archiveGoal(database, ws, goalId);
    await deleteGoal(database, ws, goalId);
    expect((await outboxOps(database)).filter((o) => o.entity.startsWith('goal'))).toEqual([]);
  });
});

describe('only the sharer archives or deletes (C12, D10)', () => {
  it('another member can neither archive nor delete', async () => {
    const rina = await sharedTrip('member-r');
    const { goalId } = rina;
    await expect(archiveGoal(rina.database, rina.ws, goalId)).rejects.toThrow('Only Bima can archive this shared goal');
    await expect(deleteGoal(rina.database, rina.ws, goalId)).rejects.toThrow('Bima shared this goal; leave it instead');
    expect((await listGoals(rina.database, rina.ws)).map((g) => [g.id, g.status])).toEqual([[goalId, 'active']]);
    expect(await outboxOps(rina.database)).toEqual([]);
  });

  it('another member still archives and deletes a goal of their own', async () => {
    const { database, ws } = await phone('member-r');
    const goalId = await saveGoal(database, ws, { name: 'Own Fund', kind: 'other', growthBps: 0, returnBps: 0, stages });
    await archiveGoal(database, ws, goalId);
    expect((await listGoals(database, ws, { includeArchived: true }))[0]!.status).toBe('archived');
    await deleteGoal(database, ws, goalId);
    expect(await listGoals(database, ws, { includeArchived: true })).toEqual([]);
  });

  it("the sharer's delete sends the link and no delete", async () => {
    const { database, ws, goalId } = await sharedTrip('member-f');
    // Rina's line and History of the goal are here too: they go locally, with no op.
    await database.execScript(`
      ${partnerLine(goalId, ws.workspaceId, '[]')};
      INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text, stage_id)
        VALUES ('move-r', '${goalId}', '${ws.workspaceId}', 'member-r', 'set-aside', '2026-10-01', 1500000, 'IDR', 'Partner Savings', NULL);
    `);
    await deleteGoal(database, ws, goalId);
    expect((await outboxOps(database)).map((o) => [o.entity, o.op])).toEqual([['goal_share', 'upsert']]);
    expect(await listGoals(database, ws, { includeArchived: true })).toEqual([]);
    const [link] = await database.db.values<[string]>(sql`SELECT state FROM goal_shares WHERE goal_id = ${goalId}`);
    expect(link![0]).toBe('deleted');
    expect(await database.db.values(sql`SELECT 1 FROM goal_member_funding UNION ALL SELECT 1 FROM goal_member_moves`)).toEqual([]);
  });
});

describe("the partner's money locks the goal (§9.1, §9.4)", () => {
  it('a stage the partner spent against stays', async () => {
    const { database, ws, goal, goalId, stageId, balanceId } = await sharedTrip('member-f');
    await database.execScript(`
      INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text, stage_id)
        VALUES ('move-r', '${goalId}', '${ws.workspaceId}', 'member-r', 'spent', '2026-10-01', -4350000, 'IDR', 'Deposit paid', '${stageId}');
    `);
    const otherStagesOnly = inputOf(goal).stages.filter((stage) => stage.id === balanceId);
    await expect(saveGoal(database, ws, { ...inputOf(goal), stages: otherStagesOnly })).rejects.toThrow(/Money was drawn against "Deposit"/);
  });

  it('the currency is fixed once only the partner has money in it', async () => {
    const { database, ws, goal, goalId } = await sharedTrip('member-f');
    await database.execScript(partnerLine(goalId, ws.workspaceId, '[{"ref":"r1","name":"Partner Savings","kind":"earmark","amountMinor":10000000,"risk":null}]'));
    await expect(saveGoal(database, ws, { ...inputOf(goal), currency: 'USD' })).rejects.toThrow(/currency cannot change/);
  });

  it('a History line of the partner locks it too', async () => {
    const { database, ws, goal, goalId } = await sharedTrip('member-f');
    await database.execScript(`
      INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text, stage_id)
        VALUES ('move-r', '${goalId}', '${ws.workspaceId}', 'member-r', 'taken-back', '2026-10-01', -1500000, 'IDR', 'Partner Savings', NULL);
    `);
    await expect(saveGoal(database, ws, { ...inputOf(goal), currency: 'USD' })).rejects.toThrow(/currency cannot change/);
  });

  it('a partner line with nothing in it leaves the currency free', async () => {
    const { database, ws, goal, goalId } = await sharedTrip('member-f');
    await database.execScript(partnerLine(goalId, ws.workspaceId, '[]'));
    await saveGoal(database, ws, { ...inputOf(goal), currency: 'USD' });
    expect((await listGoals(database, ws))[0]!.currency).toBe('USD');
    expect((await outboxOps(database)).filter((o) => o.entity === 'goal')).toEqual([{ entity: 'goal', id: goalId, op: 'upsert', fields: { currency: 'USD' } }]);
  });
});

describe("a partner's edit applied here re-sends this member's figures (§8.5)", () => {
  it("a currency change from Rina's phone sends Bima's line in the new currency at his next write", async () => {
    const { database, ws, goalId, bookId } = await sharedTrip('member-f');
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: DAY, rate: 16_000, source: 'manual', sourceDate: DAY });
    const dollars = (
      await createAccount(database, ws, { name: 'Travel Dollars', kind: 'asset', subtype: 'savings', currency: 'USD', openingBalanceMinor: 10_000, openedOn: '2026-01-01', openingRateToBase: 16_000 })
    ).id;
    await saveEarmark(database, ws, { goalId, accountId: dollars, amountMinor: 10_000 });
    const line = async () => {
      const ops = (await outboxOps(database)).filter((o) => o.entity === 'goal_member_funding');
      const op = ops.at(-1);
      return op && op.op === 'upsert' ? (JSON.parse(String(op.fields.lines)) as { amountMinor: number | null }[])[0]!.amountMinor : undefined;
    };
    expect(await line()).toBe(1_600_000);
    await clearOutbox(database);

    await fromDevice(database, bookId, 'dev-r', [{ entity: 'goal', id: goalId, op: 'upsert', fields: { currency: 'USD' } }]);
    expect(await skipsOf(database)).toEqual([]);
    expect(await pendingGoals(database)).toEqual([goalId]);
    // The next write of Bima's own, whatever it touches, sends the line the new currency counts.
    await database.transaction(async (tx) => {
      await tx.run(sql`UPDATE goals SET standing_note = standing_note WHERE id = ${goalId}`);
    });
    expect(await line()).toBe(10_000);
    expect(await pendingGoals(database)).toEqual([]);
  });

  it("a stage edit from Rina's phone marks the goal's figures to send", async () => {
    const { database, goalId, bookId, stageId } = await sharedTrip('member-f');
    await fromDevice(database, bookId, 'dev-r', [{ entity: 'goal_stage', id: stageId, op: 'upsert', fields: { targetMinor: 5_210_000 } }]);
    expect(await skipsOf(database)).toEqual([]);
    expect(await pendingGoals(database)).toEqual([goalId]);
  });
});

describe('a phone with nothing of its own in a goal keeps no copy when it ends', () => {
  const goalId = '01a0e100-0000-7000-8000-000000000071';
  const stageId = '01a0e100-0000-7000-8000-000000000072';
  const link = (state: 'on' | 'off' | 'deleted'): Op => ({ entity: 'goal_share', id: goalId, op: 'upsert', fields: { sharedBy: 'member-f', state, stateOn: '2030-02-01', round: 1 } });
  const arrive: Op[] = [
    link('on'),
    { entity: 'goal', id: goalId, op: 'upsert', fields: { name: 'Trip Fund', kind: 'holiday', growthBps: 0, returnBps: 0, currency: 'IDR', status: 'active' } },
    { entity: 'goal_stage', id: stageId, op: 'upsert', fields: { goalId, name: 'Deposit', targetMinor: 4_350_000, targetMonths: null, dueOn: '2031-03-01', sort: 0, paidOn: null } },
  ];

  for (const state of ['off', 'deleted'] as const) {
    it(`a late joiner reading an ${state} round just drops the goal`, async () => {
      const { database, ws, bookId } = await phone('member-r');
      await fromDevice(database, bookId, 'dev-f', arrive);
      expect((await listGoals(database, ws)).map((g) => g.id)).toEqual([goalId]);
      await fromDevice(database, bookId, 'dev-f', [link(state)]);
      expect(await listGoals(database, ws, { includeArchived: true })).toEqual([]);
      expect(await database.db.values(sql`SELECT 1 FROM goal_stages UNION ALL SELECT 1 FROM goal_share_log`)).toEqual([]);
      expect(await skipsOf(database)).toEqual([]);
    });
  }

  it('money of her own set aside here keeps a private copy', async () => {
    const { database, ws, bookId } = await phone('member-r');
    await fromDevice(database, bookId, 'dev-f', arrive);
    const savings = (await createAccount(database, ws, { name: 'Partner Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-01-01' })).id;
    await saveEarmark(database, ws, { goalId, accountId: savings, amountMinor: 10_000_000 });
    await fromDevice(database, bookId, 'dev-f', [link('off')]);
    const [copy] = await listGoals(database, ws);
    expect(copy!.id).not.toBe(goalId);
    expect(await listEarmarks(database, ws)).toEqual([{ goalId: copy!.id, accountId: savings, amountMinor: 10_000_000 }]);
  });

  // Final review M2: her line from her other phone stays with the shared goal, so a copy here would hold nothing.
  it('her own line from her other phone keeps no empty copy', async () => {
    const { database, ws, bookId } = await phone('member-r');
    await fromDevice(database, bookId, 'dev-f', arrive);
    await fromDevice(database, bookId, 'dev-r', [{ entity: 'goal_member_funding', id: `${goalId}|member-r`, op: 'upsert', fields: { lines: '[]', plannedMonthlyMinor: 0, asOf: DAY } }]);
    await fromDevice(database, bookId, 'dev-f', [link('off')]);
    expect(await listGoals(database, ws, { includeArchived: true })).toEqual([]);
    expect(await skipsOf(database)).toEqual([]);
  });
});

describe("the sharer's other phone follows a delete as deleteGoal does", () => {
  it('the goal and everything of this phone that names it go; the accounts stay', async () => {
    const { database, ws, goalId, bookId } = await sharedTrip('member-f');
    const main = (await createAccount(database, ws, { name: 'Main Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-01-01' })).id;
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 10_000_000 });
    await fromDevice(database, bookId, 'dev-f', [{ entity: 'goal_share', id: goalId, op: 'upsert', fields: { sharedBy: 'member-f', state: 'deleted', stateOn: DAY, round: 1 } }]);
    expect(await skipsOf(database)).toEqual([]);
    expect(await listGoals(database, ws, { includeArchived: true })).toEqual([]);
    expect(await listEarmarks(database, ws)).toEqual([]);
    expect(
      await database.db.values(sql`SELECT 1 FROM goal_stages UNION ALL SELECT 1 FROM goal_contributions UNION ALL SELECT 1 FROM goal_share_log UNION ALL SELECT 1 FROM goal_member_funding`),
    ).toEqual([]);
    expect(await database.db.values(sql`SELECT 1 FROM accounts WHERE id = ${main}`)).toHaveLength(1);
  });
});

describe('a malformed line from a peer (final review M7)', () => {
  it("breaks no read here, and Rina's leave is still followed", async () => {
    const { database, ws, bookId, goalId } = await sharedTrip('member-f');
    await fromDevice(database, bookId, 'dev-r', [{ entity: 'goal_member_funding', id: `${goalId}|member-r`, op: 'upsert', fields: { lines: '{broken', plannedMonthlyMinor: 0, asOf: DAY } }]);
    expect((await goalPlansFor(database, ws, DAY)).plans.find((plan) => plan.goalId === goalId)!.currentMinor).toBe(0);
    await fromDevice(database, bookId, 'dev-r', [{ entity: 'goal_share_leave', id: `${goalId}|member-r`, op: 'upsert', fields: { round: 1, leftOn: DAY } }]);
    expect(await database.db.values(sql`SELECT kind, member_name, amount_minor FROM goal_share_log WHERE goal_id = ${goalId}`)).toEqual([['left', 'Rina', null]]);
    expect(await database.db.values(sql`SELECT 1 FROM goal_member_funding`)).toEqual([]);
  });
});

/*
 * Final review I1: Edit goal sends back only what this edit changed, against the goal as the form opened on it (`base`),
 * so what another phone did meanwhile — a stage marked paid, a payment added — survives the save (C10: last writer
 * wins per field, not per form).
 */
describe('an edit saved over a partner’s change (I1)', () => {
  it("keeps Rina's paid mark and the payment she added; only Bima's own change goes out", async () => {
    const { database, ws, bookId, goalId, goal, stageId } = await sharedTrip('member-f');
    const base = inputOf(goal);
    const added = '01a0e100-0000-7000-8000-0000000000a1';
    // While Bima's form is open, Rina marks the deposit paid and adds a payment.
    await fromDevice(database, bookId, 'dev-r', [
      { entity: 'goal_stage', id: stageId, op: 'upsert', fields: { paidOn: DAY } },
      { entity: 'goal_stage', id: added, op: 'upsert', fields: { goalId, name: 'Visa', targetMinor: 900_000, targetMonths: null, dueOn: '2031-02-01', sort: 2, paidOn: null } },
    ]);
    await clearOutbox(database);
    await saveGoal(database, ws, { ...base, name: 'Coast Trip', base });
    const after = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(after.name).toBe('Coast Trip');
    expect(after.stages.map((s) => [s.name, s.targetMinor, s.paidOn])).toEqual([
      ['Visa', 900_000, null],
      ['Deposit', 4_350_000, DAY],
      ['Balance', 6_120_000, null],
    ]);
    const ops = await outboxOps(database);
    expect(ops.filter((o) => o.op === 'delete')).toEqual([]);
    expect(ops.filter((o) => o.entity === 'goal_stage' && o.op === 'upsert' && 'paidOn' in o.fields && o.id === stageId)).toEqual([]);
    expect(ops.find((o) => o.entity === 'goal')).toMatchObject({ op: 'upsert', fields: expect.objectContaining({ name: 'Coast Trip' }) });
    expect(await skipsOf(database)).toEqual([]);
  });

  it("still writes what Bima did change: his own paid mark, a target, a payment he removed", async () => {
    const { database, ws, bookId, goalId, goal, stageId, balanceId } = await sharedTrip('member-f');
    const base = inputOf(goal);
    // Rina renames the deposit meanwhile; Bima changes its target, so her name stays and his target lands.
    await fromDevice(database, bookId, 'dev-r', [{ entity: 'goal_stage', id: stageId, op: 'upsert', fields: { name: 'First payment' } }]);
    const edited = base.stages.filter((s) => s.id !== balanceId).map((s) => (s.id === stageId ? { ...s, targetMinor: 5_000_000, paidOn: DAY } : s));
    await saveGoal(database, ws, { ...base, stages: edited, base });
    const after = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(after.stages.map((s) => [s.id, s.name, s.targetMinor, s.paidOn])).toEqual([[stageId, 'First payment', 5_000_000, DAY]]);
  });

  it('a payment Rina removed meanwhile is not brought back', async () => {
    const { database, ws, bookId, goalId, goal, balanceId } = await sharedTrip('member-f');
    const base = inputOf(goal);
    await fromDevice(database, bookId, 'dev-r', [{ entity: 'goal_stage', id: balanceId, op: 'delete' }]);
    await saveGoal(database, ws, { ...base, name: 'Coast Trip', base });
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)!.stages.map((s) => s.name)).toEqual(['Deposit']);
  });
});
