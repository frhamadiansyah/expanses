import { deviceIdOf, ecdsaRequestSigner, type RequestSigner } from './relay-signing';
import type { DevicePublic } from './types';

/*
 * A device's identity (spec §5.1, §5.2): an ECDSA P-256 pair for signing and an ECDH P-256 pair for agreement, made at
 * first launch and kept on this device only — never synchronised, never in the database, never in a backup. The
 * `KeyStore` is where they live: `WebKeyStore` (IndexedDB, non-extractable `CryptoKey`s) and `NativeKeyStore` (the
 * platform keychain) in `apps/web`, `MemoryKeyStore` here for tests and anything else that runs in Node.
 */

export const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
export const ECDH_P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

export interface DeviceKeys {
  deviceId: string;
  sign: CryptoKeyPair;
  agree: CryptoKeyPair;
  public: DevicePublic;
}

export interface KeyStore {
  getOrCreateDevice(): Promise<DeviceKeys>;
  hasDevice(): Promise<boolean>;
}

/** Two fresh key pairs. `extractable` is false wherever the platform can keep a `CryptoKey` itself (IndexedDB). */
export async function generateKeyPairs(extractable: boolean): Promise<{ sign: CryptoKeyPair; agree: CryptoKeyPair }> {
  const sign = await crypto.subtle.generateKey(ECDSA_P256, extractable, ['sign', 'verify']);
  const agree = await crypto.subtle.generateKey(ECDH_P256, extractable, ['deriveBits']);
  return { sign, agree };
}

/** The public half of a JWK, with nothing an importer could trip on. */
export function publicJwk(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/** A device from its two pairs: the public JWKs (a public key is always exportable) and the id they give (§5.1). */
export async function deviceKeysOf(sign: CryptoKeyPair, agree: CryptoKeyPair): Promise<DeviceKeys> {
  const pub: DevicePublic = {
    signJwk: publicJwk(await crypto.subtle.exportKey('jwk', sign.publicKey)),
    agreeJwk: publicJwk(await crypto.subtle.exportKey('jwk', agree.publicKey)),
  };
  return { deviceId: await deviceIdOf(pub), sign, agree, public: pub };
}

export async function generateDevice(extractable = false): Promise<DeviceKeys> {
  const { sign, agree } = await generateKeyPairs(extractable);
  return deviceKeysOf(sign, agree);
}

/** What a keychain holds for a device: both private keys as JWK (each JWK carries its public point too). */
export interface DeviceJwks {
  signJwk: JsonWebKey;
  agreeJwk: JsonWebKey;
}

/** Exports extractable pairs for a store that can only hold strings (the platform keychain). */
export async function exportDeviceJwks(sign: CryptoKeyPair, agree: CryptoKeyPair): Promise<DeviceJwks> {
  return { signJwk: await crypto.subtle.exportKey('jwk', sign.privateKey), agreeJwk: await crypto.subtle.exportKey('jwk', agree.privateKey) };
}

/** Imports what `exportDeviceJwks` wrote; the private keys come back non-extractable. */
export async function importDeviceJwks(stored: DeviceJwks): Promise<DeviceKeys> {
  const strip = ({ key_ops: _ops, ext: _ext, ...jwk }: JsonWebKey) => jwk;
  const signPrivate = await crypto.subtle.importKey('jwk', strip(stored.signJwk), ECDSA_P256, false, ['sign']);
  const signPublic = await crypto.subtle.importKey('jwk', publicJwk(stored.signJwk), ECDSA_P256, true, ['verify']);
  const agreePrivate = await crypto.subtle.importKey('jwk', strip(stored.agreeJwk), ECDH_P256, false, ['deriveBits']);
  const agreePublic = await crypto.subtle.importKey('jwk', publicJwk(stored.agreeJwk), ECDH_P256, true, []);
  return deviceKeysOf({ privateKey: signPrivate, publicKey: signPublic }, { privateKey: agreePrivate, publicKey: agreePublic });
}

/** The relay's request signer (spec §9.1) for this device. */
export function requestSignerOf(device: DeviceKeys): RequestSigner {
  return ecdsaRequestSigner(device.deviceId, device.public.signJwk, device.sign.privateKey);
}

/** A `KeyStore` in memory: tests, and Node. A fresh instance is a fresh device, like a restored or replaced phone. */
export class MemoryKeyStore implements KeyStore {
  private device: Promise<DeviceKeys> | undefined;

  constructor(device?: DeviceKeys) {
    if (device) this.device = Promise.resolve(device);
  }

  getOrCreateDevice(): Promise<DeviceKeys> {
    this.device ??= generateDevice(false);
    return this.device;
  }

  async hasDevice(): Promise<boolean> {
    return this.device !== undefined;
  }
}
