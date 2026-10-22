import { describe, expect, it } from 'vitest';
import { createDatabase, createWorkspace, listEvents, migrate, MIGRATIONS, saveEvent, setEventPlanOff } from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const TRIP = { name: 'Bandung weekend', startsOn: '2026-11-07', endsOn: '2026-11-08' };

describe('an event kept without a plan (0082)', () => {
  it('starts planned, turns the plan off and back on, and an edit keeps the choice', async () => {
    const { database, ws } = await setupDb();
    const id = await saveEvent(database, ws, TRIP);
    expect((await listEvents(database, ws))[0]!.planOff).toBe(false);

    await setEventPlanOff(database, ws, id, true);
    expect((await listEvents(database, ws))[0]!.planOff).toBe(true);

    // Renaming goes through the schema's upsert, which never names the column, so the choice stays.
    await saveEvent(database, ws, { ...TRIP, id, name: 'Bandung long weekend' });
    expect((await listEvents(database, ws))[0]).toMatchObject({ name: 'Bandung long weekend', planOff: true });

    await setEventPlanOff(database, ws, id, false);
    expect((await listEvents(database, ws))[0]!.planOff).toBe(false);
  });

  it('refuses another workspace’s event', async () => {
    const { database, ws } = await setupDb();
    const id = await saveEvent(database, ws, TRIP);
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    await expect(setEventPlanOff(database, other, id, true)).rejects.toThrow();
    expect((await listEvents(database, ws))[0]!.planOff).toBe(false);
  });

  it('on a database from before 0082, events still add, list as planned, and the switch does nothing', async () => {
    const executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version < 82));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const id = await saveEvent(database, ws, TRIP);
    await setEventPlanOff(database, ws, id, true);
    expect((await listEvents(database, ws))[0]!.planOff).toBe(false);
    executor.close();
  });
});
