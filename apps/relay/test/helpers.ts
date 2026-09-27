import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { deviceIdOf } from '../../../packages/db/src/sync/memory-transport';
import {
  bytesToBase64Url,
  ecdsaRequestSigner,
  inviteSigningBytes,
  requestSigningBytes,
  type RequestSigner,
} from '../../../packages/db/src/sync/relay-signing';
import { RelayTransport } from '../../../packages/db/src/sync/relay-transport';
import type { DevicePublic, InviteRecord, LogEntry } from '../../../packages/db/src/sync/types';

/*
 * The relay under test is the real Worker from wrangler.toml, bundled and run locally by wrangler's test harness on
 * Miniflare/workerd — no Cloudflare account, no network beyond localhost.
 */
export async function startRelay() {
  const harness = createTestHarness({
    root: fileURLToPath(new URL('..', import.meta.url)),
    workers: [{ configPath: 'wrangler.toml' }],
  });
  const { url } = await harness.listen();
  return { url: url.href.replace(/\/$/, ''), close: () => harness.close() };
}

export interface TestDevice {
  deviceId: string;
  devicePublic: DevicePublic;
  signKey: CryptoKey;
  signer: RequestSigner;
  transport: RelayTransport;
}

/** A device with real ECDSA and ECDH P-256 keys, and a `RelayTransport` signing as it. */
export async function makeDevice(baseUrl: string): Promise<TestDevice> {
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const agree = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const devicePublic: DevicePublic = {
    signJwk: await crypto.subtle.exportKey('jwk', sign.publicKey),
    agreeJwk: await crypto.subtle.exportKey('jwk', agree.publicKey),
  };
  const deviceId = await deviceIdOf(devicePublic);
  const signer = ecdsaRequestSigner(deviceId, devicePublic.signJwk, sign.privateKey);
  return { deviceId, devicePublic, signKey: sign.privateKey, signer, transport: new RelayTransport({ baseUrl, signer }) };
}

/** An invite signed by `owner` the way spec §5.4 says: ECDSA over the record without `sig`, keys sorted. */
export async function signedInvite(owner: TestDevice, overrides: Partial<InviteRecord> = {}): Promise<InviteRecord> {
  const unsigned = {
    inviteId: crypto.randomUUID(),
    keys: { iv: 'k-iv', ct: 'k-ct' },
    preview: { iv: 'p-iv', ct: 'p-ct' },
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    sameMember: false,
    ...overrides,
  };
  const sig = bytesToBase64Url(await owner.signer.sign(inviteSigningBytes({ ...unsigned, sig: '' })));
  return { ...unsigned, sig };
}

export function change(deviceId: string, hlc: string, epoch = 1): LogEntry {
  return { kind: 'change', deviceId, epoch, hlc, iv: 'iv', ct: 'ct', sig: 'sig' };
}

export function rotation(deviceId: string, hlc: string, epoch: number): LogEntry {
  return { kind: 'rotation', deviceId, epoch, hlc, sealed: [], sig: 'sig' };
}

export interface RawOptions {
  method: string;
  path: string;
  body?: unknown;
  /** Who the headers claim to be; defaults to the signer's own id. */
  deviceId?: string;
  /** Signs with this device's key; `null` sends no auth headers at all. */
  signer?: RequestSigner | null;
  timestamp?: number;
  /** Replaces the body after signing, to prove the signature covers it. */
  tamperBody?: unknown;
  origin?: string;
}

/** A hand-built request, so a test can get every §9.1 header subtly wrong. */
export async function raw(baseUrl: string, options: RawOptions): Promise<Response> {
  const bytes = options.body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(options.body));
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.origin) headers.Origin = options.origin;
  if (options.signer) {
    const timestamp = String(options.timestamp ?? Date.now());
    const sig = await options.signer.sign(await requestSigningBytes(options.method, options.path, timestamp, bytes));
    headers['X-Device'] = options.deviceId ?? options.signer.deviceId;
    headers['X-Timestamp'] = timestamp;
    headers['X-Signature'] = bytesToBase64Url(sig);
  }
  const sent = options.tamperBody === undefined ? bytes : new TextEncoder().encode(JSON.stringify(options.tamperBody));
  return fetch(baseUrl + options.path, {
    method: options.method,
    headers,
    body: options.body === undefined && options.tamperBody === undefined ? undefined : sent,
  });
}
