import { describe, expect, it } from 'vitest';
import { deviceIdOf, MemoryTransport, stubSign } from '../../src/sync/memory-transport';
import type { DevicePublic, LogEntry } from '../../src/sync/types';
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

async function bookWithOwner(transport: MemoryTransport) {
  const ownerPublic = fixtureDevice();
  const { bookId } = await transport.createBook(ownerPublic);
  const ownerId = await deviceIdOf(ownerPublic);
  return { bookId, ownerPublic, ownerId };
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
    const { bookId, ownerId } = await bookWithOwner(transport);
    const first = await transport.append(bookId, changeEntry(ownerId, 1, 'hlc-1'), ownerId);
    const second = await transport.append(bookId, changeEntry(ownerId, 1, 'hlc-2'), ownerId);
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  it('a duplicate (deviceId, hlc) is treated as accepted, answering with the original seq, not an error', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const first = await transport.append(bookId, changeEntry(ownerId, 1, 'hlc-1'), ownerId);
    const replay = await transport.append(bookId, changeEntry(ownerId, 1, 'hlc-1'), ownerId);
    expect(replay).toEqual(first);
    // Nothing new was logged for the replay.
    expect(transport.peek(bookId)?.seq).toBe(1);
  });

  it('409s a rotation whose epoch is not current + 1', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const badRotation: LogEntry = { kind: 'rotation', deviceId: ownerId, epoch: 5, hlc: 'hlc-1', sealed: [], sig: stubSign(ownerId) };
    await expect(transport.append(bookId, badRotation, ownerId)).rejects.toMatchObject({ status: 409 });
  });

  it('accepts a rotation exactly at current epoch + 1, and raises the book epoch', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const rotation: LogEntry = { kind: 'rotation', deviceId: ownerId, epoch: 2, hlc: 'hlc-1', sealed: [], sig: stubSign(ownerId) };
    await transport.append(bookId, rotation, ownerId);
    expect(transport.peek(bookId)?.epoch).toBe(2);
  });

  it('413s an entry over 128 KB', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const entry = changeEntry(ownerId, 1, 'hlc-1');
    (entry as { ct: string }).ct = 'x'.repeat(129 * 1024);
    await expect(transport.append(bookId, entry, ownerId)).rejects.toMatchObject({ status: 413 });
  });

  it('refuses a removed device', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const other = fixtureDevice();
    const { keys } = await claim(transport, bookId, ownerId, other);
    void keys;
    const otherId = await deviceIdOf(other);
    await transport.removeDevice(bookId, otherId, ownerId);
    await expect(transport.append(bookId, changeEntry(otherId, 1, 'hlc-1'), otherId)).rejects.toMatchObject({ status: 401 });
  });

  it('gone (410) once the book is deleted', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    await transport.deleteBook(bookId, ownerId);
    await expect(transport.append(bookId, changeEntry(ownerId, 1, 'hlc-1'), ownerId)).rejects.toMatchObject({ status: 410 });
  });
});

describe('MemoryTransport: pull (GET /books/:id/entries?since=N -> 200)', () => {
  it('returns entries after since, and the latest seq', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    await transport.append(bookId, changeEntry(ownerId, 1, 'hlc-1'), ownerId);
    await transport.append(bookId, changeEntry(ownerId, 1, 'hlc-2'), ownerId);
    const { entries, latest } = await transport.pull(bookId, 1, ownerId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.seq).toBe(2);
    expect(entries[0]!.signJwk).toBeTruthy();
    expect(latest).toBe(2);
  });

  it('caps a page at 500 entries', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    for (let i = 0; i < 510; i += 1) await transport.append(bookId, changeEntry(ownerId, 1, `hlc-${i}`), ownerId);
    const { entries } = await transport.pull(bookId, 0, ownerId);
    expect(entries).toHaveLength(500);
  });
});

async function putInvite(transport: MemoryTransport, bookId: string, ownerId: string, overrides: Partial<Parameters<MemoryTransport['putInvite']>[1]> = {}) {
  const invite = {
    inviteId: overrides.inviteId ?? `invite-${Math.random()}`,
    keys: { iv: 'iv', ct: 'ct' },
    preview: { iv: 'iv', ct: 'ct' },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    sameMember: false,
    sig: stubSign(ownerId),
    ...overrides,
  };
  await transport.putInvite(bookId, invite, ownerId);
  return invite;
}

async function claim(transport: MemoryTransport, bookId: string, ownerId: string, device: DevicePublic) {
  const invite = await putInvite(transport, bookId, ownerId);
  return transport.claimInvite(invite.inviteId, device);
}

describe('MemoryTransport: putInvite (POST /books/:id/invites -> 201, owner only)', () => {
  it('stores the invite for an owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, ownerId);
    const { preview, expiresAt, claimed } = await transport.previewInvite(invite.inviteId);
    expect(preview).toEqual(invite.preview);
    expect(expiresAt).toBe(invite.expiresAt);
    expect(claimed).toBe(false);
  });

  it('403s a non-owner member', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const memberPublic = fixtureDevice();
    await claim(transport, bookId, ownerId, memberPublic);
    const memberId = await deviceIdOf(memberPublic);
    await expect(putInvite(transport, bookId, memberId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('MemoryTransport: previewInvite (GET /invites/:id -> 200 | 404)', () => {
  it('404s an unknown invite', async () => {
    const transport = new MemoryTransport();
    await expect(transport.previewInvite('no-such-invite')).rejects.toMatchObject({ status: 404 });
  });
});

describe('MemoryTransport: claimInvite (POST /invites/:id/claim)', () => {
  it('200s: the new device joins, gets the epoch and keys', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const joiner = fixtureDevice();
    const result = await claim(transport, bookId, ownerId, joiner);
    expect(result.bookId).toBe(bookId);
    expect(result.epoch).toBe(1);
    const joinerId = await deviceIdOf(joiner);
    expect(transport.peek(bookId)?.devices.has(joinerId)).toBe(true);
  });

  it('409s a claimed invite', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, ownerId);
    await transport.claimInvite(invite.inviteId, fixtureDevice());
    await expect(transport.claimInvite(invite.inviteId, fixtureDevice())).rejects.toMatchObject({ status: 409 });
  });

  it('410s an expired invite', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, ownerId, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await expect(transport.claimInvite(invite.inviteId, fixtureDevice())).rejects.toMatchObject({ status: 410 });
  });

  it('403s a bad owner signature', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    // Stored by the real owner (so putInvite itself is authorised), but the invite's own signature does not name
    // an owner of this book — the relay can tell without decrypting anything (spec §5.4's pinning idea, applied
    // to an invite record rather than a change-set).
    const invite = await putInvite(transport, bookId, ownerId, { sig: stubSign('someone-else') });
    await expect(transport.claimInvite(invite.inviteId, fixtureDevice())).rejects.toMatchObject({ status: 403 });
  });

  it('429s a sixth device', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    // Owner + 4 more joiners = 5 active devices, the cap.
    for (let i = 0; i < 4; i += 1) await claim(transport, bookId, ownerId, fixtureDevice());
    await expect(claim(transport, bookId, ownerId, fixtureDevice())).rejects.toMatchObject({ status: 429 });
  });
});

describe('MemoryTransport: removeDevice (DELETE /books/:id/devices/:deviceId -> 204)', () => {
  it('an owner removes any device', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const other = fixtureDevice();
    await claim(transport, bookId, ownerId, other);
    const otherId = await deviceIdOf(other);
    await transport.removeDevice(bookId, otherId, ownerId);
    expect(transport.peek(bookId)?.devices.get(otherId)?.removedAt).toBeTruthy();
  });

  it('any device removes itself (Leave)', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const other = fixtureDevice();
    await claim(transport, bookId, ownerId, other);
    const otherId = await deviceIdOf(other);
    await transport.removeDevice(bookId, otherId, otherId);
    expect(transport.peek(bookId)?.devices.get(otherId)?.removedAt).toBeTruthy();
  });

  it('403s a non-owner member removing someone else', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const memberA = fixtureDevice();
    const memberB = fixtureDevice();
    await claim(transport, bookId, ownerId, memberA);
    await claim(transport, bookId, ownerId, memberB);
    const memberAId = await deviceIdOf(memberA);
    const memberBId = await deviceIdOf(memberB);
    await expect(transport.removeDevice(bookId, memberBId, memberAId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('MemoryTransport: setOwners (PUT /books/:id/owners -> 204, owner only)', () => {
  it('replaces the owner set', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const other = fixtureDevice();
    await claim(transport, bookId, ownerId, other);
    const otherId = await deviceIdOf(other);
    await transport.setOwners(bookId, [otherId], ownerId);
    expect(transport.peek(bookId)?.owners.has(otherId)).toBe(true);
    expect(transport.peek(bookId)?.owners.has(ownerId)).toBe(false);
  });

  it('403s a non-owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const other = fixtureDevice();
    await claim(transport, bookId, ownerId, other);
    const otherId = await deviceIdOf(other);
    await expect(transport.setOwners(bookId, [otherId], otherId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('MemoryTransport: deleteBook (DELETE /books/:id -> 204; later calls -> 410)', () => {
  it('owner deletes the book; every later call answers 410', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    await transport.deleteBook(bookId, ownerId);
    await expect(transport.pull(bookId, 0, ownerId)).rejects.toMatchObject({ status: 410 });
    await expect(transport.append(bookId, changeEntry(ownerId, 1, 'hlc-after-delete'), ownerId)).rejects.toMatchObject({ status: 410 });
    await expect(transport.deleteBook(bookId, ownerId)).rejects.toMatchObject({ status: 410 });
  });

  it('403s a non-owner', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const other = fixtureDevice();
    await claim(transport, bookId, ownerId, other);
    const otherId = await deviceIdOf(other);
    await expect(transport.deleteBook(bookId, otherId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('a deleted book reaches through its invites too', () => {
  it('410s claimInvite once the book is gone', async () => {
    const transport = new MemoryTransport();
    const { bookId, ownerId } = await bookWithOwner(transport);
    const invite = await putInvite(transport, bookId, ownerId);
    await transport.deleteBook(bookId, ownerId);
    await expect(transport.claimInvite(invite.inviteId, fixtureDevice())).rejects.toMatchObject({ status: 410 });
  });
});

describe('an unknown book', () => {
  it('404s', async () => {
    const transport = new MemoryTransport();
    await expect(transport.pull('no-such-book', 0)).rejects.toBeInstanceOf(SyncTransportError);
    await expect(transport.pull('no-such-book', 0)).rejects.toMatchObject({ status: 404 });
  });
});
