import { aesGcmDecrypt, aesGcmEncrypt, fromUtf8, hexToBytes, bytesToHex, hkdf, randomBytes, utf8 } from './crypto';
import { base64UrlToBytes, bytesToBase64Url, canonicalJson } from './relay-signing';
import type { InviteTerms, Sealed } from './types';

/*
 * Invites (spec §8.1–8.3). The code is the invite's id and a 16-byte secret `S`, in Crockford base32: 32 bytes, 52
 * characters, shown in groups of four. `S` never reaches the relay or the log; the invite key is derived from it, and
 * seals both the epoch keys the joiner needs and a preview — the book's name, the inviter's name and its currency —
 * which the joiner reads before claiming anything.
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_INFO = 'cicis-invite-v1';
export const JOIN_LINK_PREFIX = 'cicis://join/';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 32;
const CODE_CHARS = 52;

/** What the preview carries, sealed under the invite key (§8.1 step 4; `bookId` and `terms` added in task 5, see §8.1). */
export interface InvitePreview {
  bookId: string;
  bookName: string;
  inviterName: string;
  baseCurrency: string;
  terms: InviteTerms;
}

/** The bytes an invite's terms signature covers: the terms without `sig` and the book, keys sorted. */
export function termsSigningBytes(bookId: string, terms: Omit<InviteTerms, 'sig'> & { sig?: string }): Uint8Array {
  const { inviteId, sameMember, memberId } = terms;
  return utf8(canonicalJson({ purpose: 'cicis-invite-terms-v1', bookId, inviteId, sameMember, ...(memberId === undefined ? {} : { memberId }) }));
}

/** One epoch key as an invite carries it (§8.1 step 3). */
export interface InviteKey {
  epoch: number;
  key: string; // base64url
}

export function base32Crockford(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Decodes Crockford base32, forgiving case and the look-alikes it was made for (I and L are 1, O is 0). */
export function fromBase32Crockford(text: string, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const raw of text.toUpperCase()) {
    const char = raw === 'I' || raw === 'L' ? '1' : raw === 'O' ? '0' : raw;
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new InviteCodeError();
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      if (index >= byteLength) throw new InviteCodeError();
      out[index++] = (buffer >> (bits - 8)) & 0xff;
      bits -= 8;
      buffer &= (1 << bits) - 1;
    }
  }
  if (index !== byteLength || buffer !== 0) throw new InviteCodeError();
  return out;
}

export class InviteCodeError extends Error {
  constructor() {
    super('That is not an invite code');
    this.name = 'InviteCodeError';
  }
}

const uuidToBytes = (uuid: string) => hexToBytes(uuid.replace(/-/g, ''));
function bytesToUuid(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The code of §8.1 step 6: `base32crockford(inviteId bytes ‖ S)`, 52 characters in groups of four. */
export function encodeInviteCode(inviteId: string, secret: Uint8Array): string {
  const bytes = new Uint8Array(CODE_BYTES);
  bytes.set(uuidToBytes(inviteId), 0);
  bytes.set(secret, 16);
  return base32Crockford(bytes).match(/.{1,4}/g)!.join('-');
}

export function inviteLink(code: string): string {
  return JOIN_LINK_PREFIX + code;
}

/** The invite id and `S` from a code, however it was pasted: the link, spaces, dashes, any case. */
export function parseInviteCode(text: string): { inviteId: string; secret: Uint8Array } {
  const trimmed = text.trim();
  const body = trimmed.toLowerCase().startsWith(JOIN_LINK_PREFIX) ? trimmed.slice(JOIN_LINK_PREFIX.length) : trimmed;
  const symbols = body.replace(/[\s-]/g, '');
  if (symbols.length !== CODE_CHARS) throw new InviteCodeError();
  const bytes = fromBase32Crockford(symbols, CODE_BYTES);
  return { inviteId: bytesToUuid(bytes.slice(0, 16)), secret: bytes.slice(16) };
}

export function newInviteSecret(): Uint8Array {
  return randomBytes(16);
}

/** §8.1 step 2: `HKDF(ikm = S, salt = utf8(inviteId), info = 'cicis-invite-v1')`. */
export function inviteKeyOf(secret: Uint8Array, inviteId: string): Promise<Uint8Array> {
  return hkdf(secret, utf8(inviteId), utf8(INVITE_INFO));
}

/** What each sealed part of an invite is bound to, so the keys can never be opened as the preview or the other way. */
export const inviteAad = (part: 'keys' | 'preview', inviteId: string) => `${part}:${inviteId}`;

export async function sealInviteJson(key: Uint8Array, value: unknown, aad: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await aesGcmEncrypt(key, iv, utf8(JSON.stringify(value)), utf8(aad));
  return { iv: bytesToBase64Url(iv), ct: bytesToBase64Url(ct) };
}

/** Throws when the key is wrong (a mistyped code) or the sealed value was altered. */
export async function openInviteJson<T>(key: Uint8Array, sealed: Sealed, aad: string): Promise<T> {
  return JSON.parse(fromUtf8(await aesGcmDecrypt(key, base64UrlToBytes(sealed.iv), base64UrlToBytes(sealed.ct), utf8(aad)))) as T;
}
