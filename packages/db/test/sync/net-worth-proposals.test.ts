import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, getShareSetting, pendingHidden, setShareSetting } from '../../src/index';
import { withCapture } from '../../src/sync/capture';
import { uuidv7 } from '@expanses/core';
import { GROUP_LINK_NS } from '../../src/sync/authority';
import { randomBytes, sealKeyFor, utf8 } from '../../src/sync/crypto';
import { encodeHlc, localTick } from '../../src/sync/hlc';
import { encodeInviteCode, INVITE_TTL_MS, inviteAad, inviteKeyOf, newInviteSecret, sealInviteJson } from '../../src/sync/invite';
import { closeProofFrom } from '../../src/sync/net-worth/group-log';
import { bytesToBase64Url, inviteSigningBytes } from '../../src/sync/relay-signing';
import { type ChangeSet, SyncTransportError } from '../../src/sync/types';
import { uuidv5 } from '../../src/sync/uuidv5';
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

  it("a device on an old app blocks setup even when its person is not asked: it could not read the group's workspace rows", async () => {
    const { rina, andi, sari, bookId } = await household({ sari: '0.2.0' });
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] })).rejects.toMatchObject({
      code: 'not-ready',
      outdated: [{ memberId: sari.memberId, deviceName: "Sari's phone" }],
    });
    expect(await linkOf(rina, bookId)).toBeNull();
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

describe('an invite made before a rotation never strands its claimant (final review item 5)', () => {
  const groupOf = async (d: Device, bookId: string) => (await d.engine.netWorthGroup(bookId)).groupBookId;
  /** The group log's epoch on the relay, and whether `d` is in the log at it: its row active there and its key held. */
  async function current(home: Household, d: Device, groupBookId: string) {
    const [[relayBookId]] = (await d.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${groupBookId}`)) as [[string]];
    const relayEpoch = home.relay.peek(relayBookId)!.epoch;
    const [row] = await d.database.db.values<[string, number]>(sql`SELECT state, epoch FROM shared_books WHERE book_id = ${groupBookId}`);
    const [key] = await d.database.db.values(sql`SELECT 1 FROM book_epoch_keys WHERE book_id = ${groupBookId} AND epoch = ${relayEpoch}`);
    return { relayEpoch, state: row?.[0], epoch: Number(row?.[1]), holdsKey: key !== undefined };
  }

  it('a third member leaves before the partner claims: his stale invite leaves him waiting, the rotation re-invites him, and he is in at the current key', async () => {
    const { home, rina, andi, sari, bookId } = await household();
    await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    // Sari joins the group log and leaves the workspace at once; Rina rotates past her before Andi has synced at all.
    await sari.engine.syncOnce(bookId);
    await sari.engine.leave(bookId);
    // Rina's fresh invite of Andi fails on the relay for now: the only invite Andi can claim is the stale one.
    const putInvite = rina.transport.putInvite.bind(rina.transport);
    rina.transport.putInvite = async () => {
      throw new SyncTransportError(503, 'offline');
    };
    await home.settle([rina]);
    await home.settle([rina]);
    const groupBookId = (await groupOf(rina, bookId))!;
    expect((await andi.engine.syncOnce(bookId)).groupError).toBeUndefined();
    expect(await groupOf(andi, bookId)).toBeNull();
    expect(await andi.database.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${groupBookId}`)).toEqual([['needs_invite']]);

    rina.transport.putInvite = putInvite;
    await settle(home);
    await settle(home);
    expect(await groupOf(andi, bookId)).toBe(groupBookId);
    const now = await current(home, andi, groupBookId);
    expect(now.relayEpoch).toBeGreaterThan(1);
    expect(now).toMatchObject({ state: 'active', epoch: now.relayEpoch, holdsKey: true });
    // And he can answer: his confirm reaches Rina.
    const pending = (await andi.engine.netWorthGroup(bookId)).pending!;
    await andi.engine.answerNetWorth(bookId, pending.proposalId, 'confirm');
    await settle(home);
    expect((await rina.engine.netWorthGroup(bookId)).waitingFor).not.toContain(andi.memberId);
  });

  it("Andi replaces his phone: the old phone's invite, made before the rotation, is spent, and the new phone gets in on a fresh one", async () => {
    const { home, rina, andi, bookId, proposalId } = await active();
    const groupBookId = (await groupOf(rina, bookId))!;
    // Andi's iPad is in the group too, so taking the old phone out leaves him in it. Rina (an owner) links his devices.
    const link = async (name: string, deviceName: string) => {
      const d = await home.device(name, andi.memberId);
      const { code } = await rina.engine.createInvite(bookId, { inviterName: 'Rina', sameMember: true, memberId: andi.memberId });
      await d.engine.joinBook(code, { ws: d.ws, memberName: 'Andi', deviceName });
      return d;
    };
    const pad = await link('AndiPad', "Andi's iPad");
    await settle(home);
    expect(await groupOf(pad, bookId)).toBe(groupBookId);

    const phone = await link('AndiNew', "Andi's new phone");
    // The new phone cannot reach the group log's invites yet, while the old phone invites it (epoch 1's key only).
    const claim = phone.transport.claimInvite.bind(phone.transport);
    phone.transport.claimInvite = async () => {
      throw new SyncTransportError(503, 'offline');
    };
    await home.settle([andi, phone]);
    expect(await andi.database.db.values(sql`SELECT 1 FROM settings WHERE key = ${`nw.invited.${groupBookId}`}`)).toHaveLength(1);
    // Rina takes the old phone out of the workspace; her phone takes it out of the group log and rotates. Her (and the
    // iPad's) invite of the new phone fails on the relay for now: the only invite it could claim is the old phone's.
    const offline = async () => {
      throw new SyncTransportError(503, 'offline');
    };
    const rinaPut = rina.transport.putInvite.bind(rina.transport);
    const padPut = pad.transport.putInvite.bind(pad.transport);
    rina.transport.putInvite = offline;
    pad.transport.putInvite = offline;
    await rina.engine.removeDevice(bookId, andi.deviceId);
    await home.settle([rina, pad]);
    await home.settle([rina, pad]);
    const [[relay]] = (await rina.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${groupBookId}`)) as [[string]];
    expect(home.relay.peek(relay)!.epoch).toBeGreaterThan(1);
    phone.transport.claimInvite = claim;
    // The old phone's invite is spent: it is no owner on the relay any more (403). Nothing is claimed, and the
    // workspace's sync is not failed for it.
    expect((await phone.engine.syncOnce(bookId)).groupError).toBeUndefined();
    expect(await groupOf(phone, bookId)).toBeNull();

    rina.transport.putInvite = rinaPut;
    pad.transport.putInvite = padPut;
    await settle(home);
    await settle(home);
    expect(await groupOf(phone, bookId)).toBe(groupBookId);
    const now = await current(home, phone, groupBookId);
    expect(now).toMatchObject({ state: 'active', epoch: now.relayEpoch, holdsKey: true });
    expect((await phone.engine.netWorthGroup(bookId)).active?.proposalId).toBe(proposalId);
    expect(await rina.database.db.values(sql`SELECT removed_seq FROM sync_authority_devices WHERE book_id = ${groupBookId} AND device_id = ${phone.deviceId}`)).toEqual([[null]]);
  });

  it('a partner who claimed before the rotation but whose introduction had not landed waits, then gets in on a fresh invite', async () => {
    const { home, rina, andi, sari, bookId } = await household();
    await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    const groupBookId = (await groupOf(rina, bookId))!;
    const [[relay]] = (await rina.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${groupBookId}`)) as [[string]];
    // Andi claims his invite, but nothing he writes reaches the group log yet.
    const append = andi.transport.append.bind(andi.transport);
    andi.transport.append = async (bookId, entry) => {
      if (bookId === relay) throw new SyncTransportError(503, 'offline');
      return append(bookId, entry);
    };
    await andi.engine.syncOnce(bookId);
    expect(await groupOf(andi, bookId)).toBe(groupBookId);
    // Sari joins and leaves the workspace; Rina rotates past her (Andi is not in the log's view: no key for him).
    await sari.engine.syncOnce(bookId);
    await sari.engine.leave(bookId);
    await home.settle([rina]);
    await home.settle([rina]);
    expect(home.relay.peek(relay)!.epoch).toBeGreaterThan(1);
    andi.transport.append = append;
    await settle(home);
    await settle(home);
    expect(await groupOf(andi, bookId)).toBe(groupBookId);
    const now = await current(home, andi, groupBookId);
    expect(now).toMatchObject({ state: 'active', epoch: now.relayEpoch, holdsKey: true });
    expect(await rina.database.db.values(sql`SELECT removed_seq FROM sync_authority_devices WHERE book_id = ${groupBookId} AND device_id = ${andi.deviceId}`)).toEqual([[null]]);
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

/* ------------------------------------------------------------------ review round 1 */

/** Rina, Andi and Sari file separately; Sari then stops sharing hers: the group goes on as Rina and Andi. */
async function sariLeft() {
  const h = await household();
  const proposalId = await h.rina.engine.proposeNetWorth(h.bookId, { mode: 'separate', members: [h.andi.memberId, h.sari.memberId] });
  await settle(h.home);
  await h.andi.engine.answerNetWorth(h.bookId, proposalId, 'confirm');
  await h.sari.engine.answerNetWorth(h.bookId, proposalId, 'confirm');
  await settle(h.home);
  const groupBookId = (await h.rina.engine.netWorthGroup(h.bookId)).groupBookId!;
  // What a modified client of Sari's keeps from its time in the group: the key its close proof comes from.
  const proof = await closeProofFrom((await h.sari.engine.sealer.epochKey(groupBookId, 1))!);
  await h.sari.engine.leaveNetWorth(h.bookId);
  await settle(h.home);
  return { ...h, proposalId, groupBookId, proof };
}

describe('a member who left (review round 1, finding 1)', () => {
  it('is never proposed back into the group log', async () => {
    const { rina, andi, sari, bookId, proposalId } = await sariLeft();
    expect((await rina.engine.netWorthGroup(bookId)).active).toEqual({ proposalId, mode: 'separate', members: [rina.memberId, andi.memberId] });
    await expect(rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] })).rejects.toMatchObject({ code: 'left-group' });
  });

  it('a proposal made after they left, naming them, never activates and never dissolves the group', async () => {
    const { home, rina, andi, sari, bookId, proposalId, groupBookId } = await sariLeft();
    // A modified client of Rina's writes it anyway: one tax ID with Sari.
    const crafted = uuidv7();
    await rina.database.transaction(async (tx) => {
      const createdHlc = await localTick(tx, rina.deviceId, Date.now());
      await withCapture(tx, { entity: 'nw_proposal', id: crafted, bookId: groupBookId }, async () => {
        await tx.run(sql`INSERT INTO nw_proposals (book_id, proposal_id, mode, members_json, proposed_by, created_hlc, cancelled)
          VALUES (${groupBookId}, ${crafted}, 'joint', ${JSON.stringify([rina.memberId, sari.memberId])}, ${rina.memberId}, ${createdHlc}, 0)`);
      });
      await withCapture(tx, { entity: 'nw_answer', id: `${crafted}|${rina.memberId}`, bookId: groupBookId }, async () => {
        await tx.run(sql`INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, ${crafted}, ${rina.memberId}, 'confirm')`);
      });
    });
    await settle(home);
    for (const d of [rina, andi]) {
      const group = await d.engine.netWorthGroup(bookId);
      expect(group.groupBookId).toBe(groupBookId);
      expect(group.active).toEqual({ proposalId, mode: 'separate', members: [rina.memberId, andi.memberId] });
      // It names Sari, who is not in the group: a Change never adds anyone, so it is not even waiting (wave 3 round 2).
      expect(group.pending).toBeNull();
      expect(group.waitingFor).toEqual([]);
      expect(await d.database.db.values(sql`SELECT 1 FROM nw_proposals WHERE book_id = ${groupBookId} AND proposal_id = ${crafted}`)).toEqual([[1]]);
    }
  });
});

describe('a former member closes a live link (review round 1, finding 2)', () => {
  it('the group opens it again, still lets later devices in, and no other group takes its place', async () => {
    const { home, rina, andi, sari, bookId, groupBookId, proof } = await sariLeft();
    const open = await linkOf(rina, bookId);
    await send(home, sari, { entity: 'net_worth_group', id: bookId, op: 'upsert', fields: { relayBookId: `closed:${proof}` }, changed: ['relayBookId'] });
    await settle(home);
    for (const d of [rina, andi, sari]) expect(await linkOf(d, bookId)).toEqual(open);
    // Nobody sets up another group while this one lives.
    await expect(sari.engine.proposeNetWorth(bookId, { mode: 'separate', members: [rina.memberId] })).rejects.toMatchObject({ code: 'GROUP_EXISTS' });
    const other = await uuidv5(GROUP_LINK_NS, 'another-proof');
    await send(home, sari, { entity: 'net_worth_group', id: bookId, op: 'upsert', fields: { groupBookId: other, relayBookId: 'relay-x', invites: '[]' } });
    await settle(home);
    for (const d of [rina, andi, sari]) expect(await linkOf(d, bookId)).toEqual(open);
    // Andi's iPad still gets in.
    const pad = await home.device('AndiPad', andi.memberId);
    const { code } = await rina.engine.createInvite(bookId, { inviterName: 'Rina', sameMember: true, memberId: andi.memberId });
    await pad.engine.joinBook(code, { ws: pad.ws, memberName: 'Andi', deviceName: "Andi's iPad" });
    await settle(home);
    expect(await pad.engine.groupLogOf(bookId)).toBe(groupBookId);
  });
});

describe('a link names a log its keys can prove (review round 1, finding 5)', () => {
  it('a new link whose id is no version-5 id is refused at capture and on every peer', async () => {
    const { home, rina, andi, sari, bookId } = await household();
    await expect(
      sari.database.transaction((tx) =>
        withCapture(tx, { entity: 'net_worth_group', id: bookId, bookId }, async () => {
          await tx.run(sql`INSERT INTO group_logs (book_id, group_book_id, relay_book_id, invites_json) VALUES (${bookId}, ${uuidv7()}, 'relay-x', '[]')`);
        }),
      ),
    ).rejects.toThrow(/AUTHORITY: write-once/);
    await send(home, sari, { entity: 'net_worth_group', id: bookId, op: 'upsert', fields: { groupBookId: uuidv7(), relayBookId: 'relay-x', invites: '[]' } });
    await settle(home);
    for (const d of [rina, andi]) expect(await linkOf(d, bookId)).toBeNull();
  });

  it('an invite whose keys do not derive the id the link names is never kept', async () => {
    const { home, andi, sari, bookId } = await household();
    // Sari makes a link of her own, with a version-5 id no key of hers derives, and seals Andi an invite to her book.
    const { bookId: relay } = await sari.transport.createBook(sari.public);
    const groupBookId = await uuidv5(GROUP_LINK_NS, 'not-from-a-key');
    const inviteId = uuidv7();
    const secret = newInviteSecret();
    const key = await inviteKeyOf(secret, inviteId);
    const unsigned = {
      inviteId,
      keys: await sealInviteJson(key, [{ epoch: 1, key: bytesToBase64Url(randomBytes(32)) }], inviteAad('keys', inviteId)),
      preview: await sealInviteJson(key, { groupBookId, relayBookId: relay }, inviteAad('preview', inviteId)),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      sameMember: false,
    };
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sari.keys.sign.privateKey, inviteSigningBytes(unsigned) as BufferSource);
    await sari.transport.putInvite(relay, { ...unsigned, sig: bytesToBase64Url(new Uint8Array(sig)) });
    const { deviceId: _d, ...sealed } = await sealKeyFor({ deviceId: andi.deviceId, agreeJwk: andi.public.agreeJwk }, groupBookId, 0, utf8(encodeInviteCode(inviteId, secret)), 'cicis-group-invite-v1');
    await send(home, sari, {
      entity: 'net_worth_group',
      id: bookId,
      op: 'upsert',
      fields: { groupBookId, relayBookId: relay, invites: JSON.stringify([{ ...sealed, expiresAt: unsigned.expiresAt }]) },
    });
    await settle(home);
    expect(await linkOf(andi, bookId)).toEqual([groupBookId, relay]);
    expect(await andi.engine.groupLogOf(bookId)).toBeNull();
    expect(await andi.database.db.values(sql`SELECT epoch FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).toEqual([]);
  });
});

describe("the group's own work never fails the workspace's sync (review round 1, finding 7)", () => {
  it('an error after the group log synced comes back as groupError', async () => {
    const { rina, bookId } = await active('separate');
    await rina.database.execScript('ALTER TABLE nw_pending RENAME TO nw_pending_away');
    const failed = await rina.engine.syncOnce(bookId);
    expect(failed.groupError).toBeInstanceOf(Error);
    expect(failed.stopped).toBeUndefined();
    await rina.database.execScript('ALTER TABLE nw_pending_away RENAME TO nw_pending');
    expect((await rina.engine.syncOnce(bookId)).groupError).toBeUndefined();
  });
});

describe('both links reach the log before either device pulls (review round 1, finding 8)', () => {
  it("the first is the link everywhere, and the loser's own invites never replace the winner's", async () => {
    const { home, rina, andi, sari, bookId } = await household();
    const rinaLog = await rina.engine.openGroupLog(bookId);
    const andiLog = await andi.engine.openGroupLog(bookId);
    // Each lets the other in, into its own log, and both drain before either pulls.
    await rina.engine.admitToGroupLog(bookId, [andi.memberId]);
    await andi.engine.admitToGroupLog(bookId, [rina.memberId]);
    await rina.engine.drain(bookId);
    await andi.engine.drain(bookId);
    await settle(home);
    for (const d of [rina, andi, sari]) expect((await linkOf(d, bookId))?.[0]).toBe(rinaLog);
    for (const d of [rina, andi]) expect(await d.engine.groupLogOf(bookId)).toBe(rinaLog);
    expect(andiLog).not.toBe(rinaLog);
  });
});

/* ------------------------------------------------------------------ review round 2 */

/** Writes a proposal as a modified client would: straight through capture, with its own `createdHlc`. */
async function craft(d: Device, groupBookId: string, members: string[], mode: 'joint' | 'separate', createdHlc: string): Promise<string> {
  const id = uuidv7();
  await d.database.transaction(async (tx) => {
    await withCapture(tx, { entity: 'nw_proposal', id, bookId: groupBookId }, async () => {
      await tx.run(sql`INSERT INTO nw_proposals (book_id, proposal_id, mode, members_json, proposed_by, created_hlc, cancelled)
        VALUES (${groupBookId}, ${id}, ${mode}, ${JSON.stringify(members)}, ${d.memberId}, ${createdHlc}, 0)`);
    });
    await withCapture(tx, { entity: 'nw_answer', id: `${id}|${d.memberId}`, bookId: groupBookId }, async () => {
      await tx.run(sql`INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, ${id}, ${d.memberId}, 'confirm')`);
    });
  });
  return id;
}

describe('a departure never answers for anyone (review round 2, A)', () => {
  it('a backdated proposal naming the departed member never activates and never dissolves the group', async () => {
    const { home, rina, andi, sari, bookId, proposalId, groupBookId } = await sariLeft();
    const crafted = await craft(rina, groupBookId, [rina.memberId, sari.memberId], 'joint', encodeHlc(1, 0, rina.deviceId));
    await settle(home);
    for (const d of [rina, andi]) {
      const group = await d.engine.netWorthGroup(bookId);
      expect(group.groupBookId).toBe(groupBookId);
      expect(group.active).toEqual({ proposalId, mode: 'separate', members: [rina.memberId, andi.memberId] });
      // Older than the group it would replace, it is not even waiting: it is simply history.
      expect(group.pending).toBeNull();
      expect(await d.database.db.values(sql`SELECT 1 FROM nw_proposals WHERE book_id = ${groupBookId} AND proposal_id = ${crafted}`)).toEqual([[1]]);
    }
  });

  it('someone asked who leaves without answering never answers for the change, and the group stays as it was', async () => {
    // Wave 3 round 2: a Change never adds anyone, so the three start together and the change drops Andi.
    const { home, rina, andi, sari, bookId } = await household();
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    await sari.engine.answerNetWorth(bookId, proposalId, 'confirm');
    await settle(home);
    const change = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [sari.memberId] });
    await settle(home);
    // Andi, left out of the change, agrees to it; Sari never answers, and goes.
    await andi.engine.answerNetWorth(bookId, change, 'confirm');
    await sari.engine.leaveNetWorth(bookId);
    await settle(home);
    for (const d of [rina, andi]) {
      const group = await d.engine.netWorthGroup(bookId);
      expect(group.active).toEqual({ proposalId, mode: 'separate', members: [rina.memberId, andi.memberId] });
      // Sari is out of the group now, so the change would add her back: it can never activate, and is not waiting.
      expect(group.pending).toBeNull();
      expect(change).not.toBe(proposalId);
    }
  });

  it("a proposal's createdHlc, mode and members never change after it is made, at capture and on every peer", async () => {
    const { home, rina, andi, bookId, proposalId } = await active('separate');
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    await expect(
      rina.database.transaction((tx) =>
        withCapture(tx, { entity: 'nw_proposal', id: proposalId, bookId: groupBookId }, async () => {
          await tx.run(sql`UPDATE nw_proposals SET created_hlc = '0' WHERE book_id = ${groupBookId} AND proposal_id = ${proposalId}`);
        }),
      ),
    ).rejects.toThrow(/AUTHORITY: writer/);
    const cs: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now() + 1_000, 0, rina.deviceId),
      member: rina.memberId,
      ops: [{ entity: 'nw_proposal', id: proposalId, op: 'upsert', fields: { createdHlc: '0', mode: 'joint' }, changed: ['createdHlc', 'mode'] }],
    };
    const [[epoch]] = (await rina.database.db.values<[number]>(sql`SELECT epoch FROM shared_books WHERE book_id = ${groupBookId}`)) as [[number]];
    const [[relay]] = (await rina.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${groupBookId}`)) as [[string]];
    await rina.transport.append(relay, await rina.engine.sealer.seal(groupBookId, Number(epoch), cs));
    await settle(home);
    const [row] = await andi.database.db.values<[string, string]>(sql`SELECT created_hlc, mode FROM nw_proposals WHERE book_id = ${groupBookId} AND proposal_id = ${proposalId}`);
    expect(row![1]).toBe('separate');
    expect(row![0]).not.toBe('0');
    expect(await andi.database.db.values(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([['nw_proposal', 'AUTHORITY: writer']]);
  });
});

describe('a change needs every current member (review round 2, B)', () => {
  async function three() {
    const h = await household();
    const proposalId = await h.rina.engine.proposeNetWorth(h.bookId, { mode: 'separate', members: [h.andi.memberId, h.sari.memberId] });
    await settle(h.home);
    await h.andi.engine.answerNetWorth(h.bookId, proposalId, 'confirm');
    await h.sari.engine.answerNetWorth(h.bookId, proposalId, 'confirm');
    await settle(h.home);
    const change = await h.rina.engine.proposeNetWorth(h.bookId, { mode: 'separate', members: [h.sari.memberId] });
    await settle(h.home);
    await h.sari.engine.answerNetWorth(h.bookId, change, 'confirm');
    await settle(h.home);
    return { ...h, proposalId, change };
  }

  it('Rina and Sari cannot drop Andi without him; when he confirms, they can', async () => {
    const { home, rina, andi, sari, bookId, proposalId, change } = await three();
    const asked = await andi.engine.netWorthGroup(bookId);
    expect(asked.active?.proposalId).toBe(proposalId);
    expect(asked.pending?.proposalId).toBe(change);
    expect(asked.waitingFor).toEqual([andi.memberId]);
    await andi.engine.answerNetWorth(bookId, change, 'confirm');
    await settle(home);
    for (const d of [rina, sari]) expect((await d.engine.netWorthGroup(bookId)).active).toEqual({ proposalId: change, mode: 'separate', members: [rina.memberId, sari.memberId] });
  });

  it('Andi declines: never', async () => {
    const { home, rina, andi, bookId, proposalId } = await three();
    await andi.engine.answerNetWorth(bookId, (await andi.engine.netWorthGroup(bookId)).pending!.proposalId, 'decline');
    await settle(home);
    const group = await rina.engine.netWorthGroup(bookId);
    expect(group.active?.proposalId).toBe(proposalId);
    expect(group.pending).toBeNull();
  });
});
