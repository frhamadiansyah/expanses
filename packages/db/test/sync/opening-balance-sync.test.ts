import { isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activeNetWorthGroup, changeOpeningBalance, openCashAccount } from '../../src/index';
import { markReviewedTx } from '../../src/repos/net-worth-sharing';
import { withCapture } from '../../src/sync/capture';
import { encodeHlc } from '../../src/sync/hlc';
import { receivedItems, sendSummariesTx } from '../../src/sync/net-worth/summaries';
import { Household, type Device } from './household';

/*
 * A starting balance changed on the holder's phone (Settings › Balance): the shared item's summary carries the new
 * balance, so the partner's joint net worth moves by the difference after the next sync. Invented figures only.
 */

const today = isoDate();

async function confirmTx(tx: Parameters<Parameters<Device['database']['transaction']>[0]>[0], d: Device, groupBookId: string, proposalId: string): Promise<void> {
  await withCapture(tx, { entity: 'nw_answer', id: `${proposalId}|${d.memberId}`, bookId: groupBookId }, async () => {
    await tx.run(sql`INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, ${proposalId}, ${d.memberId}, 'confirm')`);
  });
}

/** Rina and Andi in one workspace and one confirmed joint net-worth group. */
async function activeGroup() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  const groupBookId = await rina.engine.openGroupLog(bookId);
  await rina.engine.admitToGroupLog(bookId, [andi.memberId]);
  await home.settle();
  await home.settle();
  await rina.database.transaction(async (tx) => {
    await withCapture(tx, { entity: 'nw_proposal', id: 'proposal-1', bookId: groupBookId }, async () => {
      await tx.run(sql`
        INSERT INTO nw_proposals (book_id, proposal_id, mode, members_json, proposed_by, created_hlc, cancelled)
        VALUES (${groupBookId}, 'proposal-1', 'joint', ${JSON.stringify([rina.memberId, andi.memberId])}, ${rina.memberId}, ${encodeHlc(Date.now(), 0, rina.deviceId)}, 0)`);
    });
    await confirmTx(tx, rina, groupBookId, 'proposal-1');
  });
  await home.settle();
  await andi.database.transaction((tx) => confirmTx(tx, andi, groupBookId, 'proposal-1'));
  await home.settle();
  return { home, rina, andi, bookId, groupBookId };
}

async function shareTotal(d: Device, accountId: string): Promise<void> {
  await d.database.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO nw_share_settings (account_id, setting) VALUES (${accountId}, 'total') ON CONFLICT (account_id) DO UPDATE SET setting = excluded.setting`);
    const group = await activeNetWorthGroup(tx);
    if (group) await markReviewedTx(tx, group, today);
    await sendSummariesTx(tx, 'all', today);
  });
}

describe("a changed starting balance on the partner's phone", () => {
  it('moves the shared balance by the difference, and nothing else of the item', async () => {
    const { home, rina, andi, groupBookId } = await activeGroup();
    const account = await openCashAccount(rina.database, rina.ws, { item: 'savings', name: 'Tabungan Contoh', currency: 'IDR', openingBalanceMinor: 4_100_000, openedOn: '2026-02-01' });
    await shareTotal(rina, account.id);
    await home.settle();

    const item = async () => (await receivedItems(andi.database, groupBookId)).find((one) => one.owner === rina.memberId)!;
    const before = await item();
    expect(before).toMatchObject({ balanceMinor: 4_100_000 });

    await changeOpeningBalance(rina.database, rina.ws, account.id, 4_600_000);
    await home.settle();
    const after = await item();
    expect(after.itemId).toBe(before.itemId);
    expect(after).toMatchObject({ balanceMinor: 4_600_000, name: before.name, subtype: before.subtype, currency: 'IDR' });
  });
});
