import { uuidv7 } from '@expanses/core';
import { deviceIdOf, MAX_CLOCK_SKEW_MS, requestSigningBytes, verifySignature } from '../../../packages/db/src/sync/relay-signing';
import type { DevicePublic } from '../../../packages/db/src/sync/types';
import type { MemberOp, Result } from './book-object';
import { verifyEntitlement } from './entitlement';
import type { Env } from './env';
import { isDevicePublic, isInviteRecord, isLogEntry, isOwnersBody } from './shapes';

export { BookObject } from './book-object';
export { InviteObject } from './invite-object';

/*
 * The household-sharing relay (spec §9): routing, CORS, the §9.1 header and timestamp checks, and the two requests
 * that come from a device on no list (`POST /books`, `POST /invites/:id/claim`), verified against the JWK in their
 * own body. Everything else is authenticated by the book's Durable Object against the key it holds for the device.
 */

/** Far larger than any legitimate body (an entry is at most 128 KB); refused before it is parsed. */
const MAX_BODY_BYTES = 1024 * 1024;

const ALLOWED_HEADERS = 'Content-Type, X-Device, X-Timestamp, X-Signature';
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Signed {
  deviceId: string;
  signingBytes: Uint8Array;
  signature: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors.has('Access-Control-Allow-Origin')
          ? { ...Object.fromEntries(cors), 'Access-Control-Allow-Methods': ALLOWED_METHODS, 'Access-Control-Allow-Headers': ALLOWED_HEADERS, 'Access-Control-Max-Age': '86400' }
          : Object.fromEntries(cors),
      });
    }
    let result: Result;
    try {
      result = await route(request, env);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      result = { status: error.status, body: { error: error.message } };
    }
    return respond(result, cors);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Result> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment);
  const method = request.method;

  // POST /books
  if (parts.length === 1 && parts[0] === 'books') {
    allow(method, ['POST']);
    const { signed, body } = await readSigned(request, url);
    const device = expect(body, isDevicePublic, 'expected { signJwk, agreeJwk }');
    await verifyOwnKey(device, signed);
    const bookId = uuidv7();
    if (!(await verifyEntitlement(bookId))) throw new HttpError(402, 'no entitlement to share');
    return bookStub(env, bookId).create(bookId, device, signed.deviceId);
  }

  // /books/:id/...
  if (parts[0] === 'books' && parts.length >= 2) {
    const bookId = parts[1]!;
    const rest = parts.slice(2);
    let op: MemberOp;
    let signedRequest: { signed: Signed; body: unknown };

    if (rest.length === 0) {
      allow(method, ['DELETE']);
      signedRequest = await readSigned(request, url);
      op = { type: 'deleteBook' };
    } else if (rest.length === 1 && rest[0] === 'entries') {
      allow(method, ['GET', 'POST']);
      signedRequest = await readSigned(request, url);
      if (method === 'GET') {
        const since = url.searchParams.get('since') ?? '0';
        if (!/^\d+$/.test(since) || !Number.isSafeInteger(Number(since))) throw new HttpError(400, 'since must be a whole number');
        op = { type: 'pull', since: Number(since) };
      } else {
        op = { type: 'append', entry: expect(signedRequest.body, isLogEntry, 'expected a LogEntry') };
      }
    } else if (rest.length === 1 && rest[0] === 'invites') {
      allow(method, ['POST']);
      signedRequest = await readSigned(request, url);
      op = { type: 'putInvite', invite: expect(signedRequest.body, isInviteRecord, 'expected an InviteRecord') };
    } else if (rest.length === 1 && rest[0] === 'owners') {
      allow(method, ['PUT']);
      signedRequest = await readSigned(request, url);
      op = { type: 'setOwners', deviceIds: expect(signedRequest.body, isOwnersBody, 'expected { deviceIds }').deviceIds };
    } else if (rest.length === 2 && rest[0] === 'devices') {
      allow(method, ['DELETE']);
      signedRequest = await readSigned(request, url);
      op = { type: 'removeDevice', target: rest[1]! };
    } else {
      throw new HttpError(404, 'not found');
    }
    return bookStub(env, bookId).member(signedRequest.signed, op);
  }

  // /invites/:id and /invites/:id/claim
  if (parts[0] === 'invites' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'claim'))) {
    const inviteId = parts[1]!;
    if (parts.length === 2) {
      allow(method, ['GET']);
      const bookId = await inviteBook(env, inviteId);
      return bookStub(env, bookId).preview(inviteId);
    }
    allow(method, ['POST']);
    const { signed, body } = await readSigned(request, url);
    const device = expect(body, isDevicePublic, 'expected { signJwk, agreeJwk }');
    await verifyOwnKey(device, signed);
    const bookId = await inviteBook(env, inviteId);
    return bookStub(env, bookId).claim(inviteId, device, signed.deviceId);
  }

  throw new HttpError(404, 'not found');
}

/** A path segment, decoded; one whose percent-encoding is malformed is the caller's mistake (400), not a crash (final review, minor 7). */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, 'malformed path');
  }
}

function bookStub(env: Env, bookId: string) {
  return env.BOOKS.get(env.BOOKS.idFromName(bookId));
}

async function inviteBook(env: Env, inviteId: string): Promise<string> {
  const bookId = await env.INVITES.get(env.INVITES.idFromName(inviteId)).bookId();
  if (!bookId) throw new HttpError(404, 'no such invite');
  return bookId;
}

function allow(method: string, methods: string[]): void {
  if (!methods.includes(method)) throw new HttpError(405, `use ${methods.join(' or ')}`);
}

function expect<T>(value: unknown, guard: (v: unknown) => v is T, message: string): T {
  if (!guard(value)) throw new HttpError(400, message);
  return value;
}

/**
 * Reads the body and the §9.1 headers, refusing (401) a missing header or a timestamp more than five minutes off.
 * The signature itself is checked by whoever holds the key: the book's Durable Object, or `verifyOwnKey`.
 */
async function readSigned(request: Request, url: URL): Promise<{ signed: Signed; body: unknown }> {
  const deviceId = request.headers.get('X-Device');
  const timestamp = request.headers.get('X-Timestamp');
  const signature = request.headers.get('X-Signature');
  if (!deviceId || !timestamp || !signature) throw new HttpError(401, 'missing X-Device, X-Timestamp or X-Signature');
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
    throw new HttpError(401, 'timestamp more than 5 minutes off');
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
  let body: unknown;
  if (bytes.length > 0) {
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HttpError(400, 'body is not JSON');
    }
  }
  const signingBytes = await requestSigningBytes(request.method, url.pathname + url.search, timestamp, bytes);
  return { signed: { deviceId, signingBytes, signature }, body };
}

/** A device on no list: its id must be its own key's (403), and that key must have signed the request (401). */
async function verifyOwnKey(device: DevicePublic, signed: Signed): Promise<void> {
  // A key that is not a P-256 point has no id at all: it cannot be the caller's.
  if ((await deviceIdOf(device).catch(() => null)) !== signed.deviceId) throw new HttpError(403, 'a device can only register itself');
  if (!(await verifySignature(device.signJwk, signed.signingBytes, signed.signature))) throw new HttpError(401, 'bad signature');
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function respond(result: Result, cors: Headers): Response {
  const headers = new Headers(cors);
  if (result.status === 204 || result.body === undefined) return new Response(null, { status: result.status, headers });
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
}
