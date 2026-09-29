import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, getShareSetting, pendingHidden, setShareSetting } from '../../src/index';
import { withCapture } from '../../src/sync/capture';
import { encodeHlc } from '../../src/sync/hlc';
import type { ChangeSet } from '../../src/sync/types';
import { Household, type Device } from './household';

/*
 * The net-worth group's proposals and answers (joint-net-worth spec §6, task 5), on real devices over one relay. Rina
 * and Andi are the couple; Sari (the adult son) is in the workspace and never in the group.
 */

async function household(versions: { sari?: string } = {}) {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari', undefined, undefined, versions.sari);
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await home.settle();
  return { home, rina, andi, sari, bookId };
}

/** Settles until the group log's invites are claimed and every introduction is in: three rounds. */
async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina proposes, Andi confirms: an active group in `mode`. */
async function active(mode: 'joint' | 'separate' = 'joint') {
  const h = await household();
  const proposalId = await h.rina.engine.proposeNetWorth(h.bookId, { mode, members: [h.andi.memberId] });
  await settle(h.home);
  await h.andi.engine.answerNetWorth(h.bookId, proposalId, 'confirm');
  await settle(h.home);
  return { ...h, proposalId };
}

const linkOf = async (d: Device, bookId: string) =>
  (await d.database.db.values<[string, string]>(sql`SELECT group_book_id, relay_book_id FROM group_logs WHERE book_id = ${bookId}`))[0] ?? null;

const pendingOf = async (d: Device, groupBookId: string, memberId: string) =>
  (await d.database.db.values<[number]>(sql`SELECT count FROM nw_pending WHERE book_id = ${groupBookId} AND member_id = ${memberId}`))[0]?.[0] ?? null;

describe('proposals and answers (joint-net-worth §6)', () => {
  it('Rina proposes one tax ID, Andi is asked, confirms, and both phones derive the same active group', async () => {
    const { home, rina, andi, bookId } = await household();
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    const waiting = await rina.engine.netWorthGroup(bookId);
    expect(waiting.active).toBeNull();
    expect(waiting.pending?.proposalId).toBe(proposalId);
    expect(waiting.waitingFor).toEqual([andi.memberId]);
    expect(waiting.me).toBe(rina.memberId);

    await settle(home);
    const asked = await andi.engine.netWorthGroup(bookId);
    expect(asked.groupBookId).toBe(waiting.groupBookId);
    expect(asked.pending?.proposedBy).toBe(rina.memberId);
    expect(asked.waitingFor).toEqual([andi.memberId]);

    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    await settle(home);
    for (const d of [rina, andi]) {
      const group = await d.engine.netWorthGroup(bookId);
      expect(group.active).toEqual({ proposalId, mode: 'joint', members: [rina.memberId, andi.memberId] });
      expect(group.pending).toBeNull();
    }
  });

  it('a decline or a cancel of an active proposal is refused; only leaving follows it', async () => {
    const { rina, andi, bookId, proposalId } = await active();
    await expect(andi.engine.answerNetWorth(bookId, proposalId, 'decline')).rejects.toMatchObject({ code: 'activated' });
    await expect(rina.engine.cancelNetWorth(bookId, proposalId)).rejects.toMatchObject({ code: 'activated' });
    expect((await andi.engine.netWorthGroup(bookId)).active?.proposalId).toBe(proposalId);
  });

  it('one tax ID for three people is invalid, and nothing is made', async () => {
    const { rina, andi, sari, bookId } = await household();
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId, sari.memberId] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: ['member-nobody'] })).rejects.toMatchObject({ code: 'invalid' });
    expect(await linkOf(rina, bookId)).toBeNull();
  });

  it("a member's device on an old app blocks setup and is named", async () => {
    const { rina, sari, bookId } = await household({ sari: '0.2.0' });
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [sari.memberId] })).rejects.toMatchObject({
      code: 'not-ready',
      outdated: [{ memberId: sari.memberId, deviceName: "Sari's phone" }],
    });
  });

  it('the proposer may cancel a proposal not yet active; anyone else may not', async () => {
    const { home, rina, andi, sari, bookId } = await household();
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await expect(andi.engine.cancelNetWorth(bookId, proposalId)).rejects.toMatchObject({ code: 'not-proposer' });
    await rina.engine.cancelNetWorth(bookId, proposalId);
    await settle(home);
    // Nothing active or waiting: the log is gone and the link closed, so setting up again works — Sari included.
    for (const d of [rina, andi]) expect(await d.engine.groupLogOf(bookId)).toBeNull();
    for (const d of [rina, andi, sari]) expect((await linkOf(d, bookId))?.[1]).toMatch(/^closed:/);
    await sari.engine.proposeNetWorth(bookId, { mode: 'separate', members: [rina.memberId] });
    await settle(home);
    expect((await rina.engine.netWorthGroup(bookId)).pending?.proposedBy).toBe(sari.memberId);
  });
});

describe('dissolving a group (§6: fewer than two members left)', () => {
  it('Andi stops sharing: the log is deleted on both phones, the link is closed everywhere, and a new setup works', async () => {
    const { home, rina, andi, sari, bookId } = await active();
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    const [, relayBookId] = (await linkOf(rina, bookId))!;
    await andi.engine.leaveNetWorth(bookId);
    await settle(home);
    for (const d of [rina, andi]) {
      expect(await d.engine.groupLogOf(bookId)).toBeNull();
      expect((await d.engine.netWorthGroup(bookId)).active).toBeNull();
      expect(await d.database.db.values(sql`SELECT 1 FROM nw_proposals WHERE book_id = ${groupBookId}`)).toEqual([]);
    }
    for (const d of [rina, andi, sari]) {
      const [group, relay] = (await linkOf(d, bookId))!;
      expect(group).toBe(groupBookId);
      expect(relay).toMatch(/^closed:/);
      expect(await d.database.db.values(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${bookId}`)).toEqual([]);
    }
    expect(home.relay.peek(relayBookId)!.deleted).toBe(true);

    const again = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, again, 'confirm');
    await settle(home);
    const regrouped = await andi.engine.netWorthGroup(bookId);
    expect(regrouped.active?.mode).toBe('separate');
    expect(regrouped.groupBookId).not.toBe(groupBookId);
  });

  it("an outsider can neither delete nor close the link: refused at capture and on every peer", async () => {
    const { home, rina, andi, sari, bookId } = await active();
    const before = await linkOf(rina, bookId);
    await expect(
      sari.database.transaction((tx) =>
        withCapture(tx, { entity: 'net_worth_group', id: bookId, bookId }, async () => {
          await tx.run(sql`DELETE FROM group_logs WHERE book_id = ${bookId}`);
        }),
      ),
    ).rejects.toThrow(/AUTHORITY: write-once/);
    await expect(
      sari.database.transaction((tx) =>
        withCapture(tx, { entity: 'net_worth_group', id: bookId, bookId }, async () => {
          await tx.run(sql`UPDATE group_logs SET relay_book_id = 'closed:not-the-proof' WHERE book_id = ${bookId}`);
        }),
      ),
    ).rejects.toThrow(/AUTHORITY: write-once/);
    // A modified client sends them anyway.
    await send(home, sari, { entity: 'net_worth_group', id: bookId, op: 'upsert', fields: { relayBookId: 'closed:not-the-proof' }, changed: ['relayBookId'] });
    await send(home, sari, { entity: 'net_worth_group', id: bookId, op: 'delete' });
    await settle(home);
    for (const d of [rina, andi]) {
      expect(await linkOf(d, bookId)).toEqual(before);
      expect((await d.engine.netWorthGroup(bookId)).active?.mode).toBe('joint');
    }
    expect(await linkOf(sari, bookId)).toEqual(before);
  });
});

/** An op signed by `from`'s real key and appended straight to the workspace's relay log. */
async function send(home: Household, from: Device, op: ChangeSet['ops'][number]): Promise<void> {
  const cs: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 1_000, 0, from.deviceId), member: from.memberId, ops: [op] };
  const [[epoch]] = (await from.database.db.values<[number]>(sql`SELECT epoch FROM shared_books WHERE book_id = ${home.bookId}`)) as [[number]];
  await from.transport.append(home.relayBookId, await from.engine.sealer.seal(home.bookId, Number(epoch), cs));
}

describe('two members open a group at the same moment (task 5)', () => {
  it('the first link in the log is the link everywhere; the other lone log is abandoned and its maker joins the linked one', async () => {
    const { home, rina, andi, sari, bookId } = await household();
    // Neither sees the other's link: both open a group log before any sync.
    const rinaLog = await rina.engine.openGroupLog(bookId);
    const andiLog = await andi.engine.openGroupLog(bookId);
    expect(rinaLog).not.toBe(andiLog);
    const [, andiRelay] = (await linkOf(andi, bookId))!;
    // Rina's link reaches the log first; she proposes in her log.
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    // Andi proposes too: his phone takes Rina's link, leaves its lone log, and joins hers.
    await expect(andi.engine.proposeNetWorth(bookId, { mode: 'separate', members: [rina.memberId] })).resolves.toEqual(expect.any(String));
    await settle(home);
    for (const d of [rina, andi, sari]) expect((await linkOf(d, bookId))?.[0]).toBe(rinaLog);
    for (const d of [rina, andi]) expect(await d.engine.groupLogOf(bookId)).toBe(rinaLog);
    expect(home.relay.peek(andiRelay)!.deleted).toBe(true);
    // Both proposals are in the one log; the later one waits for Rina.
    const [r, a] = [await rina.engine.netWorthGroup(bookId), await andi.engine.netWorthGroup(bookId)];
    const pick = ({ active, pending, waitingFor, groupBookId }: typeof r) => ({ active, pending, waitingFor, groupBookId });
    expect(pick(r)).toEqual(pick(a));
    expect(r.pending?.proposedBy).toBe(andi.memberId);
    await rina.engine.answerNetWorth(bookId, r.pending!.proposalId, 'confirm');
    await settle(home);
    expect((await andi.engine.netWorthGroup(bookId)).active?.mode).toBe('separate');
    void proposalId;
  });
});

describe("a member's later device (task 5)", () => {
  it("Andi links his iPad to the workspace: a group member's phone lets it into the group log", async () => {
    const { home, rina, andi, bookId, proposalId } = await active();
    const pad = await home.device('AndiPad', andi.memberId);
    const { code } = await rina.engine.createInvite(bookId, { inviterName: 'Rina', sameMember: true, memberId: andi.memberId });
    await pad.engine.joinBook(code, { ws: pad.ws, memberName: 'Andi', deviceName: "Andi's iPad" });
    await settle(home);
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId;
    expect(await pad.engine.groupLogOf(bookId)).toBe(groupBookId);
    expect((await pad.engine.netWorthGroup(bookId)).active?.proposalId).toBe(proposalId);
    expect(await pad.database.db.values(sql`SELECT seq, entity, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
  });
});

describe('separate → joint (D8)', () => {
  it("Rina's hidden item is pending after the switch, Andi sees her count, and sharing it brings the count to zero", async () => {
    const { home, rina, andi, bookId } = await active('separate');
    const business = await createAccount(rina.database, rina.ws, { name: 'Business Mandiri', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await setShareSetting(rina.database, business.id, 'hidden');
    expect(await pendingHidden(rina.database, rina.ws)).toEqual([]);

    const joint = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, joint, 'confirm');
    await settle(home);
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    expect((await rina.engine.netWorthGroup(bookId)).active?.mode).toBe('joint');
    expect(await pendingHidden(rina.database, rina.ws)).toEqual([business.id]);
    expect(await pendingOf(andi, groupBookId, rina.memberId)).toBe(1);

    await setShareSetting(rina.database, business.id, 'total');
    expect(await getShareSetting(rina.database, business.id)).toBe('total');
    await settle(home);
    expect(await pendingOf(andi, groupBookId, rina.memberId)).toBe(0);
  });
});
