import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { encodeHlc } from '../../src/sync/hlc';
import { generateDevice } from '../../src/sync/keys';
import { signEntry } from '../../src/sync/seal';
import type { ChangeSet, LogEntry, SequencedEntry, SyncTransport } from '../../src/sync/types';
import { Household, type Device } from './household';

/*
 * Whose key is it (spec §5.4, §13 `pinning.test.ts`): a device trusts a signing key only once it is pinned in its own
 * `book_devices`, and a key is pinned only by an entry that introduces its device — a change-set carrying the device's
 * own `device` row whose key is the one the relay supplied and signed the entry. The relay's key is used for nothing
 * else, so the relay cannot introduce a device, nor swap a pinned one.
 */

async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  return { home, fandri, dewi, bookId };
}

/** Eve holds a device on the relay (she claimed an invite) and, worst case, the epoch key — but never introduced herself. */
async function eveOnTheRelay(home: Household, owner: Device, bookId: string): Promise<Device> {
  const eve = await home.device('Eve');
  const { inviteId } = await owner.engine.createInvite(bookId, { inviterName: owner.name });
  await eve.transport.claimInvite(inviteId, eve.public);
  const key = (await owner.engine.sealer.epochKey(bookId, 1))!;
  await eve.database.transaction((tx) => eve.engine.sealer.storeEpochKeyTx(tx, bookId, 1, key));
  home.devices.splice(home.devices.indexOf(eve), 1);
  return eve;
}

const bookName = async (d: Device, bookId: string) => (await d.database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`))[0]![0];
const cursor = async (d: Device, bookId: string) => (await d.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`))[0]![0];

describe('pinning (§5.4)', () => {
  it('an entry signed by a key the relay supplied, from a device no device op introduced, is refused', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const eve = await eveOnTheRelay(home, fandri, bookId);
    const cs: ChangeSet = { v: 1, hlc: encodeHlc(Date.now(), 0, eve.deviceId), member: 'member-eve', ops: [{ entity: 'book', id: bookId, op: 'upsert', fields: { name: 'Owned' } }] };
    const { seq } = await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, cs));
    const before = await cursor(dewi, bookId);
    const result = await dewi.engine.syncOnce(bookId);
    expect(result.stopped).toEqual({ seq, reason: 'bad signature' });
    expect(await cursor(dewi, bookId)).toBe(before);
    expect(await bookName(dewi, bookId)).toBe('Personal');
    // It stays refused: the next sync stops at the same entry.
    expect((await dewi.engine.syncOnce(bookId)).stopped).toEqual({ seq, reason: 'bad signature' });
  });

  it("an introduction whose device row carries another key than the relay's is refused", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const eve = await eveOnTheRelay(home, fandri, bookId);
    const other = await generateDevice();
    const hlc = encodeHlc(Date.now(), 0, eve.deviceId);
    const cs: ChangeSet = {
      v: 1,
      hlc,
      member: 'member-eve',
      ops: [
        { entity: 'device', id: eve.deviceId, op: 'upsert', fields: { memberId: 'member-eve', name: 'Eve', signJwk: JSON.stringify(other.public.signJwk), agreeJwk: JSON.stringify(other.public.agreeJwk), addedAt: '2026-09-27', removedAt: null } },
        { entity: 'book', id: bookId, op: 'upsert', fields: { name: 'Owned' } },
      ],
    };
    const { seq } = await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, cs));
    expect((await dewi.engine.syncOnce(bookId)).stopped).toEqual({ seq, reason: 'bad signature' });
    expect(await bookName(dewi, bookId)).toBe('Personal');
    expect((await dewi.database.db.values(sql`SELECT 1 FROM book_devices WHERE device_id = ${eve.deviceId}`)).length).toBe(0);
  });

  it('a proper introduction pins the key, and applies', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const eve = await eveOnTheRelay(home, fandri, bookId);
    const cs: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now(), 0, eve.deviceId),
      member: 'member-eve',
      ops: [
        { entity: 'device', id: eve.deviceId, op: 'upsert', fields: { memberId: 'member-eve', name: 'Eve', signJwk: JSON.stringify(eve.public.signJwk), agreeJwk: JSON.stringify(eve.public.agreeJwk), addedAt: '2026-09-27', removedAt: null } },
      ],
    };
    await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, cs));
    const result = await dewi.engine.syncOnce(bookId);
    expect(result.stopped).toBeUndefined();
    expect(result.introduced).toContain(eve.deviceId);
    const [[pinned]] = (await dewi.database.db.values<[string]>(sql`SELECT sign_jwk FROM book_devices WHERE device_id = ${eve.deviceId}`)) as [[string]];
    expect(JSON.parse(pinned)).toEqual(eve.public.signJwk);
  });

  it('once pinned, only the pinned key counts: a relay handing out another key with a forged entry is refused', async () => {
    const { fandri, dewi, bookId } = await household();
    const mallory = await generateDevice();
    // A relay that slips in an entry "from Fandri", signed by its own key, and supplies that key as Fandri's.
    const forged = await signEntry(mallory, {
      kind: 'removal' as const,
      deviceId: fandri.deviceId,
      epoch: 1,
      hlc: encodeHlc(Date.now(), 0, fandri.deviceId),
      target: dewi.deviceId,
    });
    let injectedOnce = false;
    const lying: SyncTransport = Object.assign(Object.create(dewi.transport) as SyncTransport, {
      pull: async (relayBookId: string, since: number) => {
        const real = await dewi.transport.pull(relayBookId, since);
        if (injectedOnce) return real;
        injectedOnce = true;
        const injected: SequencedEntry = { ...(forged as LogEntry), seq: real.latest + 1, signJwk: mallory.public.signJwk };
        return { entries: [...real.entries, injected], latest: real.latest + 1 };
      },
    });
    const { pullAndApply } = await import('../../src/sync/apply');
    const result = await pullAndApply(dewi.database, lying, dewi.engine.sealer, bookId);
    expect(result.stopped?.reason).toBe('bad signature');
    const [[removedAt]] = (await dewi.database.db.values<[string | null]>(sql`SELECT removed_at FROM book_devices WHERE device_id = ${dewi.deviceId}`)) as [[string | null]];
    expect(removedAt).toBeNull();
  });

  it('a removal or rotation from a device never introduced is refused outright', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const eve = await eveOnTheRelay(home, fandri, bookId);
    const removal = await eve.engine.sealer.sign({ kind: 'removal' as const, deviceId: eve.deviceId, epoch: 1, hlc: encodeHlc(Date.now(), 0, eve.deviceId), target: fandri.deviceId });
    const { seq } = await eve.transport.append(home.relayBookId, removal);
    expect((await dewi.engine.syncOnce(bookId)).stopped).toEqual({ seq, reason: 'bad signature' });
  });
});
