import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalJson,
  ecdsaRequestSigner,
  inviteSigningBytes,
  requestSigningBytes,
  sha256Hex,
  verifySignature,
} from '../../src/sync/relay-signing';
import type { InviteRecord } from '../../src/sync/types';

async function signingPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, publicJwk };
}

describe('relay-signing: base64url over bytes', () => {
  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...base64UrlToBytes(encoded)]).toEqual([...bytes]);
  });
});

describe('relay-signing: canonicalJson sorts keys at every depth (spec §6.6 "keys sorted")', () => {
  it('ignores insertion order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('drops undefined properties as JSON does', () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});

describe('relay-signing: the §9.1 request string', () => {
  it('is method, path, timestamp and the hex SHA-256 of the body, newline-joined', async () => {
    const body = new TextEncoder().encode('{"x":1}');
    const bytes = await requestSigningBytes('POST', '/books/b/entries', '1700000000000', body);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(`POST\n/books/b/entries\n1700000000000\n${await sha256Hex(body)}`);
    expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('relay-signing: ECDSA P-256 / SHA-256 sign and verify', () => {
  it('verifies what the signer signed, and nothing else', async () => {
    const { pair, publicJwk } = await signingPair();
    const signer = ecdsaRequestSigner('dev-1', publicJwk, pair.privateKey);
    const data = new TextEncoder().encode('hello');
    const sig = bytesToBase64Url(await signer.sign(data));
    expect(await verifySignature(publicJwk, data, sig)).toBe(true);
    expect(await verifySignature(publicJwk, new TextEncoder().encode('hellO'), sig)).toBe(false);

    const other = await signingPair();
    expect(await verifySignature(other.publicJwk, data, sig)).toBe(false);
  });

  it('answers false, never throws, for a malformed key or signature', async () => {
    const data = new TextEncoder().encode('hello');
    expect(await verifySignature({ kty: 'EC', crv: 'P-256', x: 'nope', y: 'nope' }, data, 'AAAA')).toBe(false);
    const { publicJwk } = await signingPair();
    expect(await verifySignature(publicJwk, data, 'not base64url!!')).toBe(false);
  });
});

describe('relay-signing: an invite is signed over everything but its sig, keys sorted (spec §5.4)', () => {
  it('ignores the sig field and key order', () => {
    const a: InviteRecord = {
      inviteId: 'i',
      keys: { iv: 'a', ct: 'b' },
      preview: { iv: 'c', ct: 'd' },
      expiresAt: '2030-01-01T00:00:00.000Z',
      sameMember: false,
      sig: 'one',
    };
    const b = { sig: 'two', sameMember: false, expiresAt: a.expiresAt, preview: a.preview, keys: a.keys, inviteId: 'i' };
    expect(new TextDecoder().decode(inviteSigningBytes(a))).toBe(new TextDecoder().decode(inviteSigningBytes(b)));
    expect(new TextDecoder().decode(inviteSigningBytes(a))).not.toContain('sig');
  });
});
