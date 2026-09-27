import { describe, expect, it } from 'vitest';
import { exportDeviceJwks, generateKeyPairs, importDeviceJwks, deviceKeysOf, MemoryKeyStore, requestSignerOf } from '../../src/sync/keys';
import { deviceIdOf, verifySignature } from '../../src/sync/relay-signing';

/*
 * A device's identity (spec §5.1, §5.2): generated once per KeyStore, its id derived from the raw signing key, its
 * private keys never extractable once stored — including after a round trip through a keychain's JWK form.
 */

describe('MemoryKeyStore', () => {
  it('makes one device on first ask and hands back the same one after', async () => {
    const store = new MemoryKeyStore();
    expect(await store.hasDevice()).toBe(false);
    const first = await store.getOrCreateDevice();
    expect(await store.hasDevice()).toBe(true);
    expect(await store.getOrCreateDevice()).toBe(first);
    expect(first.deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(first.deviceId).toBe(await deviceIdOf(first.public));
    expect(first.sign.privateKey.extractable).toBe(false);
    expect(first.agree.privateKey.extractable).toBe(false);
  });

  it('another store is another device', async () => {
    const a = await new MemoryKeyStore().getOrCreateDevice();
    const b = await new MemoryKeyStore().getOrCreateDevice();
    expect(a.deviceId).not.toBe(b.deviceId);
  });
});

describe("a keychain's JWK form (NativeKeyStore)", () => {
  it('round-trips to the same device, with private keys that come back non-extractable and still sign', async () => {
    const { sign, agree } = await generateKeyPairs(true);
    const original = await deviceKeysOf(sign, agree);
    const stored = await exportDeviceJwks(sign, agree);
    const back = await importDeviceJwks(JSON.parse(JSON.stringify(stored)));
    expect(back.deviceId).toBe(original.deviceId);
    expect(back.public).toEqual(original.public);
    expect(back.sign.privateKey.extractable).toBe(false);
    expect(back.agree.privateKey.extractable).toBe(false);
    const bytes = new TextEncoder().encode('hello');
    const signer = requestSignerOf(back);
    const sig = await signer.sign(bytes);
    const { bytesToBase64Url } = await import('../../src/sync/relay-signing');
    await expect(verifySignature(original.public.signJwk, bytes, bytesToBase64Url(sig))).resolves.toBe(true);
  });
});
