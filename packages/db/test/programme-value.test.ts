import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProgramme,
  type Database,
  getProgrammeValuePerPoint,
  listProgrammes,
  listProgrammeValues,
  MIGRATIONS,
  programmeExpiry,
  recordPointSnapshot,
  recordRedemption,
  setProgramExpiry,
  setProgrammeValuePerPoint,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

/** A programme's value per point (0105): a scaled integer in the base currency, null until set, read by name. */

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('migration 0105', () => {
  it('is version 105 and named programme_value_per_point', () => {
    expect(MIGRATIONS.find((m) => m.version === 105)).toMatchObject({ name: 'programme_value_per_point' });
  });

  it('adds a nullable value_per_point_e4 to point_programmes', async () => {
    const columns = await database.db.values<[string, number]>(sql`SELECT name, "notnull" FROM pragma_table_info('point_programmes') WHERE name = 'value_per_point_e4'`);
    expect(columns).toEqual([['value_per_point_e4', 0]]);
  });
});

describe('programme value per point', () => {
  it('is unset until chosen, keeps the figure, and is cleared with null', async () => {
    const kris = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });
    expect(await getProgrammeValuePerPoint(database, ws, kris.id)).toBeNull();
    await setProgrammeValuePerPoint(database, ws, kris.id, 1_100_000);
    expect(await listProgrammeValues(database, ws)).toEqual({ [kris.id]: 1_100_000 });
    await setProgrammeValuePerPoint(database, ws, kris.id, 5_000);
    expect(await getProgrammeValuePerPoint(database, ws, kris.id)).toBe(5_000);
    await setProgrammeValuePerPoint(database, ws, kris.id, null);
    expect(await getProgrammeValuePerPoint(database, ws, kris.id)).toBeNull();
  });

  it('refuses nothing or less, and does not change the programme row', async () => {
    const kris = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });
    await expect(setProgrammeValuePerPoint(database, ws, kris.id, 0)).rejects.toThrow();
    await expect(setProgrammeValuePerPoint(database, ws, kris.id, 1.5)).rejects.toThrow();
    await setProgrammeValuePerPoint(database, ws, kris.id, 1000);
    const [row] = await listProgrammes(database, ws);
    expect(row).toEqual(kris);
  });
});

describe('programme expiry', () => {
  it('reports the windows, the next date and the lots after spending', async () => {
    const programme = await createProgramme(database, ws, { name: 'Bank', unit: 'points' });
    expect((await programmeExpiry(database, ws, programme.id, '2026-10-05')).canExpire).toBe(false);
    await setProgramExpiry(database, ws, programme.id, 'fixed_annual', null);
    await recordPointSnapshot(database, ws, { programId: programme.id, balance: 10_000, observedOn: '2026-10-01' });
    await recordRedemption(database, ws, { programId: programme.id, kind: 'redeem', points: 4000, occurredOn: '2026-10-02', note: 'Flight', valueMinor: null });
    const expiry = await programmeExpiry(database, ws, programme.id, '2026-10-05');
    expect(expiry.canExpire).toBe(true);
    expect(expiry.lots).toEqual([{ expiresOn: '2026-12-31', remaining: 6000 }]);
    expect(expiry.nextExpiryOn).toBe('2026-12-31');
    expect(expiry.in30).toBe(0);
    expect(expiry.in90).toBe(6000);
  });
});
