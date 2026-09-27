import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { personalBook, postTransaction, renameBook, voidTransaction } from '../../src/index';
import { BookReadOnlyError, LastOwnerError } from '../../src/sync/capture';
import { FrozenBookError, NotOwnerError } from '../../src/sync/engine';
import { encodeHlc } from '../../src/sync/hlc';
import { categoryOf, Household, projectBook, type Device } from './household';

/*
 * The edges of sharing (spec §8.4 Leave, §8.5 ownership and a frozen book, §8.6 stop sharing, §8.7 and §11 status):
 * what the engine does and refuses, and what every other device ends up with.
 */

async function spend(d: Device, bookId: string, description: string, amountMinor = 12_000): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const budi = await home.device('Budi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.join(budi, fandri);
  await home.settle();
  return { home, fandri, dewi, budi, bookId };
}

/** A second device of `member`'s member, linked by an owner's invite that names that member (§8.3). */
async function secondDevice(home: Household, owner: Device, member: Device, bookId: string): Promise<Device> {
  const phone = await home.device(`${member.name}2`, member.memberId);
  const { code } = await owner.engine.createInvite(bookId, { inviterName: owner.name, sameMember: true, memberId: member.memberId });
  await phone.engine.joinBook(code, { ws: phone.ws, memberName: member.name, deviceName: `${member.name}'s tablet` });
  return phone;
}

const shared = async (d: Device, bookId: string) =>
  (await d.database.db.values<[string, string | null]>(sql`SELECT state, unshared_by FROM shared_books WHERE book_id = ${bookId}`))[0];
const roleOf = async (d: Device, bookId: string, memberId: string) =>
  (await d.database.db.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`))[0]?.[0];
const relayOwners = (home: Household) => [...home.relay.peek(home.relayBookId)!.owners].sort();
const relayRemoved = (home: Household, deviceId: string) => home.relay.peek(home.relayBookId)!.devices.get(deviceId)?.removedAt !== undefined;
const epochOf = async (d: Device, bookId: string) => (await d.database.db.values<[number]>(sql`SELECT epoch FROM shared_books WHERE book_id = ${bookId}`))[0]![0];
const count = async (d: Device, table: string, bookId: string) =>
  Number((await d.database.db.values<[number]>(sql`SELECT count(*) FROM ${sql.raw(table)} WHERE book_id = ${bookId}`))[0]![0]);

describe('make owner (§8.5)', () => {
  it("writes the member's role, and the relay's owners follow the view to that member's devices", async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await fandri.engine.makeOwner(bookId, dewi.memberId);
    await home.settle();
    for (const d of [fandri, dewi, budi]) expect(await roleOf(d, bookId, dewi.memberId)).toBe('owner');
    expect(relayOwners(home)).toEqual([fandri.deviceId, dewi.deviceId].sort());
    // Dewi, now an owner on the relay too, can invite.
    await expect(dewi.engine.createInvite(bookId, { inviterName: 'Dewi' })).resolves.toMatchObject({ code: expect.any(String) });
  });

  it('is refused to a device whose member is not an owner', async () => {
    const { fandri, dewi, budi, bookId } = await household();
    await expect(dewi.engine.makeOwner(bookId, budi.memberId)).rejects.toBeInstanceOf(NotOwnerError);
    expect(await roleOf(dewi, bookId, budi.memberId)).toBe('member');
    expect(await roleOf(fandri, bookId, budi.memberId)).toBe('member');
  });
});

describe('leave (§8.4)', () => {
  it("removes each of the member's devices; the others rotate past them; the leaver's copy stays, read-only", async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    const tablet = await secondDevice(home, fandri, dewi, bookId);
    await home.settle();
    await spend(dewi, bookId, 'before Dewi left');
    await dewi.engine.leave(bookId);
    expect(relayRemoved(home, dewi.deviceId)).toBe(true);
    expect(await shared(dewi, bookId)).toEqual(['unshared', dewi.memberId]);

    // The tablet follows on its next sync: it removes itself too.
    const result = await tablet.engine.syncOnce(bookId);
    expect(result.ended).toBe('left');
    expect(relayRemoved(home, tablet.deviceId)).toBe(true);
    expect(await shared(tablet, bookId)).toEqual(['unshared', dewi.memberId]);

    await home.settle([fandri, budi]);
    expect(await epochOf(fandri, bookId)).toBeGreaterThanOrEqual(2);
    const sealedFor = [...home.relay.peek(home.relayBookId)!.log.values()]
      .filter((e) => e.kind === 'rotation')
      .at(-1) as Extract<import('../../src/sync/types').LogEntry, { kind: 'rotation' }>;
    expect(sealedFor.sealed.map((s) => s.deviceId).sort()).toEqual([fandri.deviceId, budi.deviceId].sort());
    // Dewi's rows are all still on her phone and on everyone else's.
    const descriptions = async (d: Device) => Object.values((await projectBook(d.database, bookId)).purchase!).map((p) => (p as { description: string }).description);
    expect(await descriptions(dewi)).toContain('before Dewi left');
    expect(await descriptions(fandri)).toContain('before Dewi left');
    await expect(spend(dewi, bookId, 'after leaving')).rejects.toBeInstanceOf(BookReadOnlyError);
  });

  it("an owner's removal of one device, flagged as a leave, is only a removal: the member's other devices stay", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const tablet = await secondDevice(home, fandri, dewi, bookId);
    await home.settle();
    const hlc = encodeHlc(Date.now(), 0, fandri.deviceId);
    const forged = await fandri.engine.sealer.sign(bookId, { kind: 'removal' as const, deviceId: fandri.deviceId, epoch: await epochOf(fandri, bookId), hlc, target: dewi.deviceId, leave: true as const });
    await fandri.transport.append(home.relayBookId, forged);
    const result = await tablet.engine.syncOnce(bookId);
    expect(result.ended).toBeUndefined();
    expect(relayRemoved(home, tablet.deviceId)).toBe(false);
    expect(await shared(tablet, bookId)).toEqual(['active', null]);
  });

  it('a member who left comes back through a same-member invite, and the new device stays (fix round 1)', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await dewi.engine.leave(bookId);
    await home.settle([fandri]);
    const back = await home.device('Dewi again', dewi.memberId);
    const { code } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri', sameMember: true, memberId: dewi.memberId });
    const { result } = await back.engine.joinBook(code, { ws: back.ws, memberName: 'Dewi', deviceName: "Dewi's new phone" });
    expect(result.ended).toBeUndefined();
    expect(await shared(back, bookId)).toEqual(['active', null]);
    expect((await back.engine.syncOnce(bookId)).ended).toBeUndefined();
    expect(relayRemoved(home, back.deviceId)).toBe(false);
  });

  it('a restored phone of a member who left rejoins and stays (§8.7, fix round 1)', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const backup = await dewi.database.exportBytes();
    await dewi.engine.leave(bookId);
    await home.settle([fandri]);
    const restored = await home.restore(dewi, backup);
    await restored.engine.checkRestore();
    const { code } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri', sameMember: true, memberId: dewi.memberId });
    const { result } = await restored.engine.joinBook(code, { ws: restored.ws, memberName: 'Dewi', deviceName: "Dewi's restored phone" });
    expect(result.ended).toBeUndefined();
    expect(await shared(restored, bookId)).toEqual(['active', null]);
  });

  it('an owner who leaves steps down first; the other owner, now alone, cannot leave (fix round 1)', async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await fandri.engine.makeOwner(bookId, dewi.memberId);
    await home.settle();
    await dewi.engine.leave(bookId);
    await home.settle([fandri, budi]);
    expect(await roleOf(fandri, bookId, dewi.memberId)).toBe('member');
    await expect(fandri.engine.leave(bookId)).rejects.toBeInstanceOf(LastOwnerError);
    expect(relayRemoved(home, fandri.deviceId)).toBe(false);
    expect(await fandri.engine.isFrozen(bookId)).toBe(false);
  });

  it('an owner whose other owner has no device left is the last one that counts (fix round 1)', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await fandri.engine.makeOwner(bookId, dewi.memberId);
    await home.settle();
    // Dewi's only device goes without stepping down (removed, not left): she is an owner with no device.
    await dewi.engine.removeDevice(bookId, dewi.deviceId);
    await home.settle([fandri]);
    await expect(fandri.engine.leave(bookId)).rejects.toBeInstanceOf(LastOwnerError);
  });

  it('the last owner cannot leave until someone else is owner', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await expect(fandri.engine.leave(bookId)).rejects.toBeInstanceOf(LastOwnerError);
    expect(relayRemoved(home, fandri.deviceId)).toBe(false);
    expect(await shared(fandri, bookId)).toEqual(['active', null]);
    await fandri.engine.makeOwner(bookId, dewi.memberId);
    await home.settle();
    await fandri.engine.leave(bookId);
    expect(relayRemoved(home, fandri.deviceId)).toBe(true);
    await dewi.engine.syncOnce(bookId);
    expect(relayOwners(home)).toEqual([dewi.deviceId]);
  });
});

describe('stop sharing (§8.6)', () => {
  it("the owner's book is an ordinary local book again; every other device goes unshared on its next call, keeping every row", async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await spend(dewi, bookId, 'Dewi groceries');
    const kept = await spend(fandri, bookId, 'Fandri groceries');
    await home.settle();
    const before = await projectBook(dewi.database, bookId);

    await fandri.engine.stopSharing(bookId);
    expect(home.relay.peek(home.relayBookId)!.deleted).toBe(true);
    expect(await shared(fandri, bookId)).toBeUndefined();
    for (const table of ['sync_outbox', 'sync_cursor', 'book_epoch_keys', 'sync_authority', 'sync_authority_devices', 'book_devices', 'sync_field_clocks']) {
      expect(await count(fandri, table, bookId)).toBe(0);
    }
    // An ordinary book: it records, and nothing is captured.
    await spend(fandri, bookId, 'after stopping');
    await renameBook(fandri.database, fandri.ws, bookId, 'Ours, then mine');
    expect(await count(fandri, 'sync_outbox', bookId)).toBe(0);

    const result = await dewi.engine.syncOnce(bookId);
    expect(result.ended).toBe('unshared');
    expect(await shared(dewi, bookId)).toEqual(['unshared', fandri.memberId]);
    expect(await projectBook(dewi.database, bookId)).toEqual(before);
    expect(await dewi.engine.bookSyncStatus(bookId)).toEqual({ state: 'unshared', byMemberId: fandri.memberId, byName: 'Fandri', byYou: false });

    // Read-only: every writer refuses, in the transaction that tried.
    await expect(spend(dewi, bookId, 'after')).rejects.toBeInstanceOf(BookReadOnlyError);
    await expect(renameBook(dewi.database, dewi.ws, bookId, 'Mine now')).rejects.toBeInstanceOf(BookReadOnlyError);
    const [[lineage]] = (await dewi.database.db.values<[string]>(sql`SELECT head_transaction_id FROM sync_lineage WHERE lineage_id = ${kept}`)) as [[string]];
    await expect(voidTransaction(dewi.database, dewi.ws, lineage)).rejects.toBeInstanceOf(BookReadOnlyError);
    expect(await projectBook(dewi.database, bookId)).toEqual(before);
    // A book of Dewi's own is untouched by any of it.
    await expect(
      postTransaction(dewi.database, dewi.ws, {
        occurredOn: '2026-09-11',
        description: 'own money, own book',
        lines: expenseLines({ categoryAccountId: await categoryOf(dewi.database, (await personalBook(dewi.database, dewi.ws)).id, 'Groceries'), paymentAccountId: dewi.bank, amountMinor: 5_000, currency: 'IDR' }),
      }),
    ).resolves.toEqual(expect.any(String));

    // Budi's first call after is a drain: it goes unshared the same way.
    await spend(budi, bookId, 'never sent');
    expect((await budi.engine.syncOnce(bookId)).ended).toBe('unshared');
    expect(await shared(budi, bookId)).toEqual(['unshared', fandri.memberId]);
    expect(await count(budi, 'sync_outbox', bookId)).toBe(0);
  });

  it("drains the owner's outbox before the relay book goes (fix round 1)", async () => {
    const { home, fandri, bookId } = await household();
    await spend(fandri, bookId, 'last words');
    const before = home.relay.peek(home.relayBookId)!.seq;
    await fandri.engine.stopSharing(bookId);
    expect(home.relay.peek(home.relayBookId)!.seq).toBe(before + 1);
  });

  it('is refused to a device whose member is not an owner', async () => {
    const { home, dewi, bookId } = await household();
    await expect(dewi.engine.stopSharing(bookId)).rejects.toBeInstanceOf(NotOwnerError);
    expect(home.relay.peek(home.relayBookId)!.deleted).toBe(false);
  });

  it('a book stopped and shared again seeds afresh', async () => {
    const { home, fandri, bookId } = await household();
    await fandri.engine.stopSharing(bookId);
    await expect(fandri.engine.shareBook(bookId, { memberId: fandri.memberId, memberName: 'Fandri', deviceName: "Fandri's phone" })).resolves.toMatchObject({
      memberId: fandri.memberId,
    });
    expect(await shared(fandri, bookId)).toEqual(['active', null]);
    expect(await roleOf(fandri, bookId, fandri.memberId)).toBe('owner');
    void home;
  });
});

describe('a frozen book (§8.5)', () => {
  async function frozen() {
    const h = await household();
    // The only owner's only device removes itself: no owner device is left in the view.
    await h.fandri.engine.removeDevice(h.bookId, h.fandri.deviceId);
    await h.home.settle([h.dewi, h.budi]);
    return h;
  }

  it('is frozen when no owner device is left; members still record and sync', async () => {
    const { home, dewi, budi, bookId } = await frozen();
    expect(await dewi.engine.isFrozen(bookId)).toBe(true);
    expect(await budi.engine.isFrozen(bookId)).toBe(true);
    await spend(dewi, bookId, 'frozen but recording');
    await home.settle([dewi, budi]);
    const descriptions = Object.values((await projectBook(budi.database, bookId)).purchase!).map((p) => (p as { description: string }).description);
    expect(descriptions).toContain('frozen but recording');
    expect(await dewi.engine.bookSyncStatus(bookId)).toMatchObject({ state: 'frozen' });
  });

  it('nobody can invite, remove another device or make an owner; a device can still remove itself, and rotation works', async () => {
    const { home, dewi, budi, bookId } = await frozen();
    await expect(dewi.engine.createInvite(bookId, { inviterName: 'Dewi' })).rejects.toBeInstanceOf(FrozenBookError);
    await expect(dewi.engine.removeDevice(bookId, budi.deviceId)).rejects.toBeInstanceOf(FrozenBookError);
    await expect(dewi.engine.makeOwner(bookId, dewi.memberId)).rejects.toBeInstanceOf(FrozenBookError);
    const epoch = await epochOf(dewi, bookId);
    await budi.engine.leave(bookId);
    await home.settle([dewi]);
    expect(await epochOf(dewi, bookId)).toBe(epoch + 1);
  });

  it('a book not yet synced is not frozen', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const bookId = await home.share(fandri);
    expect(await fandri.engine.isFrozen(bookId)).toBe(false);
  });
});

describe('the status line (§11)', () => {
  it('up to date, changes waiting, not synced since', async () => {
    const { dewi, bookId } = await household();
    let now = Date.parse('2026-09-27T10:00:00Z');
    const clock = () => now;
    const status = (at?: number) => dewi.engine.bookSyncStatus(bookId, { now: at ?? clock() });
    await dewi.engine.syncOnce(bookId);
    const syncedAt = (await dewi.database.db.values<[string]>(sql`SELECT synced_at FROM shared_books WHERE book_id = ${bookId}`))[0]![0];
    expect(syncedAt).toEqual(expect.any(String));
    now = Date.parse(syncedAt) + 1000;
    expect(await status()).toEqual({ state: 'up_to_date', syncedAt });
    await spend(dewi, bookId, 'one');
    await spend(dewi, bookId, 'two');
    expect(await status()).toEqual({ state: 'waiting', changes: 2, syncedAt });
    expect(await status(Date.parse(syncedAt) + 6 * 60_000)).toEqual({ state: 'stale', since: syncedAt, changes: 2 });
    expect(await dewi.engine.bookSyncStatus('not-a-shared-book')).toBeNull();
  });
});
