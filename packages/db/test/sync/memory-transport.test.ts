import { describe, expect, it } from 'vitest';
import { generateDevice, requestSignerOf, type DeviceKeys } from '../../src/sync/keys';
import { MemoryTransport } from '../../src/sync/memory-transport';
import { bytesToBase64Url, deviceIdOf, inviteSigningBytes, type RequestSigner } from '../../src/sync/relay-signing';
import type { DevicePublic, InviteRecord, LogEntry, SyncTransport } from '../../src/sync/types';
import { SyncTransportError } from '../../src/sync/types';

/** Real P-256 devices (a device id is derived from the raw key, §5.1), remembered by id so a test can sign as one. */
const keysById = new Map<string, DeviceKeys>();
async function fixtureDevice(): Promise<DevicePublic> {
  const keys = await generateDevice();
  keysById.set(keys.deviceId, keys);
  return keys.public;
}

/** An invite signed the way §5.4 says, by the device with this id. */
async function inviteSig(invite: Omit<InviteRecord, 'sig'>, signerId: string): Promise<string> {
  const keys = keysById.get(signerId);
  if (!keys) return 'no-such-signer';
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.sign.privateKey, inviteSigningBytes(invite) as BufferSource);
  return bytesToBase64Url(new Uint8Array(sig));
}

function changeEntry(deviceId: string, epoch: number, hlc: string): Extract<LogEntry, { kind: 'change' }> {
  // The relay never reads an entry's signature (only a device's pinned key does, §5.4): any string will do here.
  return { kind: 'change', deviceId, epoch, hlc, iv: 'iv', ct: 'ct', sig: 'sig' };
}

/** Registers a fresh fixture device as the book's sole owner, returning its bound client and id. */
async function bookWithOwner(transport: MemoryTransport) {
  const ownerPublic = (await fixtureDevice());
  const ownerId = await deviceIdOf(ownerPublic);
  const owner = transport.as(ownerId);
  const { bookId } = await owner.createBook(ownerPublic);
  return { bookId, owner, ownerId, ownerPublic };
}

describe("MemoryTransport.as: every call is bound to one device and always authorises (can't be skipped via the SyncTransport type)", () => {
  it('createBook refuses to register a device as anyone but itself', async () => {
    const transport = new MemoryTransport();
    const real = (await fixtureDevice());
    const someoneElseId = await deviceIdOf((await fixtureDevice()));
    await expect(transport.as(someoneElseId).createBook(real)).rejects.toMatchObject({ status: 403 });
  });

  it('append refuses an entry authored as another device', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const other = (await fixtureDevice());
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    // `owner` is bound to ownerId, but the entry claims to be authored by otherId.
    await expect(transport.as(ownerId).append(bookId, changeEntry(otherId, 1, 'hlc-1'))).rejects.toMatchObject({ status: 403 });
  });

  it('a variable typed only as SyncTransport (what every real caller holds) still cannot skip authorisation', async () => {
    const transport = new MemoryTransport();
    const { bookId } = await bookWithOwner(transport);
    const strangerId = await deviceIdOf((await fixtureDevice()));
    const stranger: SyncTransport = transport.as(strangerId); // the only type a real caller ever sees
    await expect(stranger.pull(bookId, 0)).rejects.toMatchObject({ status: 401 });
  });
});

async function claimAs(transport: MemoryTransport, bookId: string, owner: SyncTransport, device: DevicePublic) {
  const invite = await putInvite(transport, bookId, owner);
  const deviceId = await deviceIdOf(device);
  return transport.as(deviceId).claimInvite(invite.inviteId, device);
}

/**
 * A valid default `sig` comes from whichever device currently owns the book — the tests that care about a *bad*
 * signature pass their own `sig` override; every other test just wants an invite that claims will accept.
 */
async function putInvite(
  transport: MemoryTransport,
  bookId: string,
  owner: SyncTransport,
  overrides: Partial<Parameters<SyncTransport['putInvite']>[1]> = {},
) {
  const [anyCurrentOwner] = transport.peek(bookId)?.owners ?? [];
  const { sig: overrideSig, ...rest } = overrides;
  const unsigned = {
    inviteId: `invite-${Math.random()}`,
    keys: { iv: 'iv', ct: 'ct' },
    preview: { iv: 'iv', ct: 'ct' },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    sameMember: false,
    ...rest,
  };
  const invite = { ...unsigned, sig: overrideSig ?? (await inviteSig(unsigned, anyCurrentOwner ?? 'no-owner')) };
  await owner.putInvite(bookId, invite);
  return invite;
}

describe('MemoryTransport: createBook (POST /books -> 201 { bookId })', () => {
  it('makes the caller the sole owner, at epoch 1', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    expect(bookId).toBeTruthy();
    expect(transport.peek(bookId)?.owners.has(ownerId)).toBe(true);
    expect(transport.peek(bookId)?.epoch).toBe(1);
  });
});

describe('MemoryTransport: append (POST /books/:id/entries)', () => {
  it('201s a fresh entry with an increasing seq', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const first = await owner.append(bookId, changeEntry(ownerId, 1, 'hlc-1'));
    const second = await owner.append(bookId, changeEntry(ownerId, 1, 'hlc-2'));
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  it('a duplicate (deviceId, hlc) is treated as accepted, answering with the original seq, not an error', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const first = await owner.append(bookId, changeEntry(ownerId, 1, 'hlc-1'));
    const replay = await owner.append(bookId, changeEntry(ownerId, 1, 'hlc-1'));
    expect(replay).toEqual(first);
    // Nothing new was logged for the replay.
    expect(transport.peek(bookId)?.seq).toBe(1);
  });

  it('409s a rotation whose epoch is not current + 1', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const badRotation: LogEntry = { kind: 'rotation', deviceId: ownerId, epoch: 5, hlc: 'hlc-1', sealed: [], sig: 'sig' };
    await expect(owner.append(bookId, badRotation)).rejects.toMatchObject({ status: 409 });
  });

  it('409s a change sealed under an epoch older than the book’s: stale epoch (final review, I1)', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    await owner.append(bookId, { kind: 'rotation', deviceId: ownerId, epoch: 2, hlc: 'r-2', sealed: [], sig: 'sig' });
    await expect(owner.append(bookId, changeEntry(ownerId, 1, 'hlc-stale'))).rejects.toMatchObject({ status: 409, message: 'stale epoch' });
    await expect(owner.append(bookId, changeEntry(ownerId, 2, 'hlc-fresh'))).resolves.toEqual({ seq: 2 });
  });

  it('accepts a rotation exactly at current epoch + 1, and raises the book epoch', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const rotation: LogEntry = { kind: 'rotation', deviceId: ownerId, epoch: 2, hlc: 'hlc-1', sealed: [], sig: 'sig' };
    await owner.append(bookId, rotation);
    expect(transport.peek(bookId)?.epoch).toBe(2);
  });

  it('413s an entry over 128 KB', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const entry = changeEntry(ownerId, 1, 'hlc-1');
    (entry as { ct: string }).ct = 'x'.repeat(129 * 1024);
    await expect(owner.append(bookId, entry)).rejects.toMatchObject({ status: 413 });
  });

  it('403s a removed device, saying so (final review, I2): a device the book never had stays 401', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = (await fixtureDevice());
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await owner.removeDevice(bookId, otherId);
    await expect(transport.as(otherId).append(bookId, changeEntry(otherId, 1, 'hlc-1'))).rejects.toMatchObject({ status: 403, message: 'removed' });
    await expect(transport.as(otherId).pull(bookId, 0)).rejects.toMatchObject({ status: 403, message: 'removed' });
    const stranger = await deviceIdOf(await fixtureDevice());
    await expect(transport.as(stranger).pull(bookId, 0)).rejects.toMatchObject({ status: 401 });
  });

  it('gone (410) once the book is deleted', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    await owner.deleteBook(bookId);
    await expect(owner.append(bookId, changeEntry(ownerId, 1, 'hlc-1'))).rejects.toMatchObject({ status: 410 });
  });
});

describe('MemoryTransport: pull (GET /books/:id/entries?since=N -> 200)', () => {
  it('returns entries after since, and the latest seq', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    await owner.append(bookId, changeEntry(ownerId, 1, 'hlc-1'));
    await owner.append(bookId, changeEntry(ownerId, 1, 'hlc-2'));
    const { entries, latest } = await owner.pull(bookId, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.seq).toBe(2);
    expect(entries[0]!.signJwk).toBeTruthy();
    expect(latest).toBe(2);
  });

  it('caps a page at 500 entries', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    for (let i = 0; i < 510; i += 1) await owner.append(bookId, changeEntry(ownerId, 1, `hlc-${i}`));
    const { entries } = await owner.pull(bookId, 0);
    expect(entries).toHaveLength(500);
  });
});

describe('MemoryTransport: putInvite (POST /books/:id/invites -> 201, owner only)', () => {
  it('stores the invite for an owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, owner);
    const { preview, expiresAt, claimed } = await owner.previewInvite(invite.inviteId);
    expect(preview).toEqual(invite.preview);
    expect(expiresAt).toBe(invite.expiresAt);
    expect(claimed).toBe(false);
  });

  it('403s a non-owner member', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const memberPublic = (await fixtureDevice());
    await claimAs(transport, bookId, owner, memberPublic);
    const memberId = await deviceIdOf(memberPublic);
    await expect(putInvite(transport, bookId, transport.as(memberId))).rejects.toMatchObject({ status: 403 });
  });
});

describe('MemoryTransport: previewInvite (GET /invites/:id -> 200 | 404)', () => {
  it('404s an unknown invite', async () => {
    const transport = new MemoryTransport();
    await expect(transport.as('anyone').previewInvite('no-such-invite')).rejects.toMatchObject({ status: 404 });
  });
});

describe('MemoryTransport: claimInvite (POST /invites/:id/claim)', () => {
  it('200s: the new device joins, gets the epoch and keys', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const joiner = (await fixtureDevice());
    const invite = await putInvite(transport, bookId, owner);
    const joinerId = await deviceIdOf(joiner);
    const result = await transport.as(joinerId).claimInvite(invite.inviteId, joiner);
    expect(result.bookId).toBe(bookId);
    expect(result.epoch).toBe(1);
    expect(transport.peek(bookId)?.devices.has(joinerId)).toBe(true);
  });

  it('refuses to claim as a device other than the caller is bound to', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, owner);
    const joiner = (await fixtureDevice());
    const someoneElseId = await deviceIdOf((await fixtureDevice()));
    await expect(transport.as(someoneElseId).claimInvite(invite.inviteId, joiner)).rejects.toMatchObject({ status: 403 });
  });

  it('409s a claimed invite', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, owner);
    const first = (await fixtureDevice());
    const firstId = await deviceIdOf(first);
    await transport.as(firstId).claimInvite(invite.inviteId, first); // claims this exact invite, once
    const second = (await fixtureDevice());
    const secondId = await deviceIdOf(second);
    await expect(transport.as(secondId).claimInvite(invite.inviteId, second)).rejects.toMatchObject({ status: 409 });
  });

  it('410s an expired invite', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, owner, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const joiner = (await fixtureDevice());
    const joinerId = await deviceIdOf(joiner);
    await expect(transport.as(joinerId).claimInvite(invite.inviteId, joiner)).rejects.toMatchObject({ status: 410 });
  });

  it('403s a bad owner signature', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    // Stored by the real owner (so putInvite itself is authorised), but the invite's own signature does not name
    // an owner of this book — the relay can tell without decrypting anything (spec §5.4's pinning idea, applied
    // to an invite record rather than a change-set).
    const stranger = await deviceIdOf(await fixtureDevice());
    const invite = await putInvite(transport, bookId, owner, { sig: await inviteSig({ inviteId: 'x', keys: { iv: '', ct: '' }, preview: { iv: '', ct: '' }, expiresAt: '', sameMember: false }, stranger) });
    const joiner = (await fixtureDevice());
    const joinerId = await deviceIdOf(joiner);
    await expect(transport.as(joinerId).claimInvite(invite.inviteId, joiner)).rejects.toMatchObject({ status: 403 });
  });

  it('429s a sixth device', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    // Owner + 4 more joiners = 5 active devices, the cap.
    for (let i = 0; i < 4; i += 1) await claimAs(transport, bookId, owner, (await fixtureDevice()));
    const sixth = (await fixtureDevice());
    await expect(claimAs(transport, bookId, owner, sixth)).rejects.toMatchObject({ status: 429 });
  });
});

describe('MemoryTransport: removeDevice (DELETE /books/:id/devices/:deviceId -> 204)', () => {
  it('an owner removes any device', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = (await fixtureDevice());
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await owner.removeDevice(bookId, otherId);
    expect(transport.peek(bookId)?.devices.get(otherId)?.removedAt).toBeTruthy();
  });

  it('any device removes itself (Leave)', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = (await fixtureDevice());
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await transport.as(otherId).removeDevice(bookId, otherId);
    expect(transport.peek(bookId)?.devices.get(otherId)?.removedAt).toBeTruthy();
  });

  it('403s a non-owner member removing someone else', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const memberA = (await fixtureDevice());
    const memberB = (await fixtureDevice());
    await claimAs(transport, bookId, owner, memberA);
    await claimAs(transport, bookId, owner, memberB);
    const memberAId = await deviceIdOf(memberA);
    const memberBId = await deviceIdOf(memberB);
    await expect(transport.as(memberAId).removeDevice(bookId, memberBId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('MemoryTransport: setOwners (PUT /books/:id/owners -> 204, owner only)', () => {
  it('replaces the owner set', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const other = (await fixtureDevice());
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await owner.setOwners(bookId, [otherId]);
    expect(transport.peek(bookId)?.owners.has(otherId)).toBe(true);
    expect(transport.peek(bookId)?.owners.has(ownerId)).toBe(false);
  });

  it('403s a non-owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = (await fixtureDevice());
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await expect(transport.as(otherId).setOwners(bookId, [otherId])).rejects.toMatchObject({ status: 403 });
  });
});

describe('MemoryTransport: deleteBook (DELETE /books/:id -> 204; later calls -> 410)', () => {
  it('owner deletes the book; every later call answers 410', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    await owner.deleteBook(bookId);
    await expect(owner.pull(bookId, 0)).rejects.toMatchObject({ status: 410 });
    await expect(owner.append(bookId, changeEntry(ownerId, 1, 'hlc-after-delete'))).rejects.toMatchObject({ status: 410 });
    await expect(owner.deleteBook(bookId)).rejects.toMatchObject({ status: 410 });
  });

  it('every later 410 names the device that deleted the book (§8.6, task 9a)', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    await owner.deleteBook(bookId);
    await expect(owner.pull(bookId, 0)).rejects.toMatchObject({ status: 410, deletedBy: ownerId });
  });

  it('names deletedBy only to a caller whose signature verifies against its pinned key; before that, a bare 410 (fix round 1)', async () => {
    const transport = new MemoryTransport();
    const ownerKeys = await generateDevice();
    const owner = transport.as(requestSignerOf(ownerKeys));
    const { bookId } = await owner.createBook(ownerKeys.public);
    await owner.deleteBook(bookId);
    await expect(owner.pull(bookId, 0)).rejects.toMatchObject({ status: 410, deletedBy: ownerKeys.deviceId });
    const stranger = await generateDevice();
    const bare = async (t: SyncTransport) => {
      const error = await t.pull(bookId, 0).then(() => null, (e: unknown) => e as SyncTransportError);
      expect(error).toMatchObject({ status: 410 });
      expect(error!.deletedBy).toBeUndefined();
    };
    await bare(transport.as(requestSignerOf(stranger)));
    // Claiming to be the owner, signing with another key.
    const impostor: RequestSigner = { deviceId: ownerKeys.deviceId, publicJwk: stranger.public.signJwk, sign: (b) => requestSignerOf(stranger).sign(b) };
    await bare(transport.as(impostor));
  });

  it('403s a non-owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = (await fixtureDevice());
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await expect(transport.as(otherId).deleteBook(bookId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('a deleted book reaches through its invites too', () => {
  it('410s claimInvite once the book is gone', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, owner);
    await owner.deleteBook(bookId);
    const joiner = (await fixtureDevice());
    const joinerId = await deviceIdOf(joiner);
    await expect(transport.as(joinerId).claimInvite(invite.inviteId, joiner)).rejects.toMatchObject({ status: 410 });
  });
});

describe('an unknown book', () => {
  it('404s', async () => {
    const transport = new MemoryTransport();
    const client = transport.as('anyone');
    await expect(client.pull('no-such-book', 0)).rejects.toBeInstanceOf(SyncTransportError);
    await expect(client.pull('no-such-book', 0)).rejects.toMatchObject({ status: 404 });
  });
});

describe('MemoryTransport.as(signer): every request is signed and checked the way the relay checks it (§9.1)', () => {
  async function signerFor(): Promise<{ keys: DeviceKeys; signer: RequestSigner }> {
    const keys = await generateDevice();
    keysById.set(keys.deviceId, keys);
    return { keys, signer: requestSignerOf(keys) };
  }

  it('a device signing with its own key creates a book, appends and pulls', async () => {
    const transport = new MemoryTransport();
    const { keys, signer } = await signerFor();
    const client = transport.as(signer);
    const { bookId } = await client.createBook(keys.public);
    await client.append(bookId, changeEntry(keys.deviceId, 1, 'hlc-1'));
    await expect(client.pull(bookId, 0)).resolves.toMatchObject({ latest: 1 });
  });

  it('401s a request signed by another key than the one pinned for the device', async () => {
    const transport = new MemoryTransport();
    const { keys, signer } = await signerFor();
    const { bookId } = await transport.as(signer).createBook(keys.public);
    const { signer: otherSigner } = await signerFor();
    const forged: RequestSigner = { deviceId: keys.deviceId, publicJwk: keys.public.signJwk, sign: (bytes) => otherSigner.sign(bytes) };
    await expect(transport.as(forged).pull(bookId, 0)).rejects.toMatchObject({ status: 401 });
  });

  it('403s registering a key that is not the caller\'s, and 401s a registration it did not sign', async () => {
    const transport = new MemoryTransport();
    const { signer } = await signerFor();
    const { keys: other, signer: otherSigner } = await signerFor();
    await expect(transport.as(signer).createBook(other.public)).rejects.toMatchObject({ status: 403 });
    const unsigned: RequestSigner = { ...otherSigner, deviceId: other.deviceId, sign: (bytes) => signer.sign(bytes) };
    await expect(transport.as(unsigned).createBook(other.public)).rejects.toMatchObject({ status: 401 });
  });
});
