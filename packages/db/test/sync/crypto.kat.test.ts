import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aesGcmDecrypt, aesGcmEncrypt, bytesToHex, deflate, ecdhSharedBits, hexToBytes, hkdf, inflate } from '../../src/sync/crypto';
import { bytesToBase64Url, deviceIdOf, verifySignature } from '../../src/sync/relay-signing';

/*
 * Known-answer tests for every primitive household sharing builds on (spec §5, §13): HKDF-SHA-256 against RFC 5869,
 * AES-GCM against the GCM specification's test cases (McGrew & Viega, the vectors NIST's GCM validation uses),
 * ECDSA P-256 / SHA-256 against RFC 6979 A.2.5 (import the public key and verify its published signatures), and
 * ECDH P-256 against NIST CAVS's KAS ECC CDH primitive vector. WebCrypto does the work; these prove we call it right.
 */

const b64u = (hex: string) => bytesToBase64Url(hexToBytes(hex));

describe('HKDF-SHA-256 (RFC 5869, appendix A)', () => {
  it('test case 1: basic', async () => {
    const okm = await hkdf(hexToBytes('0b'.repeat(22)), hexToBytes('000102030405060708090a0b0c'), hexToBytes('f0f1f2f3f4f5f6f7f8f9'), 42 * 8);
    expect(bytesToHex(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });

  it('test case 3: zero-length salt and info', async () => {
    const okm = await hkdf(hexToBytes('0b'.repeat(22)), new Uint8Array(), new Uint8Array(), 42 * 8);
    expect(bytesToHex(okm)).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
  });
});

describe('AES-GCM-256 (the GCM specification test cases 13, 14 and 16)', () => {
  it('case 13: empty plaintext under the zero key gives only the tag', async () => {
    const out = await aesGcmEncrypt(hexToBytes('00'.repeat(32)), hexToBytes('00'.repeat(12)), new Uint8Array());
    expect(bytesToHex(out)).toBe('530f8afbc74536b9a963b4f1c4cb738b');
  });

  it('case 14: one zero block', async () => {
    const out = await aesGcmEncrypt(hexToBytes('00'.repeat(32)), hexToBytes('00'.repeat(12)), hexToBytes('00'.repeat(16)));
    expect(bytesToHex(out)).toBe('cea7403d4d606b6e074ec5d3baf39d18' + 'd0d1c8a799996bf0265b98b5d48ab919');
  });

  const key16 = 'feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308';
  const iv16 = 'cafebabefacedbaddecaf888';
  const plain16 =
    'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39';
  const aad16 = 'feedfacedeadbeeffeedfacedeadbeefabaddad2';
  const cipher16 =
    '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662';
  const tag16 = '76fc6ece0f4e1768cddf8853bb2d551b';

  it('case 16: with additional data, both ways', async () => {
    const out = await aesGcmEncrypt(hexToBytes(key16), hexToBytes(iv16), hexToBytes(plain16), hexToBytes(aad16));
    expect(bytesToHex(out)).toBe(cipher16 + tag16);
    const back = await aesGcmDecrypt(hexToBytes(key16), hexToBytes(iv16), hexToBytes(cipher16 + tag16), hexToBytes(aad16));
    expect(bytesToHex(back)).toBe(plain16);
  });

  it('case 16: other additional data fails to open', async () => {
    await expect(aesGcmDecrypt(hexToBytes(key16), hexToBytes(iv16), hexToBytes(cipher16 + tag16), hexToBytes('00'))).rejects.toThrow();
  });
});

describe('ECDSA P-256 with SHA-256 (RFC 6979, A.2.5)', () => {
  const publicJwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64u('60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6'),
    y: b64u('7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299'),
  };
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it('verifies the published signature of "sample"', async () => {
    const sig = b64u('efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716' + 'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8');
    await expect(verifySignature(publicJwk, utf8('sample'), sig)).resolves.toBe(true);
    await expect(verifySignature(publicJwk, utf8('samplf'), sig)).resolves.toBe(false);
  });

  it('verifies the published signature of "test"', async () => {
    const sig = b64u('f1abb023518351cd71d881567b1ea663ed3efcf6c5132b354f28d3b0b7d38367' + '019f4113742a2b14bd25926b49c649155f267e60d3814b4c0cc84250e46f0083');
    await expect(verifySignature(publicJwk, utf8('test'), sig)).resolves.toBe(true);
  });

  it("a device's id is the first 32 hex digits of SHA-256 over its raw public signing key (§5.1)", async () => {
    const raw = '04' + '60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6' + '7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299';
    const expected = createHash('sha256').update(Buffer.from(raw, 'hex')).digest('hex').slice(0, 32);
    await expect(deviceIdOf({ signJwk: publicJwk })).resolves.toBe(expected);
  });
});

describe('ECDH P-256 (NIST CAVS KAS ECC CDH primitive, P-256 COUNT = 0)', () => {
  it('derives the published shared secret', async () => {
    const d = '7d7dc5f71eb29ddaf80d6214632eeae03d9058af1fb6d22ed80badb62bc1a534';
    const ourX = 'ead218590119e8876b29146ff89ca61770c4edbbf97d38ce385ed281d8a6b230';
    const ourY = '28af61281fd35e2fa7002523acc85a429cb06ee6648325389f59edfce1405141';
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(ourX), y: b64u(ourY) },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const theirs: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      x: b64u('700c48f77f56584c5cc632ca65640db91b6bacce3a4df6b42ce7cc838833d287'),
      y: b64u('db71e509e3fd9b060ddb20ba5c51dcc5948d46fbf640dfe0441782cab85fa4ac'),
    };
    const z = await ecdhSharedBits(privateKey, theirs);
    expect(bytesToHex(z)).toBe('46fc62106420ff012e54a434fbdd2d25ccc5852060561e68040dd7778997bd7b');
  });
});

describe('deflate (CompressionStream)', () => {
  it('round-trips and shrinks a repetitive change-set', async () => {
    const text = JSON.stringify({ ops: Array.from({ length: 50 }, (_, i) => ({ entity: 'category', id: `id-${i}`, op: 'upsert' })) });
    const packed = await deflate(new TextEncoder().encode(text));
    expect(packed.length).toBeLessThan(text.length / 3);
    expect(new TextDecoder().decode(await inflate(packed))).toBe(text);
  });
});
