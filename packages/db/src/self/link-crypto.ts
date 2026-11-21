import { randomBytes, utf8 } from '../sync/crypto';
import { bytesToBase64Url, canonicalJson, sha256Hex } from '../sync/relay-signing';
import type { DevicePublic } from '../sync/types';

/*
 * Link my devices (spec §3.5): the check digits both screens show. Each device commits to a random nonce before it
 * sees what decides the digits — the new device sends sha-256 of its nonce with its claim, the source reveals its own
 * only after that, the new device reveals its own only after the source's — so a relay that swaps either device's
 * keys can make the two screens agree only by luck, 1 in 10,000.
 */

export const CHECK_DIGITS = 4;

/** 32 random bytes, base64url (43 characters). */
export function newNonce(): string {
  return bytesToBase64Url(randomBytes(32));
}

export function commitOf(nonce: string): Promise<string> {
  return sha256Hex(utf8(`cicis-link-commit-v1:${nonce}`));
}

/** The 4 digits, from both devices' public keys and both nonces, the same on both sides when nothing was swapped. */
export async function checkDigits(input: { source: DevicePublic; joiner: DevicePublic; sourceNonce: string; joinerNonce: string }): Promise<string> {
  const hex = await sha256Hex(
    utf8(
      canonicalJson({
        v: 'cicis-link-check-v1',
        source: { sign: input.source.signJwk, agree: input.source.agreeJwk },
        joiner: { sign: input.joiner.signJwk, agree: input.joiner.agreeJwk },
        sourceNonce: input.sourceNonce,
        joinerNonce: input.joinerNonce,
      }),
    ),
  );
  return String(Number.parseInt(hex.slice(0, 8), 16) % 10 ** CHECK_DIGITS).padStart(CHECK_DIGITS, '0');
}

/** A code as typed or scanned: six digits, any spaces or dashes left out; null when it is not one. */
export function parseLinkCode(text: string): string | null {
  const digits = text.replace(/^cicis:\/\/link#?/i, '').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** What the square code on the source's screen carries: the same six digits, for a camera instead of fingers. */
export function linkQrText(code: string): string {
  return `cicis://link#${code}`;
}
