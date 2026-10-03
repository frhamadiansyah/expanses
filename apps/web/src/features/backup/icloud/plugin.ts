import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The app's own Swift plugin (ios/App/App/ICloudBackupPlugin.swift): the iCloud Drive folder, and the key in iCloud
 * Keychain. It moves bytes and keeps the key; every decision is made on this side.
 */
export interface ICloudBackupPlugin {
  status(): Promise<{ available: boolean; deviceId: string; model: string }>;
  list(): Promise<{ names: string[] }>;
  write(options: { name: string; base64: string }): Promise<{ bytes: number }>;
  read(options: { name: string }): Promise<{ base64: string }>;
  remove(options: { name: string }): Promise<void>;
  /** With `keyId`, that key or a `no_key` rejection; without, the key new copies are locked with. */
  key(options?: { keyId?: string }): Promise<{ keyId: string; key: string }>;
  openSettings(): Promise<void>;
}

export const ICloudBackup = registerPlugin<ICloudBackupPlugin>('ICloudBackup');

/** iCloud backup exists only in the iOS app. The web and the desktop keep downloading a file. */
export const hasICloud = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

/** The rejection code a plugin call carries, or null. */
export const codeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
};

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
