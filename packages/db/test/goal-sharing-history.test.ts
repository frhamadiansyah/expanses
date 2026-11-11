import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount, type Database, goalHistory, saveEarmark, saveGoal, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

/* Shared goals §9.2, C27: a shared goal's History lists both people's moves, each with who, and the share's own lines.
   Bima's phone; Rina is the partner. */

const TODAY = '2026-11-10';
const BOOK = 'book-home';

// A set-aside is dated by the clock (`recordContributionTx`), and History reads up to TODAY: the clock is TODAY's, or the
// private goal's line falls past it on any later real day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00Z`));
});
afterEach(() => {
  vi.useRealTimers();
});

let database: Database;
let ws: WorkspaceContext;
let goalId: string;
let privateId: string;

async function move(id: string, memberId: string, kind: string, on: string, amountMinor: number, text: string) {
  await database.db.run(sql`INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text)
    VALUES (${id}, ${goalId}, ${ws.workspaceId}, ${memberId}, ${kind}, ${on}, ${amountMinor}, 'IDR', ${text})`);
}
const history = async (id = goalId) => (await goalHistory(database, ws, TODAY, { limit: null }))[id] ?? [];

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  const main = (await createAccount(database, ws, { name: 'Main Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-01-01' })).id;
  const stage = { name: 'All', targetMinor: 90_000_000, targetMonths: null, dueOn: '2030-11-10' };
  goalId = await saveGoal(database, ws, { name: 'Family Trip', kind: 'holiday', growthBps: 0, returnBps: 0, stages: [stage] });
  privateId = await saveGoal(database, ws, { name: 'Laptop', kind: 'holiday', growthBps: 0, returnBps: 0, stages: [stage] });
  await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
  await saveEarmark(database, ws, { goalId: privateId, accountId: main, amountMinor: 1_000_000 });
  await database.db.run(sql`UPDATE goal_contributions SET occurred_on = '2026-11-02' WHERE goal_id = ${goalId}`).catch(() => undefined);
  await database.db.run(sql`INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, created_at)
    VALUES (${BOOK}, ${ws.workspaceId}, 'Home', 'shared', 'IDR', 0, 5, '2026-10-01T00:00:00Z')`);
  await database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${BOOK}, 'relay-1', 1, 'member-b', 'active', '2026-10-01T00:00:00Z')`);
  await database.db.run(sql`INSERT INTO book_members VALUES (${BOOK}, 'member-b', 'Bima', 'owner', '2026-10-01T00:00:00Z')`);
  await database.db.run(sql`INSERT INTO book_members VALUES (${BOOK}, 'member-r', 'Rina', 'member', '2026-10-02T00:00:00Z')`);
  await database.db.run(sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES (${goalId}, ${BOOK}, ${ws.workspaceId}, 'member-b', 'on', '2026-10-05', 1)`);
});

describe('shared goal History', () => {
  it("lists the partner's moves with who", async () => {
    await move('m1', 'member-r', 'set-aside', '2026-11-03', 10_000_000, 'Partner Savings');
    const entries = await history();
    expect(entries.map((e) => [e.kind, e.by, e.amountMinor, e.text, e.occurredOn])).toEqual([
      ['set-aside', 'member-r', 10_000_000, 'Partner Savings', '2026-11-03'],
      ['set-aside', null, 20_000_000, 'Main Savings', expect.any(String)],
    ]);
  });

  it('a spent line carries its description and stage', async () => {
    await move('m2', 'member-r', 'spent', '2026-11-04', -3_000_000, 'Flight tickets');
    expect((await history()).find((e) => e.kind === 'spent')).toMatchObject({ by: 'member-r', amountMinor: -3_000_000, text: 'Flight tickets', currency: 'IDR' });
  });

  it('share lines carry the member and the last total', async () => {
    await database.db.run(sql`INSERT INTO goal_share_log (id, workspace_id, goal_id, kind, member_name, amount_minor, occurred_on) VALUES ('l1', ${ws.workspaceId}, ${goalId}, 'left', 'Rina', 10_000_000, '2026-11-05')`);
    expect((await history()).find((e) => e.kind === 'left')).toMatchObject({ by: null, memberName: 'Rina', amountMinor: 10_000_000, occurredOn: '2026-11-05' });
  });

  it("a private goal's history is unchanged", async () => {
    const all = await history(privateId);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.by === null)).toBe(true);
  });

  it('a member who left has no lines', async () => {
    await move('m3', 'member-r', 'set-aside', '2026-11-03', 10_000_000, 'Partner Savings');
    await database.db.run(sql`INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES (${goalId}, 'member-r', ${ws.workspaceId}, 1, '2026-11-06')`);
    expect((await history()).some((e) => e.by === 'member-r')).toBe(false);
  });

  it("a goal no longer shared shows no partner moves", async () => {
    await move('m4', 'member-r', 'set-aside', '2026-11-03', 10_000_000, 'Partner Savings');
    await database.db.run(sql`UPDATE goal_shares SET state = 'off' WHERE goal_id = ${goalId}`);
    expect((await history()).some((e) => e.by === 'member-r')).toBe(false);
  });
});
