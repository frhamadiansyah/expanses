import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrate } from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { randomBytes } from '../../src/sync/crypto';
import { generateDevice } from '../../src/sync/keys';
import { base64UrlToBytes, bytesToBase64Url } from '../../src/sync/relay-signing';
import { MissingEpochKeyError, Sealer, verifyEntry } from '../../src/sync/seal';
import type { ChangeSet, LogEntry } from '../../src/sync/types';

/*
 * The real sealer (spec §5.5, §6.6): a change-set is deflated, encrypted under the book's epoch key bound to
 * `bookId:epoch:deviceId`, and signed over the entry without its signature; the epoch key itself is kept sealed for this
 * device's own agreement key, so the same database under another device's keys opens nothing.
 */

const changeSet: ChangeSet = {
  v: 1,
  hlc: '000001912d59a2ac0000-device-a',
  member: 'member-1',
  ops: [{ entity: 'category', id: 'cat-1', op: 'upsert', fields: { name: 'Belanja 🍜' } }],
};

async function sealerWithKey(epoch = 1) {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const device = await generateDevice();
  const sealer = new Sealer(database, device);
  const key = randomBytes(32);
  await database.transaction((tx) => sealer.storeEpochKeyTx(tx, 'book-1', epoch, key));
  return { database, device, sealer, key };
}

describe('Sealer', () => {
  it('seals a change-set into a signed change entry that opens back to it, and carries no plaintext', async () => {
    const { sealer, device } = await sealerWithKey();
    const entry = await sealer.seal('book-1', 1, changeSet);
    expect(entry).toMatchObject({ kind: 'change', deviceId: device.deviceId, epoch: 1, hlc: changeSet.hlc });
    expect(JSON.stringify(entry)).not.toContain('Belanja');
    expect(JSON.stringify(entry)).not.toContain('cat-1');
    expect(base64UrlToBytes(entry.iv)).toHaveLength(12);
    await expect(sealer.open('book-1', entry)).resolves.toEqual(changeSet);
    await expect(verifyEntry(device.public.signJwk, 'book-1', entry)).resolves.toBe(true);
  });

  it('a fresh iv every time: the same change-set never seals to the same bytes', async () => {
    const { sealer } = await sealerWithKey();
    const a = await sealer.seal('book-1', 1, changeSet);
    const b = await sealer.seal('book-1', 1, changeSet);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('the ciphertext is bound to book, epoch and author: moving it anywhere else fails to open', async () => {
    const { sealer, database, key } = await sealerWithKey();
    const entry = await sealer.seal('book-1', 1, changeSet);
    await expect(sealer.open('book-1', { ...entry, deviceId: 'someone-else' })).rejects.toThrow();
    await database.transaction((tx) => sealer.storeEpochKeyTx(tx, 'book-2', 1, key));
    await expect(sealer.open('book-2', entry)).rejects.toThrow();
    const ct = base64UrlToBytes(entry.ct);
    ct[0] = ct[0]! ^ 1;
    await expect(sealer.open('book-1', { ...entry, ct: bytesToBase64Url(ct) })).rejects.toThrow();
  });

  it('the signature covers every field and verifies under no other key', async () => {
    const { sealer, device } = await sealerWithKey();
    const entry = await sealer.seal('book-1', 1, changeSet);
    await expect(verifyEntry(device.public.signJwk, 'book-1', { ...entry, hlc: '000001912d59a2ac0001-device-a' })).resolves.toBe(false);
    await expect(verifyEntry(device.public.signJwk, 'book-1', { ...entry, epoch: 2 })).resolves.toBe(false);
    const other = await generateDevice();
    await expect(verifyEntry(other.public.signJwk, 'book-1', entry)).resolves.toBe(false);
    // What the relay adds on the way back (seq, the author's key) is not signed and does not break the signature.
    await expect(verifyEntry(device.public.signJwk, 'book-1', { ...entry, seq: 4, signJwk: device.public.signJwk } as LogEntry)).resolves.toBe(true);
  });

  it('removal and rotation entries are signed the same way', async () => {
    const { sealer, device } = await sealerWithKey();
    const removal = await sealer.sign('book-1', { kind: 'removal' as const, deviceId: device.deviceId, epoch: 1, hlc: changeSet.hlc, target: 'x' });
    await expect(verifyEntry(device.public.signJwk, 'book-1', removal)).resolves.toBe(true);
    await expect(verifyEntry(device.public.signJwk, 'book-1', { ...removal, target: 'y' })).resolves.toBe(false);
    // The book is signed too (I1): the same removal replayed into another book does not verify there.
    await expect(verifyEntry(device.public.signJwk, 'book-2', removal)).resolves.toBe(false);
  });

  it('without the epoch key it says so, rather than failing some other way', async () => {
    const { sealer } = await sealerWithKey();
    await expect(sealer.seal('book-1', 2, changeSet)).rejects.toBeInstanceOf(MissingEpochKeyError);
    const entry = await sealer.seal('book-1', 1, changeSet);
    await expect(sealer.open('book-1', { ...entry, epoch: 7 })).rejects.toBeInstanceOf(MissingEpochKeyError);
  });

  it('epoch keys at rest open only with the device that stored them (§5.5)', async () => {
    const { database, sealer, key } = await sealerWithKey();
    const [[stored]] = (await database.db.values<[string]>(sql`SELECT key_sealed FROM book_epoch_keys`)) as [[string]];
    expect(stored).not.toContain(bytesToBase64Url(key));
    await expect(sealer.epochKey('book-1', 1)).resolves.toEqual(key);
    const stranger = new Sealer(database, await generateDevice());
    await expect(stranger.epochKey('book-1', 1)).resolves.toBeNull();
  });
});
