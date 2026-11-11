import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { memberSilence, ownersGone, OWNERS_GONE_DAYS, recordDevicesSeen, SILENT_NOTE_DAYS } from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { Household, type Device } from './household';

/* Silence from the other side (sharing resilience §8.1, D-A10, D-A11): Dewi owns the share, Fandri is a member. */

const DAY = 86_400_000;
// Day 0 is now, so the join's own `synced_at` is not ahead of the test clock.
const T0 = Date.now();

async function setup() {
  const home = new Household();
  const dewi = await home.device('Dewi');
  const fandri0 = await home.device('Fandri');
  const bookId = await home.share(dewi);
  await home.join(fandri0, dewi);
  await home.settle();
  const clock = { at: T0 };
  // Fandri's phone keeps its own clock: the engine's injectable `now`.
  const fandri: Device = { ...fandri0, engine: new SyncEngine(fandri0.database, fandri0.transport, fandri0.keys, () => clock.at) };
  home.devices.splice(home.devices.indexOf(fandri0), 1, fandri);
  // Dewi's last change at day 0, as the sync service feeds it from each pulled entry's hlc.
  await recordDevicesSeen(fandri.database, bookId, { [dewi.deviceId]: T0 });
  const syncAt = async (days: number) => {
    clock.at = T0 + days * DAY;
    await fandri.engine.syncOnce(bookId);
  };
  return { home, dewi, fandri, bookId, clock, syncAt };
}

describe('memberSilence', () => {
  it('counts whole days since each other member’s newest change, from their devices in the view', async () => {
    const { dewi, fandri, bookId, syncAt } = await setup();
    await syncAt(6);
    const at6 = await memberSilence(fandri.database, bookId, fandri.deviceId, T0 + 6 * DAY);
    expect(at6).toEqual([{ memberId: dewi.memberId, name: 'Dewi', role: 'owner', lastChangeAt: new Date(T0).toISOString(), silentDays: 6 }]);
    await syncAt(7);
    const at7 = await memberSilence(fandri.database, bookId, fandri.deviceId, T0 + 7 * DAY);
    expect(at7[0]?.silentDays).toBe(SILENT_NOTE_DAYS);
  });

  it('takes the newest over a member’s devices, and null when none was heard', async () => {
    const { dewi, fandri, bookId } = await setup();
    await recordDevicesSeen(fandri.database, bookId, { [dewi.deviceId]: T0 + 3 * DAY });
    expect((await memberSilence(fandri.database, bookId, fandri.deviceId, T0 + 5 * DAY))[0]?.silentDays).toBe(2);
    await fandri.database.db.run(sql`DELETE FROM settings WHERE key LIKE 'sync.seen.%'`);
    const none = await memberSilence(fandri.database, bookId, fandri.deviceId, T0 + 5 * DAY);
    expect(none[0]).toMatchObject({ lastChangeAt: null, silentDays: null });
  });
});

describe('ownersGone and keeping a copy as own', () => {
  it('is false at day 13 and true at day 14; forgetSharing follows', async () => {
    const { fandri, bookId, syncAt } = await setup();
    await syncAt(13);
    expect(await ownersGone(fandri.database, bookId, fandri.deviceId, T0 + 13 * DAY)).toEqual({ gone: false, since: new Date(T0).toISOString() });
    await expect(fandri.engine.forgetSharing(bookId)).rejects.toMatchObject({ code: 'STILL_SHARED' });
    await syncAt(OWNERS_GONE_DAYS);
    expect(await ownersGone(fandri.database, bookId, fandri.deviceId, T0 + 14 * DAY)).toEqual({ gone: true, since: new Date(T0).toISOString() });
    await fandri.engine.forgetSharing(bookId);
    expect(await fandri.database.db.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${bookId}`)).toEqual([]);
  });

  it('is false when this phone has not synced in the last hour, so the silence may be its own', async () => {
    const { fandri, bookId, syncAt } = await setup();
    await syncAt(14);
    const later = T0 + 14 * DAY + 2 * 3_600_000;
    expect((await ownersGone(fandri.database, bookId, fandri.deviceId, later)).gone).toBe(false);
  });

  it('is never true for an owner’s own phone', async () => {
    const { dewi, bookId } = await setup();
    await dewi.engine.syncOnce(bookId);
    await recordDevicesSeen(dewi.database, bookId, { [dewi.deviceId]: T0 });
    const now = Date.now() + 30 * DAY;
    await dewi.database.db.run(sql`UPDATE shared_books SET synced_at = ${new Date(now).toISOString()}`);
    expect((await ownersGone(dewi.database, bookId, dewi.deviceId, now)).gone).toBe(false);
  });
});
