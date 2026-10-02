import { type Database, dataCounts, schema } from '@expanses/db';

/**
 * The two iCloud switches, kept in the data rather than on the device: a copy restored on a new iPhone brings the
 * owner's choice with it, so the new phone carries on backing up without being asked again.
 */
export const ICLOUD_KEY = 'icloud_backup';
export const ICLOUD_PHOTOS_KEY = 'icloud_backup_photos';
/** Set on an install that already had data when iCloud backup arrived: the switch starts off and the page offers it once. */
export const ICLOUD_OFFER_KEY = 'icloud_backup_offer';

export interface ICloudSettings {
  enabled: boolean;
  withPhotos: boolean;
  /** Whether the one-time "Back up to iCloud?" offer is still waiting for an answer. */
  offer: boolean;
}

async function readSettings(database: Database): Promise<Map<string, string>> {
  const rows = await database.db.select().from(schema.settings);
  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function putSetting(database: Database, key: string, value: string): Promise<void> {
  await database.db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

/**
 * The switches as they stand, deciding them the first time they are asked for: on for a new install, and off — with
 * the offer waiting — for one that already holds someone's money, who never agreed to it leaving the phone.
 */
export async function iCloudSettings(database: Database): Promise<ICloudSettings> {
  const stored = await readSettings(database);
  let enabled = stored.get(ICLOUD_KEY);
  let offer = stored.get(ICLOUD_OFFER_KEY);
  if (enabled === undefined) {
    const existing = await hasData(database);
    enabled = existing ? 'off' : 'on';
    offer = existing ? 'pending' : 'answered';
    await putSetting(database, ICLOUD_KEY, enabled);
    await putSetting(database, ICLOUD_OFFER_KEY, offer);
  }
  return { enabled: enabled === 'on', withPhotos: stored.get(ICLOUD_PHOTOS_KEY) !== 'off', offer: offer === 'pending' };
}

/** Whether there is anything here worth keeping: a fresh install has categories and nothing else. */
export async function hasData(database: Database): Promise<boolean> {
  const counts = await dataCounts(database);
  return counts.accounts + counts.transactions > 0;
}
