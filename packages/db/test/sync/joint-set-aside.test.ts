import { isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  adjustSetAsideTx,
  archiveGoal,
  confirmReview,
  createAccount,
  moveSetAside,
  openPocketedAccount,
  removeEarmark,
  saveEarmark,
  saveGoal,
  setJointAccount,
  shareGoal,
} from '../../src/index';
import { itemIdOf, receivedItems } from '../../src/sync/net-worth/summaries';
import { Household, type Device } from './household';

/*
 * What is set aside on a joint account reaches the partner's phone (fix/partner-set-aside). Andi set money aside for
 * the couple's shared goal in his joint account: his Wallet took it off Spending money, but Rina's still counted the
 * account's whole balance. The holder's summary of a joint money account now carries the one total his phone sets
 * aside on it — goals shared or not, sinking funds — never a goal's name; nothing of it on any other account.
 * Here Rina holds the joint account and Andi reads it. Every name and figure is invented.
 */

const today = isoDate();

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina and Andi in one net-worth group. Rina's 'Tabungan Bersama' (Rp 40,000,000) is joint; her wallet is shared only. */
async function sharing() {
  const home = new Household();
  const rina = await home.device('Rina', 'member-Rina', 'IDR', '0.5.0');
  const andi = await home.device('Andi', 'member-Andi', 'IDR', '0.5.0');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  const joint = (
    await createAccount(rina.database, rina.ws, { name: 'Tabungan Bersama', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 40_000_000, openedOn: '2026-01-02' })
  ).id;
  const wallet = (
    await createAccount(rina.database, rina.ws, { name: 'Dompet Harian', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 7_000_000, openedOn: '2026-01-02' })
  ).id;
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total', [rina.usd]: 'hidden', [joint]: 'total', [wallet]: 'total' });
  await confirmReview(andi.database, andi.ws, { [andi.bank]: 'total' });
  await setJointAccount(rina.database, joint, true);
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  return { home, rina, andi, bookId, groupBookId, joint, wallet };
}

/** A goal saved on one phone; shared with the household when `bookId` is given. */
async function goal(d: Device, name: string, bookId?: string): Promise<string> {
  const goalId = await saveGoal(d.database, d.ws, {
    name,
    kind: 'home',
    growthBps: 0,
    returnBps: 0,
    stages: [{ name: 'Uang muka', targetMinor: 90_000_000, targetMonths: null, dueOn: '2029-04-01' }],
  });
  if (bookId) await shareGoal(d.database, d.ws, goalId, bookId);
  return goalId;
}

async function itemOn(d: Device, groupBookId: string, owner: Device, accountId: string) {
  const itemId = await itemIdOf(groupBookId, accountId);
  return (await receivedItems(d.database, groupBookId)).find((i) => i.itemId === itemId && i.owner === owner.memberId);
}

/** The `setAsideMinor` in the holder's own row of the group log: what its phone has sent, or will with the next sync. */
async function sentSetAside(d: Device, groupBookId: string, accountId: string): Promise<unknown> {
  const itemId = await itemIdOf(groupBookId, accountId);
  const [row] = await d.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE item_id = ${itemId}`);
  return (JSON.parse(row![0]) as { setAsideMinor?: unknown }).setAsideMinor;
}

/** Every summary a phone holds, as text: what a goal's name must never be found in. */
async function everythingOn(d: Device): Promise<string> {
  const rows = await d.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items`);
  return rows.map(([json]) => json).join('\n');
}

describe('a joint account’s set-aside on the partner’s phone', () => {
  it('a set-aside for a shared goal travels as one figure, and follows a change, a draw and a take-back', async () => {
    const { home, rina, andi, bookId, groupBookId, joint } = await sharing();
    // Andi shares the goal; Rina puts money of hers toward it, in the joint account.
    const shared = await goal(andi, 'Rumah Cicalengka', bookId);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBeUndefined();

    await saveEarmark(rina.database, rina.ws, { goalId: shared, accountId: joint, amountMinor: 12_500_000 });
    // Sent with the set-aside itself, not only by the next sync's refresh: Rina's own row in the group log has it already.
    expect(await sentSetAside(rina, groupBookId, joint)).toBe(12_500_000);
    await settle(home);
    const item = await itemOn(andi, groupBookId, rina, joint);
    expect(item?.joint).toBe(true);
    expect(item?.balanceMinor).toBe(40_000_000);
    expect(item?.setAsideMinor).toBe(12_500_000);

    await saveEarmark(rina.database, rina.ws, { goalId: shared, accountId: joint, amountMinor: 15_000_000 });
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBe(15_000_000);

    // A draw, as a spend answered from the goal lowers it.
    await rina.database.transaction((tx) => adjustSetAsideTx(tx, rina.ws, shared, joint, -4_000_000));
    expect(await sentSetAside(rina, groupBookId, joint)).toBe(11_000_000);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBe(11_000_000);

    await removeEarmark(rina.database, rina.ws, shared, joint);
    await settle(home);
    const after = await itemOn(andi, groupBookId, rina, joint);
    expect(after).toBeDefined();
    expect(after?.setAsideMinor).toBeUndefined();
    expect(after?.balanceMinor).toBe(40_000_000);
  });

  it('an own goal counts too, in the same one figure, and archiving it takes its part away; no goal name travels', async () => {
    const { home, rina, andi, bookId, groupBookId, joint } = await sharing();
    const shared = await goal(andi, 'Rumah Cicalengka', bookId);
    await settle(home);
    const own = await goal(rina, 'Kursus Pribadi Rina');
    await saveEarmark(rina.database, rina.ws, { goalId: shared, accountId: joint, amountMinor: 10_000_000 });
    await saveEarmark(rina.database, rina.ws, { goalId: own, accountId: joint, amountMinor: 3_000_000 });
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBe(13_000_000);
    expect(await everythingOn(andi)).not.toContain('Kursus Pribadi');

    // Moving part of it between goals on the same account leaves the total as it was.
    await moveSetAside(rina.database, rina.ws, { fromGoalId: own, toGoalId: shared, accountId: joint, amountMinor: 1_000_000 });
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBe(13_000_000);

    await archiveGoal(rina.database, rina.ws, own);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBe(11_000_000);
  });

  it('never travels on an account that is shared but not joint', async () => {
    const { home, rina, andi, bookId, groupBookId, joint, wallet } = await sharing();
    const shared = await goal(andi, 'Rumah Cicalengka', bookId);
    await settle(home);
    await saveEarmark(rina.database, rina.ws, { goalId: shared, accountId: wallet, amountMinor: 2_000_000 });
    await settle(home);
    const item = await itemOn(andi, groupBookId, rina, wallet);
    expect(item).toBeDefined();
    expect(item?.joint).toBeUndefined();
    expect(item?.setAsideMinor).toBeUndefined();
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBeUndefined();
    expect(await everythingOn(andi)).not.toContain('setAsideMinor');

    // Joint switched off: the figure goes with it.
    await saveEarmark(rina.database, rina.ws, { goalId: shared, accountId: joint, amountMinor: 5_000_000 });
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBe(5_000_000);
    await setJointAccount(rina.database, joint, false);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBeUndefined();
  });

  it('a set-aside made before the figure travelled reaches the partner on the next sync, with no repair', async () => {
    const { home, rina, andi, bookId, groupBookId, joint } = await sharing();
    const shared = await goal(andi, 'Rumah Cicalengka', bookId);
    await settle(home);
    // As an older build left it: written, but never marked for a send.
    await rina.database.db.run(
      sql`INSERT INTO goal_earmarks (goal_id, account_id, workspace_id, amount_minor) VALUES (${shared}, ${joint}, ${rina.ws.workspaceId}, ${8_000_000})`,
    );
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBe(8_000_000);
    // Then nothing more goes out while it stays the same.
    const held = await everythingOn(andi);
    await settle(home);
    expect(await everythingOn(andi)).toBe(held);
  });

  it('a malformed figure from a peer reads as nothing set aside', async () => {
    const { home, rina, andi, bookId, groupBookId, joint } = await sharing();
    const shared = await goal(andi, 'Rumah Cicalengka', bookId);
    await settle(home);
    await saveEarmark(rina.database, rina.ws, { goalId: shared, accountId: joint, amountMinor: 6_000_000 });
    await settle(home);
    const itemId = await itemIdOf(groupBookId, joint);
    const [row] = await andi.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE item_id = ${itemId}`);
    const stored = JSON.parse(row![0]) as Record<string, unknown>;
    expect(stored.setAsideMinor).toBe(6_000_000);
    for (const bad of [-5, 1.5, '6000000', null, Number.MAX_SAFE_INTEGER + 2, { minor: 1 }]) {
      await andi.database.db.run(sql`UPDATE nw_items SET summary_json = ${JSON.stringify({ ...stored, setAsideMinor: bad })} WHERE item_id = ${itemId}`);
      const read = await itemOn(andi, groupBookId, rina, joint);
      expect(read?.joint).toBe(true);
      expect(read?.setAsideMinor).toBeUndefined();
    }
    // And only a joint item may carry one.
    await andi.database.db.run(sql`UPDATE nw_items SET summary_json = ${JSON.stringify({ ...stored, joint: undefined })} WHERE item_id = ${itemId}`);
    expect((await itemOn(andi, groupBookId, rina, joint))?.setAsideMinor).toBeUndefined();
  });

  it('a joint pocket carries only its own set-aside, as its balance is its own', async () => {
    const { home, rina, andi, bookId, groupBookId, joint, wallet } = await sharing();
    const { pockets } = await openPocketedAccount(rina.database, rina.ws, {
      item: 'savings',
      name: 'Tabungan Valas',
      pockets: [
        { currency: 'IDR', openingBalanceMinor: 9_000_000 },
        { currency: 'USD', openingBalanceMinor: 300_00, openingRateToBase: 15_900 },
      ],
    });
    const [idr, usd] = pockets as [(typeof pockets)[0], (typeof pockets)[0]];
    await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total', [rina.usd]: 'hidden', [joint]: 'total', [wallet]: 'total', [idr.id]: 'total', [usd.id]: 'total' });
    await setJointAccount(rina.database, idr.id, true);
    await setJointAccount(rina.database, usd.id, true);
    const shared = await goal(andi, 'Rumah Cicalengka', bookId);
    await settle(home);
    await saveEarmark(rina.database, rina.ws, { goalId: shared, accountId: usd.id, amountMinor: 120_00 });
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, usd.id))?.setAsideMinor).toBe(120_00);
    expect((await itemOn(andi, groupBookId, rina, idr.id))?.setAsideMinor).toBeUndefined();
  });
});
