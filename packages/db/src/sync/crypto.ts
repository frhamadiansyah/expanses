import { base64UrlToBytes, bytesToBase64Url } from './relay-signing';
import type { SealedFor } from './types';

/*
 * The cryptographic primitives of household sharing (spec §5), WebCrypto only: HKDF-SHA-256, AES-GCM-256, ECDH P-256,
 * and deflate through `CompressionStream`. Every one runs in the browser, in WKWebView (iOS 16.4+ for
 * `CompressionStream`), in Node ≥ 18 and in the Workers runtime; no fallback is needed on any target the app ships to.
 * `crypto.kat.test.ts` checks each against published vectors.
 */

const AES_GCM = 'AES-GCM';
const ECDH_P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('not hex');
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const buf = (bytes: Uint8Array): BufferSource => bytes as BufferSource;

/** HKDF-SHA-256 (RFC 5869): `bits` of output keying material. */
export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits = 256): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, base, bits));
}

async function aesKey(key: Uint8Array | CryptoKey, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (!(key instanceof Uint8Array)) return key;
  return crypto.subtle.importKey('raw', buf(key), AES_GCM, false, [usage]);
}

/** AES-GCM with a 128-bit tag: the ciphertext with the tag appended, as WebCrypto gives it. */
export async function aesGcmEncrypt(key: Uint8Array | CryptoKey, iv: Uint8Array, data: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const params: AesGcmParams = aad ? { name: AES_GCM, iv: buf(iv), additionalData: buf(aad) } : { name: AES_GCM, iv: buf(iv) };
  return new Uint8Array(await crypto.subtle.encrypt(params, await aesKey(key, 'encrypt'), buf(data)));
}

/** The inverse of `aesGcmEncrypt`. Throws when the tag does not verify (wrong key, iv, data or additional data). */
export async function aesGcmDecrypt(key: Uint8Array | CryptoKey, iv: Uint8Array, data: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const params: AesGcmParams = aad ? { name: AES_GCM, iv: buf(iv), additionalData: buf(aad) } : { name: AES_GCM, iv: buf(iv) };
  return new Uint8Array(await crypto.subtle.decrypt(params, await aesKey(key, 'decrypt'), buf(data)));
}

/** A public JWK with only what import needs (an exported key may carry `key_ops` and `ext` that clash with usages). */
function publicOnly(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/** ECDH P-256: the 256-bit shared secret between our private key and their public key. */
export async function ecdhSharedBits(privateKey: CryptoKey, publicJwk: JsonWebKey): Promise<Uint8Array> {
  const theirs = await crypto.subtle.importKey('jwk', publicOnly(publicJwk), ECDH_P256, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, privateKey, 256));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([buf(bytes)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** zlib `deflate` (RFC 1950) through `CompressionStream` — the `deflate(…)` of spec §6.6. */
export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('deflate'));
}

export function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('deflate'));
}

/* ----------------------------------------------------------- sealing a key */

/** The HKDF `info` of a key sealed inside a rotation (§5.3), and of one kept at rest on its own device (§5.5). */
export const EPOCH_INFO = 'cicis-epoch-v1';
export const AT_REST_INFO = 'cicis-at-rest-v1';

const keyAad = (bookId: string, epoch: number, deviceId: string) => utf8(`${bookId}:${epoch}:${deviceId}`);

/**
 * Seals an epoch key for one device (spec §5.3): an ephemeral ECDH pair, its secret with the device's agreement key,
 * HKDF with the book as salt, AES-GCM bound to `bookId:epoch:deviceId`.
 */
export async function sealKeyFor(
  target: { deviceId: string; agreeJwk: JsonWebKey },
  bookId: string,
  epoch: number,
  key: Uint8Array,
  info: string = EPOCH_INFO,
): Promise<SealedFor> {
  const eph = await crypto.subtle.generateKey(ECDH_P256, true, ['deriveBits']);
  const shared = await ecdhSharedBits(eph.privateKey, target.agreeJwk);
  const wrapKey = await hkdf(shared, utf8(bookId), utf8(info));
  const iv = randomBytes(12);
  const ct = await aesGcmEncrypt(wrapKey, iv, key, keyAad(bookId, epoch, target.deviceId));
  const ephJwk = publicOnly(await crypto.subtle.exportKey('jwk', eph.publicKey));
  return { deviceId: target.deviceId, epoch, ephJwk, iv: bytesToBase64Url(iv), ct: bytesToBase64Url(ct) };
}

/** Opens a key sealed for this device with its own agreement private key. Throws when it is not ours or was altered. */
export async function openSealedKey(agreePrivate: CryptoKey, bookId: string, sealed: SealedFor, info: string = EPOCH_INFO): Promise<Uint8Array> {
  const shared = await ecdhSharedBits(agreePrivate, sealed.ephJwk);
  const wrapKey = await hkdf(shared, utf8(bookId), utf8(info));
  return aesGcmDecrypt(wrapKey, base64UrlToBytes(sealed.iv), base64UrlToBytes(sealed.ct), keyAad(bookId, sealed.epoch, sealed.deviceId));
}
