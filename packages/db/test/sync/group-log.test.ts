import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listSharedBooks } from '../../src/index';
import { introductionRefusal } from '../../src/sync/authority';
import { withCapture } from '../../src/sync/capture';
import { encodeHlc } from '../../src/sync/hlc';
import { MissingEpochKeyError, type ChangeLogEntry } from '../../src/sync/seal';
import type { ChangeSet, LogEntry } from '../../src/sync/types';
import { Household, type Device } from './household';

/*
 * The net-worth group's own log (joint-net-worth spec §4, task 4): a second shared book on the relay, linked to the
 * workspace by the `net_worth_group` row, whose epoch keys only the group members' devices ever hold. Rina and Andi
 * are the group; Sari (the adult son) is in the workspace and not in the group: she learns that a group exists and
 * nothing else.
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

/** Rina opens the group log and admits Andi; everyone settles twice: the link and invite, then Andi's introduction. */
async function group() {
  const h = await household();
  const groupBookId = await h.rina.engine.openGroupLog(h.bookId);
  await h.rina.engine.admitToGroupLog(h.bookId, [h.andi.memberId]);
  await h.home.settle();
  await h.home.settle();
  return { ...h, groupBookId };
}

/** An `nw_items` row written the way the app will: in the group log, captured, owned by the writing member. */
async function writeItem(d: Device, groupBookId: string, itemId: string): Promise<void> {
  await d.database.transaction((tx) =>
    withCapture(tx, { entity: 'nw_item', id: itemId, bookId: groupBookId }, async () => {
      await tx.run(sql`INSERT INTO nw_items (book_id, item_id, owner, summary_json, removed) VALUES (${groupBookId}, ${itemId}, ${d.memberId}, '{}', 0)`);
    }),
  );
}

const itemsOf = async (d: Device, groupBookId: string) =>
  (await d.database.db.values<[string]>(sql`SELECT item_id FROM nw_items WHERE book_id = ${groupBookId} ORDER BY item_id`)).map(([id]) => id);

const relayOf = async (d: Device, bookId: string) => (await d.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${bookId}`))[0]![0];

const logOf = (home: Household, relayBookId: string): (LogEntry & { seq: number })[] =>
  [...home.relay.peek(relayBookId)!.log.entries()].map(([seq, entry]) => ({ ...entry, seq }));

describe('the group log (joint-net-worth §4)', () => {
  it('Rina opens it and admits Andi: both phones read the same group log, and Sari is told only that one exists', async () => {
    const { home, rina, andi, sari, bookId, groupBookId } = await group();
    expect(await rina.engine.groupLogOf(bookId)).toBe(groupBookId);
    expect(await andi.engine.groupLogOf(bookId)).toBe(groupBookId);
    // Sari has the link (a group exists) but no copy of the log.
    expect(await sari.engine.groupLogOf(bookId)).toBeNull();
    const [link] = await sari.database.db.values<[string]>(sql`SELECT group_book_id FROM group_logs WHERE book_id = ${bookId}`);
    expect(link).toEqual([groupBookId]);
    // Opening again is the same log.
    expect(await rina.engine.openGroupLog(bookId)).toBe(groupBookId);
    expect(await andi.engine.openGroupLog(bookId)).toBe(groupBookId);
    // The group log has no books row and no seed: only the two introductions (member + device each).
    expect(await rina.database.db.values(sql`SELECT 1 FROM books WHERE id = ${groupBookId}`)).toEqual([]);
    const members = await andi.database.db.values<[string, string]>(sql`SELECT member_id, role FROM book_members WHERE book_id = ${groupBookId} ORDER BY member_id`);
    expect(members).toEqual([
      [andi.memberId, 'owner'],
      [rina.memberId, 'owner'],
    ]);
    expect(await andi.database.db.values(sql`SELECT seq, entity, id, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
    expect(await rina.database.db.values(sql`SELECT seq, entity, id, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
    // Every group member's device is an owner on the relay, so any of them can remove a member who left (§6).
    const relay = await relayOf(rina, groupBookId);
    expect([...home.relay.peek(relay)!.owners].sort()).toEqual([rina.deviceId, andi.deviceId].sort());
    expect([...home.relay.peek(relay)!.devices.keys()]).not.toContain(sari.deviceId);
  });

  it("an item Rina writes reaches Andi's phone and never Sari's, who holds no key of the group log", async () => {
    const { home, rina, andi, sari, groupBookId } = await group();
    await writeItem(rina, groupBookId, 'item-rina');
    await home.settle();
    expect(await itemsOf(andi, groupBookId)).toEqual(['item-rina']);
    expect(await itemsOf(sari, groupBookId)).toEqual([]);
    expect(await sari.database.db.values(sql`SELECT epoch FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).toEqual([]);
    expect(await sari.database.db.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${groupBookId}`)).toEqual([]);
    expect(await sari.database.db.values(sql`SELECT seq, entity, id, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
    // The relay never let her in.
    await expect(sari.transport.pull(await relayOf(rina, groupBookId), 0)).rejects.toMatchObject({ status: 401 });
  });

  it("Andi leaves: Rina's next entry is sealed at an epoch he never holds, and his phone forgets the group's rows", async () => {
    const { home, rina, andi, groupBookId, bookId } = await group();
    await writeItem(rina, groupBookId, 'item-rina');
    await writeItem(andi, groupBookId, 'item-andi');
    await home.settle();
    expect(await itemsOf(andi, groupBookId)).toEqual(['item-andi', 'item-rina']);
    expect(await itemsOf(rina, groupBookId)).toEqual(['item-andi', 'item-rina']);

    await andi.engine.leaveGroupLog(bookId);
    expect(await itemsOf(andi, groupBookId)).toEqual([]);
    expect(await andi.engine.groupLogOf(bookId)).toBeNull();
    await home.settle();
    // Every phone deletes the summaries of a member who left (§6).
    expect(await itemsOf(rina, groupBookId)).toEqual(['item-rina']);

    await writeItem(rina, groupBookId, 'item-rina-2');
    await home.settle();
    const relay = await relayOf(rina, groupBookId);
    const last = logOf(home, relay).filter((e): e is ChangeLogEntry & { seq: number } => e.kind === 'change' && e.deviceId === rina.deviceId).at(-1)!;
    expect(last.epoch).toBe(2);
    const rotation = logOf(home, relay).find((e) => e.kind === 'rotation') as Extract<LogEntry, { kind: 'rotation' }>;
    expect(rotation.sealed.map((s) => s.deviceId)).toEqual([rina.deviceId]);
    await expect(andi.engine.sealer.open(groupBookId, last)).rejects.toBeInstanceOf(MissingEpochKeyError);
    expect(await andi.database.db.values(sql`SELECT epoch FROM book_epoch_keys WHERE book_id = ${groupBookId}`)).toEqual([]);
    expect(await itemsOf(andi, groupBookId)).toEqual([]);
  });

  it('a member who left is removed by any other member, with rotation; one who has not left is not', async () => {
    const { home, rina, andi, groupBookId, bookId } = await group();
    await expect(rina.engine.removeFromGroupLog(bookId, andi.memberId)).rejects.toMatchObject({ code: 'NOT_LEFT' });
    // Andi answers 'left' (his phone could not finish leaving, say): any member may then take him out.
    await writeItem(andi, groupBookId, 'item-andi');
    await andi.database.transaction((tx) =>
      withCapture(tx, { entity: 'nw_answer', id: `proposal-1|${andi.memberId}`, bookId: groupBookId }, async () => {
        await tx.run(sql`INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, 'proposal-1', ${andi.memberId}, 'left')`);
      }),
    );
    await home.settle();
    await rina.engine.removeFromGroupLog(bookId, andi.memberId);
    expect(await itemsOf(rina, groupBookId)).toEqual([]);
    const [[epoch]] = (await rina.database.db.values<[number]>(sql`SELECT epoch FROM shared_books WHERE book_id = ${groupBookId}`)) as [[number]];
    expect(Number(epoch)).toBe(2);
    await home.settle();
    expect(await andi.engine.groupLogOf(bookId)).toBeNull();
    expect(await itemsOf(andi, groupBookId)).toEqual([]);
  });

  it('groupMembersReady names each device below the minimum app version', async () => {
    const { rina, andi, sari, bookId } = await household({ sari: '0.2.0' });
    expect(await rina.engine.groupMembersReady(bookId, [rina.memberId, andi.memberId])).toEqual({ ready: true, outdated: [] });
    expect(await rina.engine.groupMembersReady(bookId, [rina.memberId, sari.memberId])).toEqual({
      ready: false,
      outdated: [{ memberId: sari.memberId, deviceName: "Sari's phone" }],
    });
  });

  it("the workspace's shared-book listing never shows the group log", async () => {
    const { rina, andi, sari, bookId } = await group();
    for (const d of [rina, andi, sari]) expect((await listSharedBooks(d.database)).map((b) => b.bookId)).toEqual([bookId]);
  });

  it('a rewritten link never moves a member off the group log they are in', async () => {
    const { home, rina, andi, sari, bookId, groupBookId } = await group();
    // Any workspace member may write `net_worth_group`: Sari points the link somewhere else.
    await sari.database.transaction((tx) =>
      withCapture(tx, { entity: 'net_worth_group', id: bookId, bookId }, async () => {
        await tx.run(sql`UPDATE group_logs SET group_book_id = 'elsewhere', invites_json = '[]' WHERE book_id = ${bookId}`);
      }),
    );
    await home.settle();
    const [link] = await rina.database.db.values<[string]>(sql`SELECT group_book_id FROM group_logs WHERE book_id = ${bookId}`);
    expect(link).toEqual(['elsewhere']);
    expect(await rina.engine.groupLogOf(bookId)).toBe(groupBookId);
    expect(await andi.engine.groupLogOf(bookId)).toBe(groupBookId);
    await writeItem(rina, groupBookId, 'item-after');
    await home.settle();
    expect(await itemsOf(andi, groupBookId)).toEqual(['item-after']);
    for (const d of [rina, andi]) expect((await listSharedBooks(d.database)).map((b) => b.bookId)).toEqual([bookId]);
  });

  it("a member outside the group cannot open a second one in the same workspace", async () => {
    const { sari, bookId } = await group();
    await expect(sari.engine.openGroupLog(bookId)).rejects.toMatchObject({ code: 'GROUP_EXISTS' });
  });
});

describe('admission to a group log (authority)', () => {
  /** A made-up introduction of `deviceId` as `memberId`, as the pull would hand it to the view. */
  const intro = (deviceId: string, memberId: string): ChangeSet => ({
    v: 1,
    hlc: encodeHlc(Date.now(), 0, deviceId),
    member: memberId,
    ops: [{ entity: 'device', id: deviceId, op: 'upsert', fields: { memberId } }],
  });

  it('admits a device pinned in the linked workspace as its own member, with no invite terms; refuses it as anyone else', async () => {
    const { rina, andi, sari, groupBookId } = await group();
    const refusal = (d: Device, memberId: string) =>
      rina.database.transaction((tx) => introductionRefusal(tx, groupBookId, d.deviceId, 99, intro(d.deviceId, memberId)));
    expect(await refusal(sari, andi.memberId)).toMatch(/^AUTHORITY: introduction/);
    expect(await refusal(sari, sari.memberId)).toBeNull();
    // A device the workspace never pinned is never admitted.
    expect(
      await rina.database.transaction((tx) => introductionRefusal(tx, groupBookId, 'f'.repeat(32), 99, intro('f'.repeat(32), andi.memberId))),
    ).toMatch(/^AUTHORITY: introduction/);
  });
});
