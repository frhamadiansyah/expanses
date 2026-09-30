import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { expenseLines, isoDate } from '@expanses/core';
import { activeNetWorthGroup, confirmReview, createAccount, pendingHidden, postTransaction, reviewedFor, setShareSetting } from '../../src/index';
import { archiveAccount } from '../../src/index';
import { withCapture } from '../../src/sync/capture';
import { SyncEngine } from '../../src/sync/engine';
import { encodeHlc } from '../../src/sync/hlc';
import type { SyncTransport } from '../../src/sync/types';
import { membersNotYetIn, type GroupLogHost } from '../../src/sync/net-worth/group-log';
import { receivedItems } from '../../src/sync/net-worth/summaries';
import { categoryOf, Household, type Device } from './household';

/*
 * Joint net worth end to end (wave 3: task 5's proposals and share settings wired to task 6's summaries). Rina and Andi
 * set up one tax ID through the engine; Sari is in the workspace and never in the group. Nothing is sent before a
 * member's own Share; after it, each receives the other's items; an item Rina had hidden arrives only with her Share;
 * a new item added in joint mode is shared as the add form writes it (D9); Sari never holds a summary.
 */

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

const spend = (d: Device, categoryId: string, amountMinor: number) =>
  postTransaction(d.database, d.ws, {
    occurredOn: isoDate(),
    description: 'Household groceries',
    lines: expenseLines({ categoryAccountId: categoryId, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });

const bankOf = async (d: Device, groupBookId: string, owner: Device) =>
  (await receivedItems(d.database, groupBookId)).find((item) => item.owner === owner.memberId && item.name === `${owner.name} Bank`) ?? null;

/** Rina, Andi and Sari; Rina and Andi active in `mode` and both past their review (Share). */
async function sharing(mode: 'joint' | 'separate') {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode, members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, {});
  await confirmReview(andi.database, andi.ws, {});
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  const groceries = await categoryOf(rina.database, bookId, 'Groceries');
  return { home, rina, andi, sari, bookId, groupBookId, groceries };
}

const namesFrom = async (d: Device, groupBookId: string, owner: string) =>
  (await receivedItems(d.database, groupBookId))
    .filter((item) => item.owner === owner)
    .map((item) => item.name)
    .sort();

describe('joint net worth, end to end', () => {
  it('propose one tax ID, confirm, each Share: both receive the other’s items, a hidden item only after Share, and Sari nothing', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const sari = await home.device('Sari');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.join(sari, rina);
    await home.settle();

    // Before any group, Rina keeps her wallet to herself.
    await setShareSetting(rina.database, rina.cash, 'hidden');

    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    await settle(home);
    const group = await rina.engine.netWorthGroup(bookId);
    expect(group.active).toEqual({ proposalId, mode: 'joint', members: [rina.memberId, andi.memberId] });
    const groupBookId = group.groupBookId!;
    expect((await andi.engine.netWorthGroup(bookId)).active?.proposalId).toBe(proposalId);

    // Active, but nobody has reviewed: nothing is sent (§6 Review).
    expect(await receivedItems(andi.database, groupBookId)).toEqual([]);
    expect(await receivedItems(rina.database, groupBookId)).toEqual([]);
    expect(await pendingHidden(rina.database, rina.ws)).toEqual([rina.cash]);

    // A setting Andi makes before his review (an item page's row) sends nothing yet: the review comes first (§6 Review).
    await setShareSetting(andi.database, andi.bank, 'total');
    await settle(home);
    expect(await receivedItems(rina.database, groupBookId)).toEqual([]);

    // Andi's Share: his items reach Rina; Rina's still reach nobody.
    await confirmReview(andi.database, andi.ws, {});
    await settle(home);
    expect(await namesFrom(rina, groupBookId, andi.memberId)).toEqual(['Andi Bank', 'Andi Dollars', 'Andi Wallet']);
    expect(await receivedItems(andi.database, groupBookId)).toEqual([]);

    // Rina's Share (one tax ID: every item total, D7): her hidden wallet arrives with the rest, and only now.
    await confirmReview(rina.database, rina.ws, {});
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Wallet']);
    expect(await pendingHidden(rina.database, rina.ws)).toEqual([]);

    // D9: an item added in joint mode is written `total` by the add form, and so it is sent.
    const savings = await createAccount(rina.database, rina.ws, { name: 'Rina Savings', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000 });
    await setShareSetting(rina.database, savings.id, 'total');
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Savings', 'Rina Wallet']);
    expect((await receivedItems(andi.database, groupBookId)).find((item) => item.name === 'Rina Savings')).toMatchObject({ balanceMinor: 10_000_000 });

    // Sari is in the workspace, not in the group: she holds no summary, and no group log.
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
    expect(await sari.engine.groupLogOf(bookId)).toBeNull();
  });

  it('the API refuses a Change that adds Sari (adds-members), and nobody lets her into the log (wave 3 round 2)', async () => {
    const { home, rina, andi, sari, bookId, groupBookId } = await sharing('separate');
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] })).rejects.toMatchObject({ code: 'adds-members' });
    await settle(home);
    expect(await sari.engine.groupLogOf(bookId)).toBeNull();
    expect(await sari.database.db.values(sql`SELECT 1 FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).toEqual([]);
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
  });

  it('a crafted Change adding Sari, confirmed by Rina and Andi, never activates, and Sari is never admitted or given a key', async () => {
    const { home, rina, andi, sari, bookId, groupBookId } = await sharing('separate');
    const before = (await rina.engine.netWorthGroup(bookId)).active!;
    const crafted = 'crafted-add-sari';
    const members = [rina.memberId, andi.memberId, sari.memberId];
    await rina.database.transaction(async (tx) => {
      await withCapture(tx, { entity: 'nw_proposal', id: crafted, bookId: groupBookId }, async () => {
        await tx.run(sql`
          INSERT INTO nw_proposals (book_id, proposal_id, mode, members_json, proposed_by, created_hlc, cancelled)
          VALUES (${groupBookId}, ${crafted}, 'separate', ${JSON.stringify(members)}, ${rina.memberId}, ${encodeHlc(Date.now() + 1000, 0, rina.deviceId)}, 0)`);
      });
    });
    for (const d of [rina, andi]) {
      await d.database.transaction((tx) =>
        withCapture(tx, { entity: 'nw_answer', id: `${crafted}|${d.memberId}`, bookId: groupBookId }, async () => {
          await tx.run(sql`INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, ${crafted}, ${d.memberId}, 'confirm')`);
        }),
      );
    }
    await settle(home);
    // Even a direct admit (and every device's auto-admit on sync) lets no device of Sari's in.
    await rina.engine.admitToGroupLog(bookId, [sari.memberId]);
    await andi.engine.admitToGroupLog(bookId, [sari.memberId]);
    await settle(home);
    for (const d of [rina, andi]) {
      const state = await d.engine.netWorthGroup(bookId);
      expect(state.active).toEqual(before);
      expect(state.pending).toBeNull();
    }
    expect(await sari.engine.groupLogOf(bookId)).toBeNull();
    expect(await sari.database.db.values(sql`SELECT 1 FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).toEqual([]);
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
  });

  it('a removal is never held back: Don’t share and archive reach Andi at once while Rina’s review of a new mode waits', async () => {
    const { home, rina, andi, bookId, groupBookId } = await sharing('joint');
    const change = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, change, 'confirm');
    await settle(home);
    expect(await reviewedFor(rina.database, groupBookId, change)).toBe(false);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Wallet']);

    await setShareSetting(rina.database, rina.bank, 'hidden');
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Dollars', 'Rina Wallet']);

    // Even with no review of this log at all on the phone, a removal still goes out.
    await rina.database.db.run(sql`DELETE FROM settings WHERE key LIKE 'nw.reviewed.%'`);
    await archiveAccount(rina.database, rina.ws, rina.cash);
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Dollars']);
  });

  it('a mode change with the same members asks for the review again; live items keep refreshing, a new item waits for Share', async () => {
    const { home, rina, andi, bookId, groupBookId, groceries } = await sharing('separate');
    const change = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, change, 'confirm');
    await settle(home);
    expect((await activeNetWorthGroup(rina.database))?.mode).toBe('joint');
    expect(await reviewedFor(rina.database, groupBookId, change)).toBe(false);

    // Nobody was added: a live item's refresh still goes out.
    await spend(rina, groceries, 2_000_000);
    await settle(home);
    expect(await bankOf(andi, groupBookId, rina)).toMatchObject({ balanceMinor: -2_000_000 });

    // A new item is not live yet: it waits for Share.
    const savings = await createAccount(rina.database, rina.ws, { name: 'Rina Savings', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000 });
    await setShareSetting(rina.database, savings.id, 'total');
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).not.toContain('Rina Savings');

    await confirmReview(rina.database, rina.ws, {});
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toContain('Rina Savings');
  });

  it('Sari, asked and declining, is taken out of the log once the pair activates: no current key, no summaries (round 3, A)', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const sari = await home.device('Sari');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.join(sari, rina);
    await home.settle();
    const three = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    await settle(home);
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    expect(await sari.engine.groupLogOf(bookId)).toBe(groupBookId); // let in to be asked
    await sari.engine.answerNetWorth(bookId, three, 'decline');
    await settle(home);
    const pair = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, pair, 'confirm');
    await settle(home);
    await confirmReview(rina.database, rina.ws, {});
    await confirmReview(andi.database, andi.ws, {});
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Wallet']);

    const [[current]] = (await rina.database.db.values<[number]>(sql`SELECT max(epoch) FROM book_epoch_keys WHERE book_id = ${groupBookId}`)) as [[number]];
    const sariEpochs = (await sari.database.db.values<[number]>(sql`SELECT epoch FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).map(([e]) => Number(e));
    expect(sariEpochs).not.toContain(Number(current));
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
    // And nothing after.
    await setShareSetting(rina.database, rina.bank, 'hidden');
    await setShareSetting(rina.database, rina.bank, 'total');
    await settle(home);
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
  });

  it('Share right after the activation, with no settle between: nothing is sealed under a key Sari holds, and the items go out after (round 4)', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const sari = await home.device('Sari');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.join(sari, rina);
    await home.settle();
    const three = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    await settle(home);
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    expect(await sari.engine.groupLogOf(bookId)).toBe(groupBookId);
    await sari.engine.answerNetWorth(bookId, three, 'decline');
    await settle(home);
    const pair = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
    await settle(home);
    const [[relayBookId]] = (await andi.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${groupBookId}`)) as [[string]];
    const sariEpochs = new Set((await sari.database.db.values<[number]>(sql`SELECT epoch FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).map(([e]) => Number(e)));
    expect(sariEpochs.size).toBeGreaterThan(0);

    // Andi's yes activates the pair on his phone, and he presses Share at once: no sync of anyone in between.
    await andi.engine.answerNetWorth(bookId, pair, 'confirm');
    const activatedAt = home.relay.peek(relayBookId)!.seq;
    await confirmReview(andi.database, andi.ws, {});
    // Andi's phone syncs first, so whatever his Share queued is drained before anyone else acts.
    await home.settle([andi, rina, sari]);
    await settle(home);
    await confirmReview(rina.database, rina.ws, {});
    await settle(home);

    const log = home.relay.peek(relayBookId)!.log;
    const sealedAfter = [...log.entries()].filter(([seq, entry]) => seq > activatedAt && entry.kind === 'change');
    expect(sealedAfter.length).toBeGreaterThan(0);
    expect(sealedAfter.filter(([, entry]) => sariEpochs.has(entry.epoch)).map(([seq]) => seq)).toEqual([]);
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
    // What the Share held back went out once Sari was out.
    expect(await namesFrom(rina, groupBookId, andi.memberId)).toEqual(['Andi Bank', 'Andi Dollars', 'Andi Wallet']);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Wallet']);
  });

  it('a summary already queued when the pair activates is sealed only under the key after Sari’s removal (round 4)', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const sari = await home.device('Sari');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.join(sari, rina);
    await home.settle();
    const three = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    await settle(home);
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    await sari.engine.answerNetWorth(bookId, three, 'decline');
    await settle(home);
    const pair = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
    await settle(home);
    const [[relayBookId]] = (await andi.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${groupBookId}`)) as [[string]];
    const sariEpochs = new Set((await sari.database.db.values<[number]>(sql`SELECT epoch FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).map(([e]) => Number(e)));
    const before = home.relay.peek(relayBookId)!.seq;
    // Andi's yes activates the pair on his phone, and a summary op is queued with it (past every send-side check):
    // both wait in his outbox, no sync in between.
    await andi.database.transaction(async (tx) => {
      await withCapture(tx, { entity: 'nw_answer', id: `${pair}|${andi.memberId}`, bookId: groupBookId }, async () => {
        await tx.run(sql`INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, ${pair}, ${andi.memberId}, 'confirm')`);
      });
      await withCapture(tx, { entity: 'nw_item', id: 'queued-item', bookId: groupBookId }, async () => {
        await tx.run(sql`INSERT INTO nw_items (book_id, item_id, owner, summary_json, removed) VALUES (${groupBookId}, 'queued-item', ${andi.memberId}, '{"name":"Queued"}', 0)`);
      });
    });
    expect((await activeNetWorthGroup(andi.database))?.proposalId).toBe(pair);
    await home.settle([andi, rina, sari]);
    await settle(home);

    const sealedAfter = [...home.relay.peek(relayBookId)!.log.entries()].filter(([seq, entry]) => seq > before && entry.kind === 'change');
    const leaked = sealedAfter.filter(([, entry]) => sariEpochs.has(entry.epoch));
    expect(leaked.map(([seq]) => seq)).toEqual([]);
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
    expect((await receivedItems(rina.database, groupBookId)).map((i) => i.itemId)).toContain('queued-item');
  });

  it('an invite that failed to go out is sent on the next sync, and the proposal goes on (round 3, C)', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.settle();
    let fail = true;
    const real = rina.transport;
    const flaky: SyncTransport = Object.assign(Object.create(real) as SyncTransport, {
      putInvite: async (...args: Parameters<SyncTransport['putInvite']>) => {
        if (fail) {
          fail = false;
          throw new Error('relay unreachable');
        }
        return real.putInvite(...args);
      },
    });
    rina.engine = new SyncEngine(rina.database, flaky, rina.keys);
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] })).rejects.toThrow('relay unreachable');
    const pending = (await rina.engine.netWorthGroup(bookId)).pending!;
    await settle(home);
    expect(await andi.engine.groupLogOf(bookId)).not.toBeNull();
    await andi.engine.answerNetWorth(bookId, pending.proposalId, 'confirm');
    await settle(home);
    expect((await andi.engine.netWorthGroup(bookId)).active?.proposalId).toBe(pending.proposalId);
  });

  it('an invitee taken out of the workspace is not asked into the log again on every sync (round 4, minor)', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const sari = await home.device('Sari');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.join(sari, rina);
    await home.settle();
    await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    // Andi joins the log; Sari is taken out of the workspace before her phone ever took its invite.
    for (let i = 0; i < 3; i += 1) await home.settle([rina, andi]);
    await rina.engine.removeDevice(bookId, sari.deviceId);
    for (let i = 0; i < 3; i += 1) await home.settle([rina, andi]);
    expect(await sari.database.db.values(sql`SELECT 1 FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).toEqual([]);
    const host = { database: rina.database } as GroupLogHost;
    // Andi's device is in the log; Sari is still on the pending proposal but has no device left in the workspace.
    expect(await membersNotYetIn(host, bookId, groupBookId, [rina.memberId, andi.memberId, sari.memberId])).toEqual([]);
  });

  it('before any activation only the pending proposal’s members are let in: a device of Sari, who declined, is not (round 3, B)', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const sari = await home.device('Sari');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.join(sari, rina);
    await home.settle();
    const withSari = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [sari.memberId] });
    await settle(home);
    await sari.engine.answerNetWorth(bookId, withSari, 'decline');
    await settle(home);
    await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    // Sari's new iPad joins the workspace; nobody lets it into the group log, asked or on its own.
    const pad = await home.device('SariPad', sari.memberId);
    const { code } = await rina.engine.createInvite(bookId, { inviterName: 'Rina', sameMember: true, memberId: sari.memberId });
    await pad.engine.joinBook(code, { ws: pad.ws, memberName: 'Sari', deviceName: "Sari's iPad" });
    await settle(home);
    await rina.engine.admitToGroupLog(bookId, [sari.memberId]);
    await settle(home);
    expect(await pad.engine.groupLogOf(bookId)).toBeNull();
    expect(await andi.engine.groupLogOf(bookId)).not.toBeNull();
  });
});
