import { type SQL, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  goalPlansFor,
  goalShareOf,
  goalShareTargets,
  listEarmarks,
  listGoals,
  saveEarmark,
  saveGoal,
  setStandingMonthly,
  shareGoal,
  type Database,
} from '../../src/index';
import { withCapture } from '../../src/sync/capture';
import { localDate } from '../../src/sync/net-worth/summaries';
import { Household, skipsOf, type Device } from './household';

/*
 * Final review C1: a member who leaves the household workspace, or whose last device an owner removes, stops counting
 * in every shared goal on every phone still in it — their lines, planned monthly and History go, as for a goal Leave
 * (C13), with a "Rina left" line. When that member is the goal's sharer nobody left could turn it off (D10), so the
 * goal ends there as the household share ending does (C15): each remaining member with money of their own keeps a
 * private copy, and the link goes.
 */

const today = () => localDate(Date.now());

async function rowsOf(database: Database, table: string, where: SQL = sql`1 = 1`): Promise<Record<string, unknown>[]> {
  const columns = (await database.db.values<[string]>(sql`SELECT name FROM pragma_table_info(${table})`)).map((row) => row[0]);
  const rows = await database.db.values<unknown[]>(sql`SELECT ${sql.raw(columns.join(', '))} FROM ${sql.raw(table)} WHERE ${where}`);
  return rows.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

const logOf = (database: Database, goalId: string) => rowsOf(database, 'goal_share_log', sql`goal_id = ${goalId} ORDER BY occurred_on, id`);

/** A savings account of the device's own holding 20_000_000, so a set-aside of up to that much is counted whole. */
async function savingsOf(device: Device): Promise<string> {
  const account = await createAccount(device.database, device.ws, { name: `${device.name} Savings`, kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-01-01' });
  return account.id;
}

async function rename(device: Device, goalId: string, name: string): Promise<void> {
  await device.database.transaction((tx) => withCapture(tx, { entity: 'goal', id: goalId }, () => tx.run(sql`UPDATE goals SET name = ${name} WHERE id = ${goalId}`)));
}

/** Bima (owner), Rina and Adi in one household on 0.5.0; `sharer` shares 'Trip Fund' and the other two hold money in it. */
async function household(sharer: 'Bima' | 'Rina') {
  const h = new Household();
  const bima = await h.device('Bima', 'member-Bima', 'IDR', '0.5.0');
  const rina = await h.device('Rina', 'member-Rina', 'IDR', '0.5.0');
  const adi = await h.device('Adi', 'member-Adi', 'IDR', '0.5.0');
  const bookId = await h.share(bima);
  await h.join(rina, bima);
  await h.join(adi, bima);
  await h.settle();
  const owner = sharer === 'Bima' ? bima : rina;
  const goalId = await saveGoal(owner.database, owner.ws, {
    name: 'Trip Fund',
    kind: 'holiday',
    growthBps: 0,
    returnBps: 0,
    stages: [{ name: 'Trip', targetMinor: 48_000_000, targetMonths: null, dueOn: '2030-11-01' }],
  });
  await shareGoal(owner.database, owner.ws, goalId, bookId);
  await h.settle();
  return { h, bima, rina, adi, bookId, goalId };
}

describe('a member leaves the household workspace (C1)', () => {
  for (const how of ['leaves', 'is removed'] as const) {
    it(`Rina ${how}: every remaining phone drops her money and plan, and says she left`, async () => {
      const { h, bima, rina, adi, bookId, goalId } = await household('Bima');
      await saveEarmark(rina.database, rina.ws, { goalId, accountId: await savingsOf(rina), amountMinor: 10_000_000 });
      await setStandingMonthly(rina.database, rina.ws, goalId, 1_000_000);
      await h.settle();
      const before = (await goalPlansFor(bima.database, bima.ws, today())).plans.find((plan) => plan.goalId === goalId)!;
      expect(before.currentMinor).toBe(10_000_000);
      expect(before.othersPlannedMonthlyMinor).toBe(1_000_000);

      if (how === 'leaves') await rina.engine.leave(bookId);
      else await bima.engine.removeDevice(bookId, rina.deviceId);
      await h.settle([bima, adi]);

      for (const d of [bima, adi]) {
        expect(await rowsOf(d.database, 'goal_member_funding', sql`member_id = 'member-Rina'`)).toEqual([]);
        expect(await rowsOf(d.database, 'goal_member_moves', sql`member_id = 'member-Rina'`)).toEqual([]);
        const plan = (await goalPlansFor(d.database, d.ws, today())).plans.find((row) => row.goalId === goalId)!;
        expect(plan.currentMinor).toBe(0);
        expect(plan.othersPlannedMonthlyMinor).toBe(0);
        // The whole need is planned for again on this phone (C20): nothing of Rina's is taken off it.
        expect(plan.ownNeededMonthlyMinor).toBe(plan.requiredMonthlyMinor);
        expect(plan.links.filter((link) => link.owner === 'member-Rina')).toEqual([]);
        expect((await goalShareOf(d.database, goalId))!.state).toBe('on');
        expect((await goalShareOf(d.database, goalId))!.members.map((m) => m.name)).toEqual(['Bima', 'Adi']);
        expect(await skipsOf(d.database)).toEqual([]);
      }
      expect((await logOf(bima.database, goalId)).filter((line) => line.kind === 'left')).toEqual([expect.objectContaining({ member_name: 'Rina', amount_minor: 10_000_000 })]);
      expect((await logOf(adi.database, goalId)).filter((line) => line.kind === 'left')).toEqual([expect.objectContaining({ member_name: 'Rina', amount_minor: 10_000_000 })]);
      // The switch and its label name only who is still here (C31).
      expect((await goalShareTargets(bima.database))[0]!.others).toEqual([{ memberId: 'member-Adi', name: 'Adi' }]);
    });
  }

  it('the sharer leaves a household of three: the share ends for the other two, each with money keeping a copy', async () => {
    const { h, bima, rina, adi, bookId, goalId } = await household('Rina');
    const bimaSavings = await savingsOf(bima);
    await saveEarmark(bima.database, bima.ws, { goalId, accountId: bimaSavings, amountMinor: 10_000_000 });
    await h.settle();
    expect((await goalPlansFor(adi.database, adi.ws, today())).plans.find((plan) => plan.goalId === goalId)!.currentMinor).toBe(10_000_000);

    await rina.engine.leave(bookId);
    // Adi edits the goal before his phone hears of it: in log order after the leave, it is dropped as ended everywhere.
    await rename(adi, goalId, 'Coast Trip');
    await h.settle([bima, adi]);

    // Bima's money stays his: a private copy under a new id, the shared goal gone from his list.
    const [copy, ...more] = await listGoals(bima.database, bima.ws);
    expect(more).toEqual([]);
    expect(copy!.id).not.toBe(goalId);
    expect(copy!.name).toBe('Trip Fund');
    expect(await listEarmarks(bima.database, bima.ws)).toEqual([{ goalId: copy!.id, accountId: bimaSavings, amountMinor: 10_000_000 }]);
    expect(await logOf(bima.database, copy!.id)).toEqual([expect.objectContaining({ kind: 'unshared', member_name: 'Rina', copied_from: goalId })]);
    // Adi had nothing of his own in it: the goal just goes, with no empty copy.
    expect(await listGoals(adi.database, adi.ws)).toEqual([]);
    for (const d of [bima, adi]) {
      expect(await goalShareOf(d.database, goalId)).toBeNull();
      for (const table of ['goal_shares', 'goal_share_leaves', 'goal_member_funding', 'goal_member_moves']) expect(await rowsOf(d.database, table)).toEqual([]);
      expect(await skipsOf(d.database)).toEqual([]);
    }
    // The copy is an ordinary goal: money can go on being set aside for it.
    await expect(saveEarmark(bima.database, bima.ws, { goalId: copy!.id, accountId: bimaSavings, amountMinor: 12_000_000 })).resolves.toBeUndefined();
    // Rina's own phone ended the household share as C15 says: her goal stays hers, private.
    expect((await listGoals(rina.database, rina.ws)).map((g) => g.id)).toEqual([goalId]);
  });

  it("a member's second device going leaves the member in", async () => {
    const { h, bima, rina, adi, bookId, goalId } = await household('Bima');
    const tablet = await h.device('RinaTablet', 'member-Rina', 'IDR', '0.5.0');
    const { code } = await bima.engine.createInvite(bookId, { inviterName: 'Bima', sameMember: true, memberId: rina.memberId });
    await tablet.engine.joinBook(code, { ws: tablet.ws, memberName: 'Rina', deviceName: "Rina's tablet", memberId: rina.memberId });
    await h.settle();
    await saveEarmark(rina.database, rina.ws, { goalId, accountId: await savingsOf(rina), amountMinor: 10_000_000 });
    await h.settle();
    await bima.engine.removeDevice(bookId, tablet.deviceId);
    await h.settle([bima, rina, adi]);
    for (const d of [bima, adi]) {
      expect((await goalPlansFor(d.database, d.ws, today())).plans.find((plan) => plan.goalId === goalId)!.currentMinor).toBe(10_000_000);
      expect((await logOf(d.database, goalId)).filter((line) => line.kind === 'left')).toEqual([]);
    }
  });
});
