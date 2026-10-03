import { type CopyContents, keyIdOf, seal, unseal } from './envelope';
import { backupDue, type CloudCopy, copiesToRemove, copyName, listCopies, parseName } from './names';
import { codeOf, fromBase64, type ICloudBackupPlugin, toBase64 } from './plugin';

/** What a copy is made from: this device's data, read at the moment the copy is taken. */
export interface CopySource {
  database: () => Promise<Uint8Array>;
  counts: () => Promise<{ accounts: number; transactions: number }>;
  photoNames: () => Promise<string[]>;
  readPhoto: (name: string) => Promise<Uint8Array | null>;
}

/** iCloud is off for the app (not signed in, or iCloud Drive turned off for cicis). */
export class ICloudUnavailableError extends Error {
  constructor() {
    super('iCloud Drive is off for cicis. Turn it on in Settings.');
  }
}

/**
 * Takes one copy now: reads the data (and the photos, when asked), locks it, writes it to iCloud Drive, and then
 * removes this device's copies the keep rule no longer wants. A removal that fails is left for the next copy to
 * retry; the copy just written is what matters.
 */
export async function backUpNow(plugin: ICloudBackupPlugin, source: CopySource, options: { withPhotos: boolean; now?: Date }): Promise<CloudCopy> {
  const status = await plugin.status();
  if (!status.available) throw new ICloudUnavailableError();
  const takenAt = (options.now ?? new Date()).toISOString();
  const key = await plugin.key();
  const photos: CopyContents['photos'] = [];
  if (options.withPhotos) {
    for (const name of await source.photoNames()) {
      const bytes = await source.readPhoto(name);
      if (bytes) photos.push({ name, bytes });
    }
  }
  const counts = await source.counts();
  const sealed = await seal(
    { database: await source.database(), summary: { takenAt, model: status.model, ...counts, photos: photos.length }, photos },
    { keyId: key.keyId, raw: fromBase64(key.key) },
  );
  const name = copyName({ takenAt, model: status.model, device: status.deviceId, withPhotos: options.withPhotos, bytes: sealed.length });
  await plugin.write({ name, base64: toBase64(sealed) });
  try {
    const { names } = await plugin.list();
    for (const old of copiesToRemove(listCopies(names), status.deviceId)) {
      if (old !== name) await plugin.remove({ name: old });
    }
  } catch (error) {
    console.warn('Old iCloud copies were not removed this time', error);
  }
  return parseName(name)!;
}

/** Every copy in iCloud, newest first, or null when iCloud is not available. */
export async function cloudCopies(plugin: ICloudBackupPlugin): Promise<{ copies: CloudCopy[]; deviceId: string; model: string } | null> {
  const status = await plugin.status();
  if (!status.available) return null;
  const { names } = await plugin.list();
  return { copies: listCopies(names), deviceId: status.deviceId, model: status.model };
}

/**
 * Brings a copy down and opens it. Nothing on this device is changed: the caller decides what to do with what is
 * inside. A copy locked with a key this device does not have says so in words the owner can act on.
 */
export async function openCopy(plugin: ICloudBackupPlugin, name: string): Promise<CopyContents> {
  const bytes = fromBase64((await plugin.read({ name })).base64);
  const keyId = keyIdOf(bytes);
  let key: { key: string };
  try {
    key = await plugin.key({ keyId });
  } catch (error) {
    if (codeOf(error) === 'no_key')
      throw new Error(
        'This iPhone does not have the key for that copy yet. The key travels in iCloud Keychain: check that it is on in Settings › Apple ID › iCloud › Passwords and Keychain, wait a minute, and try again.',
      );
    throw error;
  }
  return unseal(bytes, fromBase64(key.key));
}

/** Runs a copy if one is due, and answers whether one was taken. Errors are the caller's to report or swallow. */
export async function backUpIfDue(
  plugin: ICloudBackupPlugin,
  source: CopySource,
  state: { enabled: boolean; withPhotos: boolean; hasData: boolean; bigChange: boolean; now?: Date },
): Promise<boolean> {
  if (!state.enabled || !state.hasData) return false;
  const listed = await cloudCopies(plugin);
  if (!listed) return false;
  const now = state.now ?? new Date();
  if (!backupDue({ ...state, copies: listed.copies, device: listed.deviceId, now })) return false;
  await backUpNow(plugin, source, { withPhotos: state.withPhotos, now });
  return true;
}
