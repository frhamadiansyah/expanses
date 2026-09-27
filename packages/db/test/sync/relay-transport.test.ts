import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, ecdsaRequestSigner, requestSigningBytes, verifySignature } from '../../src/sync/relay-signing';
import { DEFAULT_RELAY_URL, RelayTransport } from '../../src/sync/relay-transport';
import type { DevicePublic, LogEntry } from '../../src/sync/types';
import { SyncTransportError } from '../../src/sync/types';

interface Seen {
  method: string;
  url: string;
  headers: Headers;
  body: Uint8Array;
}

/** A fake `fetch` that records each request and answers with the next canned response. */
function fakeFetch(responses: Array<() => Response>) {
  const seen: Seen[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    seen.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: new Uint8Array(await request.arrayBuffer()),
    });
    const next = responses.shift();
    if (!next) throw new Error('no canned response left');
    return next();
  };
  return { impl: impl as typeof fetch, seen };
}

function json(status: number, body: unknown): () => Response {
  return () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const agree = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const devicePublic: DevicePublic = { signJwk: publicJwk, agreeJwk: await crypto.subtle.exportKey('jwk', agree.publicKey) };
  return { signer: ecdsaRequestSigner('device-a', publicJwk, pair.privateKey), devicePublic, publicJwk };
}

const entry: LogEntry = { kind: 'change', deviceId: 'device-a', epoch: 1, hlc: 'h1', iv: 'iv', ct: 'ct', sig: 'sig' };

describe('RelayTransport: every request carries the §9.1 headers, signed over method, path, timestamp and body', () => {
  it('signs a POST so the relay can verify it against the device key', async () => {
    const { signer, publicJwk } = await device();
    const fetcher = fakeFetch([json(201, { seq: 7 })]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test/', signer, fetch: fetcher.impl, now: () => 1_700_000_000_000 });

    await expect(transport.append('book-1', entry)).resolves.toEqual({ seq: 7 });

    const [req] = fetcher.seen;
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('http://relay.test/books/book-1/entries');
    expect(req?.headers.get('X-Device')).toBe('device-a');
    expect(req?.headers.get('X-Timestamp')).toBe('1700000000000');
    expect(req?.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(req?.body))).toEqual(entry);

    const signed = await requestSigningBytes('POST', '/books/book-1/entries', '1700000000000', req!.body);
    expect(await verifySignature(publicJwk, signed, req!.headers.get('X-Signature')!)).toBe(true);
    expect(base64UrlToBytes(req!.headers.get('X-Signature')!).length).toBe(64);
  });

  it('signs the query string too, and an empty body for a GET', async () => {
    const { signer, publicJwk } = await device();
    const fetcher = fakeFetch([json(200, { entries: [], latest: 0 })]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl, now: () => 5 });

    await expect(transport.pull('book-1', 12)).resolves.toEqual({ entries: [], latest: 0 });

    const [req] = fetcher.seen;
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe('http://relay.test/books/book-1/entries?since=12');
    expect(req?.body.length).toBe(0);
    const signed = await requestSigningBytes('GET', '/books/book-1/entries?since=12', '5', new Uint8Array());
    expect(await verifySignature(publicJwk, signed, req!.headers.get('X-Signature')!)).toBe(true);
  });

  it('escapes ids that land in the path', async () => {
    const { signer } = await device();
    const fetcher = fakeFetch([() => new Response(null, { status: 204 })]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl });
    await transport.removeDevice('b/1', 'd?2');
    expect(fetcher.seen[0]?.url).toBe('http://relay.test/books/b%2F1/devices/d%3F2');
  });

  it('sends no auth headers on GET /invites/:id — it is unauthenticated (§9.1)', async () => {
    const { signer } = await device();
    const fetcher = fakeFetch([json(200, { preview: { iv: 'a', ct: 'b' }, expiresAt: 'x', claimed: false })]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl });
    await transport.previewInvite('inv-1');
    expect(fetcher.seen[0]?.headers.get('X-Signature')).toBeNull();
    expect(fetcher.seen[0]?.url).toBe('http://relay.test/invites/inv-1');
  });
});

describe('RelayTransport: each method speaks its §9.2 endpoint', () => {
  it('maps every method onto its method, path and body', async () => {
    const { signer, devicePublic } = await device();
    const invite = {
      inviteId: 'inv-1',
      keys: { iv: 'a', ct: 'b' },
      preview: { iv: 'c', ct: 'd' },
      expiresAt: '2030-01-01T00:00:00.000Z',
      sameMember: false,
      sig: 's',
    };
    const claim = { bookId: 'book-1', epoch: 1, keys: { iv: 'a', ct: 'b' }, sameMember: false, memberId: 'm' };
    const fetcher = fakeFetch([
      json(201, { bookId: 'book-1' }),
      () => new Response(null, { status: 201 }),
      json(200, claim),
      () => new Response(null, { status: 204 }),
      () => new Response(null, { status: 204 }),
    ]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl });

    await expect(transport.createBook(devicePublic)).resolves.toEqual({ bookId: 'book-1' });
    await expect(transport.putInvite('book-1', invite)).resolves.toBeUndefined();
    await expect(transport.claimInvite('inv-1', devicePublic)).resolves.toEqual(claim);
    await expect(transport.setOwners('book-1', ['a', 'b'])).resolves.toBeUndefined();
    await expect(transport.deleteBook('book-1')).resolves.toBeUndefined();

    const calls = fetcher.seen.map((s) => `${s.method} ${new URL(s.url).pathname}`);
    expect(calls).toEqual([
      'POST /books',
      'POST /books/book-1/invites',
      'POST /invites/inv-1/claim',
      'PUT /books/book-1/owners',
      'DELETE /books/book-1',
    ]);
    const bodies = fetcher.seen.map((s) => (s.body.length ? JSON.parse(new TextDecoder().decode(s.body)) : null));
    expect(bodies).toEqual([devicePublic, invite, devicePublic, { deviceIds: ['a', 'b'] }, null]);
  });

  it('a duplicate append answered 200 is success with the original seq (§9.1 Replay)', async () => {
    const { signer } = await device();
    const fetcher = fakeFetch([json(200, { seq: 3 })]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl });
    await expect(transport.append('book-1', entry)).resolves.toEqual({ seq: 3 });
  });
});

describe('RelayTransport: a refusal becomes the same SyncTransportError MemoryTransport throws', () => {
  for (const status of [400, 401, 403, 404, 409, 410, 413, 429, 500]) {
    it(`maps ${status}`, async () => {
      const { signer } = await device();
      const fetcher = fakeFetch([json(status, { error: `refused ${status}` })]);
      const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl });
      const failure = transport.pull('book-1', 0);
      await expect(failure).rejects.toBeInstanceOf(SyncTransportError);
      await expect(failure).rejects.toMatchObject({ status, message: `refused ${status}` });
    });
  }

  it("carries a deleted book's deletedBy on a 410 (§8.6, task 9a)", async () => {
    const { signer } = await device();
    const fetcher = fakeFetch([json(410, { error: 'this book is no longer shared', deletedBy: 'device-owner' })]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl });
    await expect(transport.pull('book-1', 0)).rejects.toMatchObject({ status: 410, deletedBy: 'device-owner' });
  });

  it('a relay that cannot be reached is status 0', async () => {
    const { signer } = await device();
    const transport = new RelayTransport({
      baseUrl: 'http://relay.test',
      signer,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(transport.pull('book-1', 0)).rejects.toMatchObject({ name: 'SyncTransportError', status: 0 });
  });

  it('a non-JSON error body still carries the status', async () => {
    const { signer } = await device();
    const fetcher = fakeFetch([() => new Response('<html>bad gateway</html>', { status: 502 })]);
    const transport = new RelayTransport({ baseUrl: 'http://relay.test', signer, fetch: fetcher.impl });
    await expect(transport.pull('book-1', 0)).rejects.toMatchObject({ status: 502 });
  });
});

describe('RelayTransport: base URL', () => {
  it('defaults to the local relay', async () => {
    expect(DEFAULT_RELAY_URL).toBe('http://localhost:8787');
    const { signer } = await device();
    const fetcher = fakeFetch([json(200, { entries: [], latest: 0 })]);
    await new RelayTransport({ signer, fetch: fetcher.impl }).pull('b', 0);
    expect(fetcher.seen[0]?.url).toBe('http://localhost:8787/books/b/entries?since=0');
  });
});
