import type { InviteRecord } from './types';

/*
 * The relay's request signing (spec §9.1) and the invite signature (spec §5.4), in one place for both ends: the
 * Worker in `apps/relay` imports this file to verify, `RelayTransport` imports it to sign. WebCrypto only — this runs
 * in the browser, in a native WebView, in Node's test runner and in the Workers runtime alike.
 *
 * "ECDSA(sign.private, SHA-256(m))" in the spec is WebCrypto's `ECDSA` with `hash: 'SHA-256'` over `m`: the algorithm
 * hashes `m` itself. Signatures are WebCrypto's raw IEEE P1363 form (r ‖ s, 64 bytes for P-256), base64url.
 */

/** The relay refuses a request whose `X-Timestamp` is more than this far from its own clock (spec §9.1). */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * What `RelayTransport` needs to sign requests as one device. Task 5's `KeyStore` provides it from the device's
 * non-extractable signing key; `ecdsaRequestSigner` builds one from any `CryptoKey`.
 */
export interface RequestSigner {
  readonly deviceId: string;
  readonly publicJwk: JsonWebKey;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on anything that is not base64url. */
export function base64UrlToBytes(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw new Error('not base64url');
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON with object keys sorted at every depth — the "keys sorted" of spec §6.6. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/**
 * The bytes a request's `X-Signature` covers (spec §9.1): `method \n path \n timestamp \n hex(SHA-256(body))`.
 * `path` is the request target — the URL's pathname plus its query string, exactly as sent.
 */
export async function requestSigningBytes(method: string, path: string, timestamp: string, body: Uint8Array): Promise<Uint8Array> {
  return new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${timestamp}\n${await sha256Hex(body)}`);
}

/** The bytes an invite's `sig` covers: the record without `sig`, keys sorted (spec §5.4, same form as §6.6). */
export function inviteSigningBytes(invite: InviteRecord | (Omit<InviteRecord, 'sig'> & { sig?: string })): Uint8Array {
  const { sig: _sig, ...rest } = invite;
  return new TextEncoder().encode(canonicalJson(rest));
}

/** Whether `sigBase64Url` is a valid ECDSA P-256 / SHA-256 signature of `data` under `publicJwk`. Never throws. */
export async function verifySignature(publicJwk: JsonWebKey, data: Uint8Array, sigBase64Url: string): Promise<boolean> {
  try {
    const { key_ops: _ops, ext: _ext, ...jwk } = publicJwk;
    const key = await crypto.subtle.importKey('jwk', jwk, ECDSA_P256, false, ['verify']);
    return await crypto.subtle.verify(ECDSA_SHA256, key, base64UrlToBytes(sigBase64Url) as BufferSource, data as BufferSource);
  } catch {
    return false;
  }
}

/** A `RequestSigner` over an ECDSA P-256 private key. */
export function ecdsaRequestSigner(deviceId: string, publicJwk: JsonWebKey, privateKey: CryptoKey): RequestSigner {
  return {
    deviceId,
    publicJwk,
    async sign(bytes) {
      return new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, privateKey, bytes as BufferSource));
    },
  };
}
