import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { addPhoto, createAccount, listAccounts, postTransaction } from '../../src/index';
import { clearSentPhoto, markPhotoHeld, photosEveryoneHolds, photosMissingHere, photosToFetch, photosToSend, recordSentPhoto } from '../../src/self/photos';
import { setupDb } from '../helpers';

vi.setConfig({ testTimeout: 60_000 });

/* Link my devices, Drop 4: which receipt photos a device sends, fetches and lets go. Invented rows. */

const manifest = { hashes: ['a'.repeat(64)], key: 'k', bytes: 3, sha256: 'b'.repeat(64) };
const NOW = Date.parse('2026-11-21T00:00:00Z');

async function withPhoto() {
  const { database, ws } = await setupDb();
  const bank = (await createAccount(database, ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!.id;
  const id = await postTransaction(database, ws, { occurredOn: '2026-11-19', description: 'Test grocer', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 61_000, currency: 'IDR' }) });
  await addPhoto(database, ws, { transactionId: id, fileName: 'test-receipt.jpg', mime: 'image/jpeg', byteSize: 3 });
  for (const [deviceId, name] of [['phone', 'iPhone'], ['mac', 'Mac']] as const) {
    await database.db.run(sql`INSERT INTO self_devices (device_id, name, kind, sign_jwk, agree_jwk, added_at) VALUES (${deviceId}, ${name}, 'phone', '{}', '{}', '2026-11-20')`);
  }
  return database;
}

describe('receipt photos between linked devices', () => {
  it('a photo never sent goes; then the Mac fetches it, and once both hold it the sender lets the blobs go', async () => {
    const database = await withPhoto();
    expect(await photosToSend(database, NOW, 'phone')).toEqual(['test-receipt.jpg']);
    await recordSentPhoto(database, 'test-receipt.jpg', manifest, 'phone', NOW);
    expect(await photosToSend(database, NOW, 'phone')).toEqual([]);
    expect(await photosToFetch(database, 'mac')).toEqual([{ fileName: 'test-receipt.jpg', manifest }]);
    expect(await photosMissingHere(database, 'mac')).toBe(1);
    expect(await photosEveryoneHolds(database, 'phone')).toEqual([]);
    await markPhotoHeld(database, 'test-receipt.jpg', 'mac');
    expect(await photosMissingHere(database, 'mac')).toBe(0);
    expect(await photosEveryoneHolds(database, 'phone')).toEqual([{ fileName: 'test-receipt.jpg', manifest }]);
    await clearSentPhoto(database, 'test-receipt.jpg');
    expect(await photosToFetch(database, 'mac')).toEqual([]);
    expect(await photosToSend(database, NOW, 'phone')).toEqual([]);
  });

  it('a device linked after the blobs went is sent the photo again, by the device that sent it', async () => {
    const database = await withPhoto();
    await recordSentPhoto(database, 'test-receipt.jpg', manifest, 'phone', NOW);
    await markPhotoHeld(database, 'test-receipt.jpg', 'mac');
    await clearSentPhoto(database, 'test-receipt.jpg');
    await database.db.run(sql`INSERT INTO self_devices (device_id, name, kind, sign_jwk, agree_jwk, added_at) VALUES ('ipad', 'iPad', 'tablet', '{}', '{}', '2026-11-21')`);
    expect(await photosToSend(database, NOW, 'phone')).toEqual(['test-receipt.jpg']);
    expect(await photosToSend(database, NOW, 'mac')).toEqual([]);
    // Once the iPhone is unlinked, any device holding the file sends it.
    await database.db.run(sql`UPDATE self_devices SET removed_at = '2026-11-21' WHERE device_id = 'phone'`);
    expect(await photosToSend(database, NOW, 'mac')).toEqual(['test-receipt.jpg']);
  });

  it('blobs a week old are sent again while a device still lacks the file', async () => {
    const database = await withPhoto();
    await recordSentPhoto(database, 'test-receipt.jpg', manifest, 'phone', NOW - 7 * 24 * 60 * 60 * 1000);
    expect(await photosToSend(database, NOW, 'phone')).toEqual(['test-receipt.jpg']);
  });
});
