import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyEntitlement } from '../src/entitlement';
import type { InviteRecord, SequencedEntry } from '../../../packages/db/src/sync/types';
import { change, makeDevice, raw, rotation, signedInvite, startRelay, type TestDevice } from './helpers';

/*
 * The relay's contract (spec §9.1, §9.2), status by status, against the real Worker running locally. The outcomes
 * are the ones `MemoryTransport` (packages/db/src/sync/memory-transport.ts) reaches for the same calls.
 */

let relay: Awaited<ReturnType<typeof startRelay>>;
let base: string;

beforeAll(async () => {
  relay = await startRelay();
  base = relay.url;
});

afterAll(async () => {
  await relay?.close();
});

async function bookWithOwner() {
  const owner = await makeDevice(base);
  const { bookId } = await owner.transport.createBook(owner.devicePublic);
  return { bookId, owner };
}

/** A fresh device joins `bookId` by an invite `owner` signs. */
async function join(bookId: string, owner: TestDevice, overrides: Partial<InviteRecord> = {}) {
  const joiner = await makeDevice(base);
  const invite = await signedInvite(owner, overrides);
  await owner.transport.putInvite(bookId, invite);
  const claim = await joiner.transport.claimInvite(invite.inviteId, joiner.devicePublic);
  return { joiner, claim, invite };
}

describe('§10 entitlement', () => {
  it('verifyEntitlement answers true until tiers exist', async () => {
    await expect(verifyEntitlement('any-book')).resolves.toBe(true);
  });
});

describe('§9.1 authentication', () => {
  it('accepts a correctly signed request', async () => {
    const { bookId, owner } = await bookWithOwner();
    const res = await raw(base, { method: 'GET', path: `/books/${bookId}/entries?since=0`, signer: owner.signer });
    expect(res.status).toBe(200);
  });

  it('401s a timestamp more than 5 minutes behind', async () => {
    const { bookId, owner } = await bookWithOwner();
    const path = `/books/${bookId}/entries?since=0`;
    const res = await raw(base, { method: 'GET', path, signer: owner.signer, timestamp: Date.now() - 6 * 60 * 1000 });
    expect(res.status).toBe(401);
  });

  it('401s a timestamp more than 5 minutes ahead', async () => {
    const { bookId, owner } = await bookWithOwner();
    const path = `/books/${bookId}/entries?since=0`;
    const res = await raw(base, { method: 'GET', path, signer: owner.signer, timestamp: Date.now() + 6 * 60 * 1000 });
    expect(res.status).toBe(401);
  });

  it('accepts a timestamp 4 minutes off', async () => {
    const { bookId, owner } = await bookWithOwner();
    const path = `/books/${bookId}/entries?since=0`;
    const res = await raw(base, { method: 'GET', path, signer: owner.signer, timestamp: Date.now() - 4 * 60 * 1000 });
    expect(res.status).toBe(200);
  });

  it('401s a request with no auth headers', async () => {
    const { bookId } = await bookWithOwner();
    const res = await raw(base, { method: 'GET', path: `/books/${bookId}/entries?since=0`, signer: null });
    expect(res.status).toBe(401);
  });

  it('401s a device the book has never seen, even with a valid signature', async () => {
    const { bookId } = await bookWithOwner();
    const stranger = await makeDevice(base);
    const res = await raw(base, { method: 'GET', path: `/books/${bookId}/entries?since=0`, signer: stranger.signer });
    expect(res.status).toBe(401);
    await expect(stranger.transport.append(bookId, change(stranger.deviceId, 'h1'))).rejects.toMatchObject({ status: 401 });
  });

  it('401s a removed device on pull and append', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await owner.transport.removeDevice(bookId, joiner.deviceId);
    await expect(joiner.transport.pull(bookId, 0)).rejects.toMatchObject({ status: 401 });
    await expect(joiner.transport.append(bookId, change(joiner.deviceId, 'h1'))).rejects.toMatchObject({ status: 401 });
  });

  it("401s a member's id signed with someone else's key", async () => {
    const { bookId, owner } = await bookWithOwner();
    const impostor = await makeDevice(base);
    const res = await raw(base, {
      method: 'GET',
      path: `/books/${bookId}/entries?since=0`,
      signer: impostor.signer,
      deviceId: owner.deviceId,
    });
    expect(res.status).toBe(401);
  });

  it('401s a body changed after signing', async () => {
    const { bookId, owner } = await bookWithOwner();
    const res = await raw(base, {
      method: 'POST',
      path: `/books/${bookId}/entries`,
      signer: owner.signer,
      body: change(owner.deviceId, 'h1'),
      tamperBody: change(owner.deviceId, 'h2'),
    });
    expect(res.status).toBe(401);
  });

  it('401s a path changed after signing', async () => {
    const { bookId, owner } = await bookWithOwner();
    const signedFor = `/books/${bookId}/entries?since=0`;
    const timestamp = Date.now();
    const good = await raw(base, { method: 'GET', path: signedFor, signer: owner.signer, timestamp });
    expect(good.status).toBe(200);
    // Same headers, different query: re-sign for since=0 but send since=1.
    const { requestSigningBytes, bytesToBase64Url } = await import('../../../packages/db/src/sync/relay-signing');
    const sig = await owner.signer.sign(await requestSigningBytes('GET', signedFor, String(timestamp), new Uint8Array()));
    const res = await fetch(`${base}/books/${bookId}/entries?since=1`, {
      headers: { 'X-Device': owner.deviceId, 'X-Timestamp': String(timestamp), 'X-Signature': bytesToBase64Url(sig) },
    });
    expect(res.status).toBe(401);
  });

  it('POST /books verifies against the JWK in its own body: another key 401s, another id 403s', async () => {
    const device = await makeDevice(base);
    const other = await makeDevice(base);
    const wrongKey = await raw(base, { method: 'POST', path: '/books', body: device.devicePublic, signer: other.signer, deviceId: device.deviceId });
    expect(wrongKey.status).toBe(401);
    const wrongId = await raw(base, { method: 'POST', path: '/books', body: other.devicePublic, signer: other.signer, deviceId: device.deviceId });
    expect(wrongId.status).toBe(403);
    const stale = await raw(base, { method: 'POST', path: '/books', body: device.devicePublic, signer: device.signer, timestamp: Date.now() - 10 * 60 * 1000 });
    expect(stale.status).toBe(401);
  });

  it('POST /invites/:id/claim verifies against the JWK in its own body: another key 401s, another id 403s', async () => {
    const { bookId, owner } = await bookWithOwner();
    const invite = await signedInvite(owner);
    await owner.transport.putInvite(bookId, invite);
    const joiner = await makeDevice(base);
    const other = await makeDevice(base);
    const path = `/invites/${invite.inviteId}/claim`;
    const wrongKey = await raw(base, { method: 'POST', path, body: joiner.devicePublic, signer: other.signer, deviceId: joiner.deviceId });
    expect(wrongKey.status).toBe(401);
    const wrongId = await raw(base, { method: 'POST', path, body: other.devicePublic, signer: other.signer, deviceId: joiner.deviceId });
    expect(wrongId.status).toBe(403);
    // Neither attempt used the invite up.
    await expect(joiner.transport.previewInvite(invite.inviteId)).resolves.toMatchObject({ claimed: false });
  });

  it('GET /invites/:id needs no headers', async () => {
    const { bookId, owner } = await bookWithOwner();
    const invite = await signedInvite(owner);
    await owner.transport.putInvite(bookId, invite);
    const res = await raw(base, { method: 'GET', path: `/invites/${invite.inviteId}`, signer: null });
    expect(res.status).toBe(200);
  });

  it('Replay: a duplicate (deviceId, hlc) answers 200 with the original seq and stores nothing new', async () => {
    const { bookId, owner } = await bookWithOwner();
    const first = await raw(base, { method: 'POST', path: `/books/${bookId}/entries`, signer: owner.signer, body: change(owner.deviceId, 'h1') });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ seq: 1 });
    await owner.transport.append(bookId, change(owner.deviceId, 'h2'));
    const again = await raw(base, { method: 'POST', path: `/books/${bookId}/entries`, signer: owner.signer, body: change(owner.deviceId, 'h1') });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ seq: 1 });
    const { entries, latest } = await owner.transport.pull(bookId, 0);
    expect(latest).toBe(2);
    expect(entries.map((e) => e.hlc)).toEqual(['h1', 'h2']);
  });
});

describe('§9.2 POST /books', () => {
  it('201 { bookId }; the caller is the only owner; epoch = 1', async () => {
    const owner = await makeDevice(base);
    const res = await raw(base, { method: 'POST', path: '/books', body: owner.devicePublic, signer: owner.signer });
    expect(res.status).toBe(201);
    const { bookId } = (await res.json()) as { bookId: string };
    expect(bookId).toMatch(/^[0-9a-f-]{36}$/);
    const { claim, joiner } = await join(bookId, owner);
    expect(claim.epoch).toBe(1);
    // The joiner is not an owner: it cannot invite.
    await expect(joiner.transport.putInvite(bookId, await signedInvite(joiner))).rejects.toMatchObject({ status: 403 });
  });

  it('400s a body that is not a DevicePublic', async () => {
    const owner = await makeDevice(base);
    const res = await raw(base, { method: 'POST', path: '/books', body: { nope: true }, signer: owner.signer });
    expect(res.status).toBe(400);
  });
});

describe('§9.2 POST /books/:id/entries', () => {
  it('201 { seq } for each new entry, in order', async () => {
    const { bookId, owner } = await bookWithOwner();
    await expect(owner.transport.append(bookId, change(owner.deviceId, 'h1'))).resolves.toEqual({ seq: 1 });
    await expect(owner.transport.append(bookId, change(owner.deviceId, 'h2'))).resolves.toEqual({ seq: 2 });
  });

  it('409s a rotation whose epoch is not current + 1, and 201s the one that is', async () => {
    const { bookId, owner } = await bookWithOwner();
    const post = (hlc: string, epoch: number) =>
      raw(base, { method: 'POST', path: `/books/${bookId}/entries`, signer: owner.signer, body: rotation(owner.deviceId, hlc, epoch) });
    expect((await post('r1', 1)).status).toBe(409);
    expect((await post('r3', 3)).status).toBe(409);
    expect((await post('r2', 2)).status).toBe(201);
    // Someone else rotating to 2 again lost the race.
    expect((await post('r2b', 2)).status).toBe(409);
    const { claim } = await join(bookId, owner);
    expect(claim.epoch).toBe(2);
  });

  it('413s an entry over 128 KB, and takes one just under', async () => {
    const { bookId, owner } = await bookWithOwner();
    const big = { ...change(owner.deviceId, 'big'), ct: 'x'.repeat(128 * 1024) };
    await expect(owner.transport.append(bookId, big)).rejects.toMatchObject({ status: 413 });
    const fits = { ...change(owner.deviceId, 'fits'), ct: 'x'.repeat(127 * 1024) };
    await expect(owner.transport.append(bookId, fits)).resolves.toEqual({ seq: 1 });
  });

  it('403s an entry authored as another device', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await expect(owner.transport.append(bookId, change(joiner.deviceId, 'h1'))).rejects.toMatchObject({ status: 403 });
  });

  it('400s a body that is not a LogEntry', async () => {
    const { bookId, owner } = await bookWithOwner();
    const res = await raw(base, { method: 'POST', path: `/books/${bookId}/entries`, signer: owner.signer, body: { kind: 'nope' } });
    expect(res.status).toBe(400);
  });
});

describe('§9.2 GET /books/:id/entries?since=N', () => {
  it('200 { entries, latest } after `since`, each with its seq and its author’s signing key', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await owner.transport.append(bookId, change(owner.deviceId, 'h1'));
    await joiner.transport.append(bookId, change(joiner.deviceId, 'h2'));
    await owner.transport.append(bookId, change(owner.deviceId, 'h3'));

    const all = await joiner.transport.pull(bookId, 0);
    expect(all.latest).toBe(3);
    expect(all.entries.map((e: SequencedEntry) => [e.seq, e.hlc])).toEqual([
      [1, 'h1'],
      [2, 'h2'],
      [3, 'h3'],
    ]);
    expect(all.entries[1]?.signJwk).toEqual(joiner.devicePublic.signJwk);
    expect(all.entries[0]?.signJwk).toEqual(owner.devicePublic.signJwk);

    const later = await owner.transport.pull(bookId, 2);
    expect(later.entries.map((e) => e.seq)).toEqual([3]);
    expect(later.latest).toBe(3);
  });

  it('answers at most 500 entries, with latest telling the caller to come back', async () => {
    const { bookId, owner } = await bookWithOwner();
    // 502 appends, ten in flight at a time — the book's object takes them one by one, so seqs stay 1..502.
    for (let from = 1; from <= 502; from += 10) {
      const batch = Array.from({ length: Math.min(10, 503 - from) }, (_, k) => from + k);
      await Promise.all(batch.map((i) => owner.transport.append(bookId, change(owner.deviceId, `h${String(i).padStart(4, '0')}`))));
    }
    const first = await owner.transport.pull(bookId, 0);
    expect(first.entries).toHaveLength(500);
    expect(first.entries.at(-1)?.seq).toBe(500);
    expect(first.latest).toBe(502);
    const rest = await owner.transport.pull(bookId, 500);
    expect(rest.entries.map((e) => e.seq)).toEqual([501, 502]);
    expect(new Set([...first.entries, ...rest.entries].map((e) => e.hlc)).size).toBe(502);
  }, 300_000);

  it('400s a since that is not a whole number', async () => {
    const { bookId, owner } = await bookWithOwner();
    const res = await raw(base, { method: 'GET', path: `/books/${bookId}/entries?since=abc`, signer: owner.signer });
    expect(res.status).toBe(400);
  });

  it('404s a book that does not exist', async () => {
    const someone = await makeDevice(base);
    await expect(someone.transport.pull(crypto.randomUUID(), 0)).rejects.toMatchObject({ status: 404 });
  });
});

describe('§9.2 POST /books/:id/invites', () => {
  it('201 for an owner', async () => {
    const { bookId, owner } = await bookWithOwner();
    const res = await raw(base, { method: 'POST', path: `/books/${bookId}/invites`, signer: owner.signer, body: await signedInvite(owner) });
    expect(res.status).toBe(201);
  });

  it('403s a member who is not an owner', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await expect(joiner.transport.putInvite(bookId, await signedInvite(joiner))).rejects.toMatchObject({ status: 403 });
  });

  it('409s an invite id another book already holds', async () => {
    const a = await bookWithOwner();
    const b = await bookWithOwner();
    const invite = await signedInvite(a.owner);
    await a.owner.transport.putInvite(a.bookId, invite);
    await expect(b.owner.transport.putInvite(b.bookId, await signedInvite(b.owner, { inviteId: invite.inviteId }))).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('§9.2 GET /invites/:id', () => {
  it('200 { preview, expiresAt, claimed }, and claimed turns true once claimed', async () => {
    const { bookId, owner } = await bookWithOwner();
    const invite = await signedInvite(owner);
    await owner.transport.putInvite(bookId, invite);
    const anyone = await makeDevice(base);
    await expect(anyone.transport.previewInvite(invite.inviteId)).resolves.toEqual({
      preview: invite.preview,
      expiresAt: invite.expiresAt,
      claimed: false,
    });
    await anyone.transport.claimInvite(invite.inviteId, anyone.devicePublic);
    await expect(anyone.transport.previewInvite(invite.inviteId)).resolves.toMatchObject({ claimed: true });
  });

  it('404s an unknown invite', async () => {
    const anyone = await makeDevice(base);
    await expect(anyone.transport.previewInvite(crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});

describe('§9.2 POST /invites/:id/claim', () => {
  it('200 { bookId, epoch, keys, sameMember, memberId }; the device is allow-listed', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner, claim, invite } = await join(bookId, owner);
    expect(claim).toEqual({ bookId, epoch: 1, keys: invite.keys, sameMember: false, memberId: joiner.deviceId });
    await expect(joiner.transport.pull(bookId, 0)).resolves.toMatchObject({ latest: 0 });
  });

  it('carries the inviter’s memberId for a same-member link', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { claim } = await join(bookId, owner, { sameMember: true, memberId: 'member-1' });
    expect(claim).toMatchObject({ sameMember: true, memberId: 'member-1' });
  });

  it('409s an invite already claimed', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { invite } = await join(bookId, owner);
    const late = await makeDevice(base);
    await expect(late.transport.claimInvite(invite.inviteId, late.devicePublic)).rejects.toMatchObject({ status: 409 });
  });

  it('410s an expired invite', async () => {
    const { bookId, owner } = await bookWithOwner();
    const invite = await signedInvite(owner, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await owner.transport.putInvite(bookId, invite);
    const late = await makeDevice(base);
    await expect(late.transport.claimInvite(invite.inviteId, late.devicePublic)).rejects.toMatchObject({ status: 410 });
  });

  it('403s an invite whose signature is not an owner’s', async () => {
    const { bookId, owner } = await bookWithOwner();
    const notOwner = await makeDevice(base);
    const forged = { ...(await signedInvite(notOwner)) };
    await owner.transport.putInvite(bookId, forged);
    const joiner = await makeDevice(base);
    await expect(joiner.transport.claimInvite(forged.inviteId, joiner.devicePublic)).rejects.toMatchObject({ status: 403 });

    const tampered = await signedInvite(owner);
    await owner.transport.putInvite(bookId, { ...tampered, sameMember: true, memberId: 'someone' });
    await expect(joiner.transport.claimInvite(tampered.inviteId, joiner.devicePublic)).rejects.toMatchObject({ status: 403 });
  });

  it('429s a sixth device, and a removed device frees its place', async () => {
    const { bookId, owner } = await bookWithOwner();
    const joined: TestDevice[] = [];
    for (let i = 0; i < 4; i += 1) joined.push((await join(bookId, owner)).joiner);
    const invite = await signedInvite(owner);
    await owner.transport.putInvite(bookId, invite);
    const sixth = await makeDevice(base);
    await expect(sixth.transport.claimInvite(invite.inviteId, sixth.devicePublic)).rejects.toMatchObject({ status: 429 });

    await owner.transport.removeDevice(bookId, joined[0]!.deviceId);
    await expect(sixth.transport.claimInvite(invite.inviteId, sixth.devicePublic)).resolves.toMatchObject({ bookId });
  });

  it('404s an unknown invite', async () => {
    const joiner = await makeDevice(base);
    await expect(joiner.transport.claimInvite(crypto.randomUUID(), joiner.devicePublic)).rejects.toMatchObject({ status: 404 });
  });
});

describe('§9.2 DELETE /books/:id/devices/:deviceId', () => {
  it('204 for an owner removing another device', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    const res = await raw(base, { method: 'DELETE', path: `/books/${bookId}/devices/${joiner.deviceId}`, signer: owner.signer });
    expect(res.status).toBe(204);
  });

  it('204 for a device removing itself', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await expect(joiner.transport.removeDevice(bookId, joiner.deviceId)).resolves.toBeUndefined();
    await expect(joiner.transport.pull(bookId, 0)).rejects.toMatchObject({ status: 401 });
  });

  it('403s a member removing someone else', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner: a } = await join(bookId, owner);
    const { joiner: b } = await join(bookId, owner);
    await expect(a.transport.removeDevice(bookId, b.deviceId)).rejects.toMatchObject({ status: 403 });
  });

  it('404s a device the book never had', async () => {
    const { bookId, owner } = await bookWithOwner();
    await expect(owner.transport.removeDevice(bookId, 'no-such-device')).rejects.toMatchObject({ status: 404 });
  });

  it('a removed owner is no longer an owner', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await owner.transport.setOwners(bookId, [owner.deviceId, joiner.deviceId]);
    await owner.transport.removeDevice(bookId, joiner.deviceId);
    // Re-admitting the key under a new invite gives a plain member, not the old owner.
    const invite = await signedInvite(owner);
    await owner.transport.putInvite(bookId, invite);
    await joiner.transport.claimInvite(invite.inviteId, joiner.devicePublic);
    await expect(joiner.transport.putInvite(bookId, await signedInvite(joiner))).rejects.toMatchObject({ status: 403 });
  });
});

describe('§9.2 PUT /books/:id/owners', () => {
  it('204 replaces the owner set', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    const res = await raw(base, { method: 'PUT', path: `/books/${bookId}/owners`, signer: owner.signer, body: { deviceIds: [joiner.deviceId] } });
    expect(res.status).toBe(204);
    await expect(joiner.transport.putInvite(bookId, await signedInvite(joiner))).resolves.toBeUndefined();
    await expect(owner.transport.putInvite(bookId, await signedInvite(owner))).rejects.toMatchObject({ status: 403 });
  });

  it('403s a non-owner', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await expect(joiner.transport.setOwners(bookId, [joiner.deviceId])).rejects.toMatchObject({ status: 403 });
  });

  it('400s a body without deviceIds', async () => {
    const { bookId, owner } = await bookWithOwner();
    const res = await raw(base, { method: 'PUT', path: `/books/${bookId}/owners`, signer: owner.signer, body: { owners: [] } });
    expect(res.status).toBe(400);
  });
});

describe('§9.2 DELETE /books/:id', () => {
  it('204; every later call on the book answers 410', async () => {
    const { bookId, owner } = await bookWithOwner();
    const invite = await signedInvite(owner);
    await owner.transport.putInvite(bookId, invite);
    const res = await raw(base, { method: 'DELETE', path: `/books/${bookId}`, signer: owner.signer });
    expect(res.status).toBe(204);

    await expect(owner.transport.pull(bookId, 0)).rejects.toMatchObject({ status: 410 });
    await expect(owner.transport.append(bookId, change(owner.deviceId, 'after'))).rejects.toMatchObject({ status: 410 });
    await expect(owner.transport.deleteBook(bookId)).rejects.toMatchObject({ status: 410 });
    await expect(owner.transport.previewInvite(invite.inviteId)).rejects.toMatchObject({ status: 410 });
    const joiner = await makeDevice(base);
    await expect(joiner.transport.claimInvite(invite.inviteId, joiner.devicePublic)).rejects.toMatchObject({ status: 410 });
  });

  it('403s a non-owner', async () => {
    const { bookId, owner } = await bookWithOwner();
    const { joiner } = await join(bookId, owner);
    await expect(joiner.transport.deleteBook(bookId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('routing', () => {
  it('404s a path the relay does not serve', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  it('405s a method a path does not take', async () => {
    const { bookId, owner } = await bookWithOwner();
    const res = await raw(base, { method: 'PUT', path: `/books/${bookId}/entries`, signer: owner.signer, body: {} });
    expect(res.status).toBe(405);
  });
});

describe('CORS: the web app and the Capacitor shell can call the relay', () => {
  for (const origin of ['http://localhost:5173', 'capacitor://localhost']) {
    it(`answers the preflight from ${origin}`, async () => {
      const res = await fetch(`${base}/books/x/entries`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-device,x-timestamp,x-signature',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const allowed = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
      for (const h of ['content-type', 'x-device', 'x-timestamp', 'x-signature']) expect(allowed).toContain(h);
      const methods = res.headers.get('Access-Control-Allow-Methods') ?? '';
      for (const m of ['GET', 'POST', 'PUT', 'DELETE']) expect(methods).toContain(m);
    });
  }

  it('stamps the allowed origin on real answers, refusals included', async () => {
    const { bookId, owner } = await bookWithOwner();
    const ok = await raw(base, { method: 'GET', path: `/books/${bookId}/entries?since=0`, signer: owner.signer, origin: 'http://localhost:5173' });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const refused = await raw(base, { method: 'GET', path: `/books/${bookId}/entries?since=0`, signer: null, origin: 'http://localhost:5173' });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('does not allow an origin it does not know', async () => {
    const res = await fetch(`${base}/books`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
