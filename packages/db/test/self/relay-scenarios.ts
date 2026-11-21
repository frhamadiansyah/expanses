import { expect } from 'vitest';
import type { DeviceKeys } from '../../src/sync/keys';
import { bytesToBase64Url, inviteSigningBytes, sha256Hex } from '../../src/sync/relay-signing';
import type { InviteRecord } from '../../src/sync/types';
import { SyncTransportError } from '../../src/sync/types';
import { commitOf, newNonce } from '../../src/self/link-crypto';
import type { SelfTransport } from '../../src/self/transport';

/*
 * Link my devices, Drop 2: the relay's new rules — the link meeting place, blobs, a self book's pruning — as scenarios
 * any `SelfTransport` must pass. Run against `MemoryTransport` (packages/db) and against the real Worker through
 * `RelayTransport` (apps/relay), so the two relays answer alike.
 */

export interface Party {
  keys: DeviceKeys;
  transport: SelfTransport;
}
export type MakeParty = () => Promise<Party>;

/** An invite to the book signed by its owner (the relay checks the signature, never what is sealed inside). */
async function invite(owner: Party, bookId: string, extra: Partial<InviteRecord> = {}): Promise<string> {
  const unsigned: Omit<InviteRecord, 'sig'> = {
    inviteId: crypto.randomUUID(),
    keys: { iv: 'aXY', ct: 'Y3Q' },
    preview: { iv: 'aXY', ct: 'Y3Q' },
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    sameMember: true,
    memberId: 'self',
    ...extra,
  };
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, owner.keys.sign.privateKey, inviteSigningBytes(unsigned) as BufferSource);
  await owner.transport.putInvite(bookId, { ...unsigned, sig: bytesToBase64Url(new Uint8Array(sig)) });
  return unsigned.inviteId;
}

async function refused(work: Promise<unknown>, status: number): Promise<void> {
  const error = await work.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(SyncTransportError);
  expect((error as SyncTransportError).status).toBe(status);
}

/** A code, claimed once, then each nonce in turn; the source alone allows; the welcome reaches the new device only. */
export async function linkMeeting(make: MakeParty): Promise<void> {
  const [source, joiner, stranger] = [await make(), await make(), await make()];
  const started = await source.transport.startLink(source.keys.public);
  expect(started.code).toMatch(/^\d{6}$/);
  expect(Date.parse(started.expiresAt) - Date.now()).toBeGreaterThan(9 * 60 * 1000);
  expect(Date.parse(started.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);

  const nonce = newNonce();
  const claimed = await joiner.transport.claimLink(started.code!, joiner.keys.public, await commitOf(nonce));
  expect(claimed.status).toBe('claimed');
  expect(claimed.source.deviceId).toBe(source.keys.deviceId);
  expect(claimed.code).toBeUndefined();
  // Claimed once: the code works for nobody else, and a stranger learns nothing of the session.
  await refused(stranger.transport.claimLink(started.code!, stranger.keys.public, await commitOf(newNonce())), 404);
  await refused(stranger.transport.readLink(started.sessionId), 404);
  // The new device goes second.
  await refused(joiner.transport.revealLink(started.sessionId, nonce), 409);
  const sourceNonce = newNonce();
  await source.transport.revealLink(started.sessionId, sourceNonce);
  const seen = await joiner.transport.revealLink(started.sessionId, nonce);
  expect(seen.sourceNonce).toBe(sourceNonce);
  const read = await source.transport.readLink(started.sessionId);
  expect([read.joinerNonce, read.commit]).toEqual([nonce, await commitOf(nonce)]);
  // Only the source allows.
  const welcome = { deviceId: joiner.keys.deviceId, epoch: 1, ephJwk: {}, iv: 'aXY', ct: 'Y3Q' };
  await refused(joiner.transport.allowLink(started.sessionId, welcome), 403);
  await source.transport.allowLink(started.sessionId, welcome);
  expect((await joiner.transport.readLink(started.sessionId)).welcome).toEqual(welcome);
  expect((await source.transport.readLink(started.sessionId)).welcome).toBeUndefined();
  expect((await joiner.transport.readLink(started.sessionId)).status).toBe('allowed');
}

/** Five wrong codes burn the session open now, and stop the device that tried them for a while. */
export async function linkWrongCodes(make: MakeParty): Promise<void> {
  const [source, guesser, owner] = [await make(), await make(), await make()];
  const started = await source.transport.startLink(source.keys.public);
  const wrong = String((Number(started.code) + 1) % 1_000_000).padStart(6, '0');
  for (let i = 0; i < 5; i += 1) await refused(guesser.transport.claimLink(wrong, guesser.keys.public, await commitOf(newNonce())), 404);
  expect((await source.transport.readLink(started.sessionId)).status).toBe('burned');
  await refused(guesser.transport.claimLink(started.code!, guesser.keys.public, await commitOf(newNonce())), 429);
  await refused(owner.transport.claimLink(started.code!, owner.keys.public, await commitOf(newNonce())), 404);
}

/** Declined: the session ends and its code with it. */
export async function linkDeclined(make: MakeParty): Promise<void> {
  const [source, joiner, late] = [await make(), await make(), await make()];
  const started = await source.transport.startLink(source.keys.public);
  await joiner.transport.claimLink(started.code!, joiner.keys.public, await commitOf(newNonce()));
  await source.transport.declineLink(started.sessionId);
  expect((await joiner.transport.readLink(started.sessionId)).status).toBe('declined');
  await refused(late.transport.claimLink(started.code!, late.keys.public, await commitOf(newNonce())), 404);
  await refused(source.transport.allowLink(started.sessionId, { deviceId: joiner.keys.deviceId, epoch: 1, ephJwk: {}, iv: 'aXY', ct: 'Y3Q' }), 409);
}

/** Blobs: stored under the hash of their bytes, at most 700 KB, read back only by a device of the book. */
export async function blobs(make: MakeParty): Promise<void> {
  const [owner, stranger] = [await make(), await make()];
  const { bookId } = await owner.transport.createSelfBook(owner.keys.public);
  const bytes = crypto.getRandomValues(new Uint8Array(64 * 1024));
  const hash = await sha256Hex(bytes);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await owner.transport.putBlob(bookId, hash, bytesToBase64Url(bytes), expiresAt);
  expect(await owner.transport.getBlob(bookId, hash)).toBe(bytesToBase64Url(bytes));
  await refused(owner.transport.putBlob(bookId, hash, bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))), expiresAt), 400);
  const big = new Uint8Array(700 * 1024 + 1);
  await refused(owner.transport.putBlob(bookId, await sha256Hex(big), bytesToBase64Url(big), expiresAt), 413);
  await refused(owner.transport.putBlob(bookId, hash, bytesToBase64Url(bytes), new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()), 400);
  await refused(stranger.transport.getBlob(bookId, hash), 401);
  await owner.transport.deleteBlob(bookId, hash);
  await refused(owner.transport.getBlob(bookId, hash), 404);
}

/** A self book drops what every active device has acked; a household book is never pruned. */
export async function pruning(make: MakeParty): Promise<void> {
  const [phone, mac] = [await make(), await make()];
  const { bookId } = await phone.transport.createSelfBook(phone.keys.public);
  const change = (device: Party, n: number) => ({ kind: 'change' as const, deviceId: device.keys.deviceId, epoch: 1, hlc: `${n.toString(16).padStart(12, '0')}0000-${device.keys.deviceId}`, iv: 'aXY', ct: 'Y3Q', sig: 'c2ln' });
  for (let n = 1; n <= 3; n += 1) await phone.transport.append(bookId, change(phone, n));
  const inviteId = await invite(phone, bookId);

  const claim = await mac.transport.claimInvite(inviteId, mac.keys.public);
  expect(claim.seq).toBe(3);
  for (let n = 4; n <= 5; n += 1) await phone.transport.append(bookId, change(phone, n));
  await phone.transport.ack(bookId, 5);
  // The Mac joined at 3 and has read nothing since: only what it already had goes.
  await refused(mac.transport.pull(bookId, 0), 410);
  expect((await mac.transport.pull(bookId, 3)).entries.map((e) => e.seq)).toEqual([4, 5]);
  await mac.transport.ack(bookId, 5);
  expect((await phone.transport.pull(bookId, 5)).entries).toEqual([]);
  await refused(phone.transport.pull(bookId, 4), 410);
  await refused(phone.transport.ack(bookId, 99), 400);
  const { bookId: household } = await phone.transport.createBook(phone.keys.public);
  await phone.transport.append(household, change(phone, 1));
  await refused(phone.transport.ack(household, 1), 400);
}

/** A copy taken at seq 2 for a device still to claim its invite holds the log after 2; the claim starts it there. */
export async function copyHold(make: MakeParty): Promise<void> {
  const [phone, mac] = [await make(), await make()];
  const { bookId } = await phone.transport.createSelfBook(phone.keys.public);
  const change = (n: number) => ({ kind: 'change' as const, deviceId: phone.keys.deviceId, epoch: 1, hlc: `${n.toString(16).padStart(12, '0')}0000-${phone.keys.deviceId}`, iv: 'aXY', ct: 'Y3Q', sig: 'c2ln' });
  for (let n = 1; n <= 2; n += 1) await phone.transport.append(bookId, change(n));
  const inviteId = await invite(phone, bookId, { startSeq: 2 });
  for (let n = 3; n <= 5; n += 1) await phone.transport.append(bookId, change(n));
  await phone.transport.ack(bookId, 5);
  // Only what the copy already holds went; what came after waits for the new device.
  await refused(phone.transport.pull(bookId, 1), 410);
  expect((await phone.transport.pull(bookId, 2)).entries.map((e) => e.seq)).toEqual([3, 4, 5]);
  const claim = await mac.transport.claimInvite(inviteId, mac.keys.public);
  expect(claim.seq).toBe(2);
  expect((await mac.transport.pull(bookId, 2)).entries.map((e) => e.seq)).toEqual([3, 4, 5]);
}
