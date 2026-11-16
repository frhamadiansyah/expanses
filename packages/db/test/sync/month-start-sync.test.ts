import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { inBook, monthStartFor, phonesBehindMonthStart, runSharedBookRepairs, setBookMonthStart } from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { Household, skipsOf, type Device } from './household';

/*
 * "Month starts on" in a shared workspace (0118): Sari and Dimas, two phones on one relay, both counting the same
 * months. Invented names.
 */

const BUILD = '0.5.4';

async function family(dimasVersion = BUILD) {
  const h = new Household();
  const sari = await h.device('Sari', 'member-Sari', 'IDR', BUILD);
  const dimas = await h.device('Dimas', 'member-Dimas', 'IDR', dimasVersion);
  await h.share(sari);
  await h.join(dimas, sari);
  await h.settle();
  const startOf = (d: Device) => monthStartFor(d.database, inBook(d.ws, h.bookId));
  const set = (d: Device, day: number) => setBookMonthStart(d.database, d.ws, h.bookId, day);
  return { h, sari, dimas, startOf, set };
}

/** The phone now runs this build and says so on its next sync. */
function update(d: Device) {
  d.engine = new SyncEngine(d.database, d.transport, d.keys, undefined, { appVersion: BUILD, shareRecords: d.records });
}

/** What a build before 0118 holds once it applied a change: the field's clock, and no value (calendar months). */
async function asOldBuildHeldIt(d: Device) {
  await d.database.execScript('UPDATE books SET month_start_day = 1');
}

/** Migration 0118 on that phone as it updates, its column already there: the clock drop alone. */
async function migrateTo0118(d: Device) {
  const text = readFileSync(fileURLToPath(new URL('../../migrations/0118_month_starts_on.sql', import.meta.url)), 'utf8');
  await d.database.execScript(text.replace(/^ALTER TABLE .*$/gm, ''));
}

const clockOf = (d: Device) => d.database.db.values<[string]>(sql`SELECT field FROM sync_field_clocks WHERE entity = 'book' AND field = 'monthStartDay'`);

describe('one value on both phones', () => {
  it('a workspace shared before the setting starts its months on the 1st on both', async () => {
    const f = await family();
    expect([await f.startOf(f.sari), await f.startOf(f.dimas)]).toEqual([1, 1]);
  });

  it('set on one phone, the other counts the same months; changed back there, both follow', async () => {
    const f = await family();
    await f.set(f.sari, 25);
    await f.h.settle();
    expect(await f.startOf(f.dimas)).toBe(25);
    await f.set(f.dimas, 31);
    await f.h.settle();
    expect([await f.startOf(f.sari), await f.startOf(f.dimas)]).toEqual([31, 31]);
    expect(await skipsOf(f.dimas.database)).toEqual([]);
    expect(await skipsOf(f.sari.database)).toEqual([]);
  });

  it('two phones changing it at once agree on one value', async () => {
    const f = await family();
    await f.set(f.sari, 25);
    await f.set(f.dimas, 20);
    await f.h.settle();
    expect(await f.startOf(f.sari)).toBe(await f.startOf(f.dimas));
  });

  it('a value this build does not offer, arriving from elsewhere, reads as the 1st', async () => {
    const f = await family();
    await f.dimas.database.execScript(`UPDATE books SET month_start_day = 30 WHERE id = '${f.h.bookId}'`);
    expect(await f.startOf(f.dimas)).toBe(1);
  });
});

describe('a phone on an older build', () => {
  it('is named while it is behind, so the setting can say it still counts calendar months', async () => {
    const f = await family('0.5.3');
    expect(await phonesBehindMonthStart(f.sari.database, f.h.bookId)).toEqual(["Dimas's phone"]);
    expect(await phonesBehindMonthStart(f.dimas.database, f.h.bookId)).toEqual([]);
  });

  it('once updated, gets the value its older build dropped: sent again at its own clock, never a newer one', async () => {
    const f = await family('0.5.3');
    await f.set(f.sari, 25);
    // Her phone's first pass is for itself, crossing to this build; nothing more goes while he is behind.
    await runSharedBookRepairs(f.sari.database, f.h.bookId);
    await f.h.settle();
    await asOldBuildHeldIt(f.dimas);
    expect(await f.startOf(f.dimas)).toBe(1);
    expect(await clockOf(f.dimas)).toEqual([['monthStartDay']]);
    expect((await runSharedBookRepairs(f.sari.database, f.h.bookId)).monthStart).toBeNull();

    await migrateTo0118(f.dimas);
    expect(await clockOf(f.dimas)).toEqual([]);
    update(f.dimas);
    await f.h.settle();
    // His own pass has nothing to send: he holds no clock for it.
    expect((await runSharedBookRepairs(f.dimas.database, f.h.bookId)).monthStart).toBe(0);
    expect((await runSharedBookRepairs(f.sari.database, f.h.bookId)).monthStart).toBe(1);
    await f.h.settle();
    expect([await f.startOf(f.sari), await f.startOf(f.dimas)]).toEqual([25, 25]);
    // Done for that crossing: asked again, nothing goes.
    expect((await runSharedBookRepairs(f.sari.database, f.h.bookId)).monthStart).toBeNull();
    expect(await skipsOf(f.dimas.database)).toEqual([]);
  });

  it('a later change on the updated phone is not undone by the resend', async () => {
    const f = await family('0.5.3');
    await f.set(f.sari, 25);
    await runSharedBookRepairs(f.sari.database, f.h.bookId);
    await f.h.settle();
    await asOldBuildHeldIt(f.dimas);
    await migrateTo0118(f.dimas);
    update(f.dimas);
    await f.set(f.dimas, 10);
    await f.h.settle();
    await runSharedBookRepairs(f.sari.database, f.h.bookId);
    await f.h.settle();
    expect([await f.startOf(f.sari), await f.startOf(f.dimas)]).toEqual([10, 10]);
  });
});
