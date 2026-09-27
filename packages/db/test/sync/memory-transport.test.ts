import { describe, expect, it } from 'vitest';
import { deviceIdOf, MemoryTransport, stubSign } from '../../src/sync/memory-transport';
import type { DevicePublic, LogEntry, SyncTransport } from '../../src/sync/types';
import { SyncTransportError } from '../../src/sync/types';

let nextKeyOrdinal = 0;
function fixtureDevice(): DevicePublic {
  nextKeyOrdinal += 1;
  return {
    signJwk: { kty: 'EC', crv: 'P-256', x: `x-${nextKeyOrdinal}`, y: `y-${nextKeyOrdinal}` },
    agreeJwk: { kty: 'EC', crv: 'P-256', x: `ax-${nextKeyOrdinal}`, y: `ay-${nextKeyOrdinal}` },
  };
}

function changeEntry(deviceId: string, epoch: number, hlc: string): Extract<LogEntry, { kind: 'change' }> {
  return { kind: 'change', deviceId, epoch, hlc, iv: 'iv', ct: 'ct', sig: stubSign(deviceId) };
}

/** Registers a fresh fixture device as the book's sole owner, returning its bound client and id. */
async function bookWithOwner(transport: MemoryTransport) {
  const ownerPublic = fixtureDevice();
  const ownerId = await deviceIdOf(ownerPublic);
  const owner = transport.as(ownerId);
  const { bookId } = await owner.createBook(ownerPublic);
  return { bookId, owner, ownerId, ownerPublic };
}

describe("MemoryTransport.as: every call is bound to one device and always authorises (can't be skipped via the SyncTransport type)", () => {
  it('createBook refuses to register a device as anyone but itself', async () => {
    const transport = new MemoryTransport();
    const real = fixtureDevice();
    const someoneElseId = await deviceIdOf(fixtureDevice());
    await expect(transport.as(someoneElseId).createBook(real)).rejects.toMatchObject({ status: 403 });
  });

  it('append refuses an entry authored as another device', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const other = fixtureDevice();
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    // `owner` is bound to ownerId, but the entry claims to be authored by otherId.
    await expect(transport.as(ownerId).append(bookId, changeEntry(otherId, 1, 'hlc-1'))).rejects.toMatchObject({ status: 403 });
  });

  it('a variable typed only as SyncTransport (what every real caller holds) still cannot skip authorisation', async () => {
    const transport = new MemoryTransport();
    const { bookId } = await bookWithOwner(transport);
    const strangerId = await deviceIdOf(fixtureDevice());
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
  const invite = {
    inviteId: overrides.inviteId ?? `invite-${Math.random()}`,
    keys: { iv: 'iv', ct: 'ct' },
    preview: { iv: 'iv', ct: 'ct' },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    sameMember: false,
    sig: overrides.sig ?? stubSign(anyCurrentOwner ?? 'no-owner'),
    ...overrides,
  };
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

  it('409s a rotation whose epoch is not current + 1 (the only 409 append gives)', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const badRotation: LogEntry = { kind: 'rotation', deviceId: ownerId, epoch: 5, hlc: 'hlc-1', sealed: [], sig: stubSign(ownerId) };
    await expect(owner.append(bookId, badRotation)).rejects.toMatchObject({ status: 409 });
  });

  it('accepts a rotation exactly at current epoch + 1, and raises the book epoch', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const rotation: LogEntry = { kind: 'rotation', deviceId: ownerId, epoch: 2, hlc: 'hlc-1', sealed: [], sig: stubSign(ownerId) };
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

  it('refuses a removed device', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = fixtureDevice();
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await owner.removeDevice(bookId, otherId);
    await expect(transport.as(otherId).append(bookId, changeEntry(otherId, 1, 'hlc-1'))).rejects.toMatchObject({ status: 401 });
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
    const memberPublic = fixtureDevice();
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
    const joiner = fixtureDevice();
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
    const joiner = fixtureDevice();
    const someoneElseId = await deviceIdOf(fixtureDevice());
    await expect(transport.as(someoneElseId).claimInvite(invite.inviteId, joiner)).rejects.toMatchObject({ status: 403 });
  });

  it('409s a claimed invite', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, owner);
    const first = fixtureDevice();
    const firstId = await deviceIdOf(first);
    await transport.as(firstId).claimInvite(invite.inviteId, first); // claims this exact invite, once
    const second = fixtureDevice();
    const secondId = await deviceIdOf(second);
    await expect(transport.as(secondId).claimInvite(invite.inviteId, second)).rejects.toMatchObject({ status: 409 });
  });

  it('410s an expired invite', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, owner, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const joiner = fixtureDevice();
    const joinerId = await deviceIdOf(joiner);
    await expect(transport.as(joinerId).claimInvite(invite.inviteId, joiner)).rejects.toMatchObject({ status: 410 });
  });

  it('403s a bad owner signature', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner, ownerId } = await bookWithOwner(transport);
    // Stored by the real owner (so putInvite itself is authorised), but the invite's own signature does not name
    // an owner of this book — the relay can tell without decrypting anything (spec §5.4's pinning idea, applied
    // to an invite record rather than a change-set).
    const invite = await putInvite(transport, bookId, owner, { sig: stubSign('someone-else') });
    const joiner = fixtureDevice();
    const joinerId = await deviceIdOf(joiner);
    await expect(transport.as(joinerId).claimInvite(invite.inviteId, joiner)).rejects.toMatchObject({ status: 403 });
  });

  it('429s a sixth device', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    // Owner + 4 more joiners = 5 active devices, the cap.
    for (let i = 0; i < 4; i += 1) await claimAs(transport, bookId, owner, fixtureDevice());
    const sixth = fixtureDevice();
    await expect(claimAs(transport, bookId, owner, sixth)).rejects.toMatchObject({ status: 429 });
  });
});

describe('MemoryTransport: removeDevice (DELETE /books/:id/devices/:deviceId -> 204)', () => {
  it('an owner removes any device', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = fixtureDevice();
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await owner.removeDevice(bookId, otherId);
    expect(transport.peek(bookId)?.devices.get(otherId)?.removedAt).toBeTruthy();
  });

  it('any device removes itself (Leave)', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = fixtureDevice();
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await transport.as(otherId).removeDevice(bookId, otherId);
    expect(transport.peek(bookId)?.devices.get(otherId)?.removedAt).toBeTruthy();
  });

  it('403s a non-owner member removing someone else', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const memberA = fixtureDevice();
    const memberB = fixtureDevice();
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
    const other = fixtureDevice();
    const otherId = await deviceIdOf(other);
    await claimAs(transport, bookId, owner, other);
    await owner.setOwners(bookId, [otherId]);
    expect(transport.peek(bookId)?.owners.has(otherId)).toBe(true);
    expect(transport.peek(bookId)?.owners.has(ownerId)).toBe(false);
  });

  it('403s a non-owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = fixtureDevice();
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

  it('403s a non-owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, owner } = await bookWithOwner(transport);
    const other = fixtureDevice();
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
    const joiner = fixtureDevice();
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
