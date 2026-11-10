import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount, personalBook, postTransaction, removeEarmark, saveEarmark, saveGoal, setStandingMonthly, upsertRate, voidTransaction, type Database } from '../../src/index';
import { applyChangeSet } from '../../src/sync/apply';
import { configureCapture } from '../../src/sync/capture';
import { resendGoalSummaries } from '../../src/sync/goals/summaries';
import { encodeHlc } from '../../src/sync/hlc';
import type { NodeExecutor } from '../../src/node';
import type { Op } from '../../src/sync/types';
import { setupDb } from '../helpers';
import { clearOutbox, outboxOps } from './sync-helpers';

/* What a member's phone sends when their own money for a shared goal changes (shared goals §8.5). Bima (member-f) is
   this phone; Rina (member-r) is the other member of the household. */

const DAY = '2026-11-10';
let executor: NodeExecutor | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
});
afterEach(() => {
  vi.useRealTimers();
  executor?.close();
  executor = undefined;
});

async function world(share = true) {
  const t = await setupDb();
  executor = t.executor;
  const { database, ws } = t;
  const bookId = (await personalBook(database, ws)).id;
  configureCapture(database, { standInDeviceId: true });
  await database.db.run(sql`
    INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${`relay-${bookId}`}, 1, 'member-f', 'active', '2030-01-01T00:00:00Z')
    ON CONFLICT (book_id) DO UPDATE SET member_id = excluded.member_id`);
  await database.execScript(`
    INSERT INTO sync_authority (book_id, member_id, role, role_hlc, deleted, row_hlc) VALUES ('${bookId}', 'member-f', 'owner', '0', 0, '0'), ('${bookId}', 'member-r', 'member', '0', 0, '0');
    INSERT INTO sync_authority_devices (book_id, device_id, member_id, removed_seq, added_seq) VALUES ('${bookId}', 'dev-f', 'member-f', NULL, 1), ('${bookId}', 'dev-r', 'member-r', NULL, 2);
  `);
  const acct = (name: string, openingBalanceMinor: number, currency = 'IDR') =>
    createAccount(database, ws, { name, kind: 'asset', subtype: 'savings', currency, openingBalanceMinor, openedOn: '2026-01-01', openingRateToBase: currency === 'IDR' ? undefined : 16_000 });
  const main = await acct('Main Savings', 30_000_000);
  const other = await acct('Spare Savings', 4_000_000);
  const dollars = await acct('Travel Dollars', 10_000, 'USD');
  const travel = await createAccount(database, ws, { name: 'Travel', kind: 'expense', subtype: 'category', currency: null });
  const goalId = await saveGoal(database, ws, {
    name: 'Trip Fund',
    kind: 'holiday',
    growthBps: 0,
    returnBps: 0,
    stages: [{ name: 'Flights', targetMinor: 60_000_000, targetMonths: null, dueOn: '2031-03-01' }],
  });
  if (share) {
    await database.execScript(
      `INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES ('${goalId}', '${bookId}', '${ws.workspaceId}', 'member-f', 'on', '2030-02-01', 1)`,
    );
  }
  await clearOutbox(database);
  return { database, ws, bookId, main: main.id, other: other.id, dollars: dollars.id, travel: travel.id, goalId };
}

const goalOps = async (database: Database, entity: string) => (await outboxOps(database)).filter((o) => o.entity === entity);
const linesOf = (op: Op | undefined) => JSON.parse(String(op && op.op === 'upsert' ? op.fields.lines : '[]')) as { name: string; amountMinor: number | null }[];

const fundingOps = (database: Database) => goalOps(database, 'goal_member_funding');

describe('a member\'s own money changing sends the summary', () => {
  it('a set-aside on a shared goal sends this member\'s line', async () => {
    const { database, ws, main, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    const op = (await fundingOps(database))[0];
    expect(op).toMatchObject({ id: `${goalId}|member-f`, op: 'upsert' });
    expect(linesOf(op)).toEqual([expect.objectContaining({ name: 'Main Savings', amountMinor: 20_000_000 })]);
    // The set-aside also leaves a History line, named by its source.
    const moves = await goalOps(database, 'goal_member_move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ op: 'upsert', fields: expect.objectContaining({ memberId: 'member-f', kind: 'set-aside', amountMinor: 20_000_000, text: 'Main Savings' }) });
  });

  it('spending from the account below the promise sends the lower figure', async () => {
    const { database, ws, main, travel, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    await clearOutbox(database);
    await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'Flight deposit',
      lines: expenseLines({ categoryAccountId: travel, paymentAccountId: main, amountMinor: 25_000_000, currency: 'IDR' }),
    });
    const ops = await fundingOps(database);
    expect(ops).toHaveLength(1);
    expect(linesOf(ops[0])[0]!.amountMinor).toBe(5_000_000);
  });

  it('taking back the promise sends an empty list and removes the move', async () => {
    const { database, ws, main, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    await clearOutbox(database);
    await removeEarmark(database, ws, goalId, main);
    expect(linesOf((await fundingOps(database))[0])).toEqual([]);
    const moves = await goalOps(database, 'goal_member_move');
    expect(moves.map((m) => m.op)).toEqual(['upsert']);
    expect(moves[0]).toMatchObject({ fields: expect.objectContaining({ kind: 'taken-back', amountMinor: -20_000_000 }) });
  });

  it('a change of the standing monthly amount sends the planned figure', async () => {
    const { database, ws, main, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 1_000_000 });
    await clearOutbox(database);
    await setStandingMonthly(database, ws, goalId, 750_000);
    const op = (await fundingOps(database))[0];
    expect(op).toMatchObject({ op: 'upsert', fields: expect.objectContaining({ plannedMonthlyMinor: 750_000 }) });
  });

  it('a set-aside voided with its spend sends the figure again and drops the spend line', async () => {
    const { database, ws, main, travel, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 10_000_000 });
    const spendId = await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'Flight deposit',
      lines: expenseLines({ categoryAccountId: travel, paymentAccountId: main, amountMinor: 2_000_000, currency: 'IDR' }),
      setAside: { accountId: main, goalId, intent: 'spend', overMinor: 2_000_000 },
    });
    expect(linesOf((await fundingOps(database)).at(-1))[0]!.amountMinor).toBe(8_000_000);
    await clearOutbox(database);
    await voidTransaction(database, ws, spendId);
    expect(linesOf((await fundingOps(database)).at(-1))[0]!.amountMinor).toBe(10_000_000);
    expect((await goalOps(database, 'goal_member_move')).map((m) => m.op)).toEqual(['delete']);
  });

  it('a goal not shared sends nothing', async () => {
    const { database, ws, main, goalId } = await world(false);
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    expect((await outboxOps(database)).filter((o) => o.entity.startsWith('goal'))).toEqual([]);
  });

  it('an unchanged summary is not sent again', async () => {
    const { database, ws, main, other, goalId } = await world();
    await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
    await clearOutbox(database);
    // Money moves on an account the goal has no promise on: nothing for the goal.
    await saveEarmark(database, ws, { goalId: await saveGoal(database, ws, { name: 'Own', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'S', targetMinor: 1_000_000, targetMonths: null, dueOn: '2031-01-01' }] }), accountId: other, amountMinor: 1_000_000 });
    expect((await outboxOps(database)).filter((o) => o.entity.startsWith('goal_member'))).toEqual([]);
  });
});

describe('a second phone and the daily resend', () => {
  it('a second device of the same member, with no money of its own, writes nothing', async () => {
    const { database, ws, bookId, main, goalId } = await world();
    // Bima's other phone sent his summary; this phone has no promise of its own for the goal.
    await applyChangeSet(database, bookId, {
      v: 1,
      hlc: encodeHlc(Date.now(), 1, 'dev-f'),
      member: 'member-f',
      ops: [
        { entity: 'goal_member_funding', id: `${goalId}|member-f`, op: 'upsert', fields: { lines: JSON.stringify([{ ref: 'r1', name: 'Main Savings', kind: 'earmark', amountMinor: 20_000_000, risk: null }]), plannedMonthlyMinor: 0, asOf: DAY } },
      ],
    });
    await clearOutbox(database);
    // Any own transaction on an account (no promise of this phone's) leaves the applied summary alone.
    await database.transaction(async (tx) => {
      await tx.run(sql`UPDATE goals SET name = name WHERE id = ${goalId}`);
    });
    await resendGoalSummaries(database, DAY);
    expect((await outboxOps(database)).filter((o) => o.entity.startsWith('goal_member'))).toEqual([]);
    const [row] = await database.db.values<[string]>(sql`SELECT lines_json FROM goal_member_funding WHERE goal_id = ${goalId} AND member_id = 'member-f'`);
    expect(JSON.parse(row![0])[0].amountMinor).toBe(20_000_000);
    void ws;
    void main;
  });

  it('the daily resend sends only a change', async () => {
    const { database, ws, dollars, goalId } = await world();
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: DAY, rate: 16_000, source: 'manual', sourceDate: DAY });
    await saveEarmark(database, ws, { goalId, accountId: dollars, amountMinor: 10_000 });
    expect(linesOf((await fundingOps(database)).at(-1))[0]!.amountMinor).toBe(1_600_000);
    expect(await resendGoalSummaries(database, DAY)).toBe(0);
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-11-11', rate: 16_500, source: 'manual', sourceDate: '2026-11-11' });
    await clearOutbox(database);
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    expect(await resendGoalSummaries(database, '2026-11-11')).toBe(1);
    expect(linesOf((await fundingOps(database))[0])[0]!.amountMinor).toBe(1_650_000);
  });
});
