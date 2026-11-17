import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clearCategoryNeed, inBook, listCategoryNeeds, migrate, phonesBehindThirdMark, runSharedBookRepairs, saveCategoryNeed } from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { categoryOf, type Device, Household, type PhoneErrors, type PhoneErrorsSetting, projectBook, skipsOf } from './household';

/*
 * Debts & savings, the third category mark (0119), in a shared workspace on two phones: Fandri's on this build, Dewi's
 * on 0.5.3, whose category_needs table refuses the value by its CHECK — and, as on a real phone, whose SQLite errors
 * reach apply as plain messages with no code (`phoneErrors`), so a refusal there would stop her pull, not be skipped.
 */

const BUILD = '0.5.4';
const OLDER = '0.5.3';

/** Her table as 0053 made it, and 0119 not yet run: what a phone on 0.5.3 holds. */
async function asOlderTable(d: Device) {
  await d.database.execScript(`
    CREATE TABLE category_needs_old (category_account_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, need TEXT NOT NULL CHECK (need IN ('essential', 'lifestyle')));
    INSERT INTO category_needs_old SELECT category_account_id, workspace_id, need FROM category_needs;
    DROP TABLE category_needs;
    ALTER TABLE category_needs_old RENAME TO category_needs;
    CREATE INDEX category_needs_workspace ON category_needs (workspace_id);
    DELETE FROM schema_migrations WHERE version = 119;`);
}

/** She updates: the app opens, 0119 runs, and the engine says this build on its next sync. */
async function update(d: Device) {
  expect(await migrate(d.database)).toEqual([119]);
  d.engine = new SyncEngine(d.database, d.transport, d.keys, undefined, { appVersion: BUILD, shareRecords: d.records });
}

async function household(options: { dewi?: string; markBeforeJoin?: boolean; dewiErrors?: PhoneErrorsSetting } = {}) {
  const home = new Household();
  const fandri = await home.device('Fandri', undefined, 'IDR', BUILD, { phoneErrors: true });
  const dewi = await home.device('Dewi', undefined, 'IDR', options.dewi ?? OLDER, { phoneErrors: options.dewiErrors ?? true });
  if ((options.dewi ?? OLDER) === OLDER) await asOlderTable(dewi);
  const bookId = await home.share(fandri);
  const ws = (d: Device) => inBook(d.ws, bookId);
  const cover = await categoryOf(fandri.database, bookId, 'Life insurance');
  const dining = await categoryOf(fandri.database, bookId, 'Restaurants');
  if (options.markBeforeJoin) await saveCategoryNeed(fandri.database, ws(fandri), cover, 'debts_savings');
  await home.join(dewi, fandri);
  await home.settle();
  const marks = (d: Device) => listCategoryNeeds(d.database, ws(d));
  /** What is waiting to go, or went, into the book's log from this phone: every op of every change-set. */
  const logged = async (d: Device) => {
    const rows = await d.database.db.values<[string]>(sql`SELECT entry_json FROM sync_outbox WHERE book_id = ${bookId}`);
    return rows.flatMap(([json]) => (JSON.parse(json) as { ops: { entity: string; fields?: Record<string, unknown> }[] }).ops);
  };
  return { home, fandri, dewi, bookId, ws, cover, dining, marks, logged };
}

/** A wall-clock step between two phones' writes, so which is later never comes down to a tie in the same millisecond. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const anyThirdMark = (ops: { entity: string; fields?: Record<string, unknown> }[]) => ops.some((op) => op.entity === 'category_need' && op.fields?.need === 'debts_savings');

describe('the hazard the wait is for', () => {
  /*
   * Before the sync refusal fix (2026-11-17) a phone's worker passed SQLite's message alone, apply did not read it as a
   * CHECK refusal, and the phone's pull stopped at the entry for good: what a phone on 0.5.3 still does. From the fix a
   * phone skips it like every other receiver — and a skipped mark is never taken in, even once the table can hold it.
   * Either way the mark must not reach such a table, which is what the wait is for.
   */
  it('a phone whose table refuses the mark skips it as a recorded refusal: the pull goes on, the mark is never there', async () => {
    // She says this build but still has the older table: the one way the mark could reach such a table.
    const h = await household({ dewi: BUILD });
    await asOlderTable(h.dewi);
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await h.fandri.engine.syncOnce(h.bookId);
    const cursor = async () => (await h.dewi.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${h.bookId}`))[0]![0];
    const before = await cursor();
    const result = await h.dewi.engine.syncOnce(h.bookId);
    // As on a phone: SQLite's words with no code, read from the message as the CHECK refusal it is.
    expect(result.skipped.map((skip) => [skip.entity, skip.error.split(':')[0]])).toEqual([['category_need', 'SQLITE_CONSTRAINT_CHECK']]);
    expect(result.skipped[0]!.error).toMatch(/CHECK constraint failed/);
    expect(await skipsOf(h.dewi.database)).toHaveLength(1);
    expect(await cursor()).toBeGreaterThan(before);
    expect((await h.marks(h.dewi))[h.cover]).toBeUndefined();
  });

  it('a phone stuck at the mark on a build before the fix takes it in once it updates: the same entry, tried again, nothing skipped', async () => {
    let shape: PhoneErrors | 'before-fix' = 'before-fix';
    const h = await household({ dewi: BUILD, dewiErrors: () => shape });
    await asOlderTable(h.dewi);
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await h.fandri.engine.syncOnce(h.bookId);
    const cursor = async () => (await h.dewi.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${h.bookId}`))[0]![0];
    const before = await cursor();
    // Stuck: each sync stops at the same entry.
    await expect(h.dewi.engine.syncOnce(h.bookId)).rejects.toThrow(/INSERT INTO category_needs/);
    await expect(h.dewi.engine.syncOnce(h.bookId)).rejects.toThrow(/INSERT INTO category_needs/);
    expect(await cursor()).toBe(before);

    // She updates to a build with the fix: its worker carries the code, and 0119 lets her table hold the mark.
    shape = 'carried';
    await update(h.dewi);
    const result = await h.dewi.engine.syncOnce(h.bookId);
    expect(result.skipped).toEqual([]);
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    expect(await cursor()).toBeGreaterThan(before);
    expect((await h.marks(h.dewi))[h.cover]).toBe('debts_savings');
  });
});

describe('a Debts & savings mark while the other phone is on 0.5.3', () => {
  it('stays on this phone and out of the log; her sync goes on and takes every other change', async () => {
    const h = await household();
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.dining, 'lifestyle');
    await h.home.settle();
    expect(await h.marks(h.fandri)).toEqual({ [h.cover]: 'debts_savings', [h.dining]: 'lifestyle' });
    expect(await h.marks(h.dewi)).toEqual({ [h.dining]: 'lifestyle' });
    expect(anyThirdMark(await h.logged(h.fandri))).toBe(false);
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // Nothing goes while she is behind, however often the repairs run.
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBeNull();

    // Her later change to another mark still arrives.
    await saveCategoryNeed(h.dewi.database, h.ws(h.dewi), h.dining, 'essential');
    await h.home.settle();
    expect((await h.marks(h.fandri))[h.dining]).toBe('essential');
  });

  it('once she updates, the mark goes at the clock it was made at, once, and both phones agree', async () => {
    const h = await household();
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await h.home.settle();
    expect(await phonesBehindThirdMark(h.fandri.database, h.ws(h.fandri))).toEqual(["Dewi's phone"]);
    await update(h.dewi);
    await h.home.settle();
    expect(await phonesBehindThirdMark(h.fandri.database, h.ws(h.fandri))).toEqual([]);
    expect(await phonesBehindThirdMark(h.fandri.database, h.fandri.ws)).toEqual([]);
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBe(1);
    await h.home.settle();
    expect(await h.marks(h.dewi)).toEqual({ [h.cover]: 'debts_savings' });
    expect(await projectBook(h.dewi.database, h.bookId)).toEqual(await projectBook(h.fandri.database, h.bookId));
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // One pass for her crossing: none after. From here a new mark goes at once.
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBeNull();
    await saveCategoryNeed(h.dewi.database, h.ws(h.dewi), h.dining, 'debts_savings');
    await h.home.settle();
    expect(await h.marks(h.fandri)).toEqual({ [h.cover]: 'debts_savings', [h.dining]: 'debts_savings' });
  });

  it('her later word wins over the held mark, whichever phone it is made on', async () => {
    const h = await household();
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await tick();
    // Later, on her 0.5.3 phone: Lifestyle. It reaches his phone and overturns the held mark.
    await saveCategoryNeed(h.dewi.database, h.ws(h.dewi), h.cover, 'lifestyle');
    await h.home.settle();
    expect(await h.marks(h.fandri)).toEqual({ [h.cover]: 'lifestyle' });
    await update(h.dewi);
    await h.home.settle();
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBe(0);
    await h.home.settle();
    for (const d of [h.fandri, h.dewi]) expect(await h.marks(d)).toEqual({ [h.cover]: 'lifestyle' });
  });

  it('an older word of hers arriving after the held mark does not overwrite it', async () => {
    const h = await household();
    // Her phone marks it first but is offline; his mark is the later one.
    await saveCategoryNeed(h.dewi.database, h.ws(h.dewi), h.cover, 'essential');
    await tick();
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await h.home.settle();
    expect(await h.marks(h.fandri)).toEqual({ [h.cover]: 'debts_savings' });
    expect(await h.marks(h.dewi)).toEqual({ [h.cover]: 'essential' });
    await update(h.dewi);
    await h.home.settle();
    await runSharedBookRepairs(h.fandri.database, h.bookId);
    await h.home.settle();
    for (const d of [h.fandri, h.dewi]) expect(await h.marks(d)).toEqual({ [h.cover]: 'debts_savings' });
  });

  it('a change made on her updated phone before his repair runs is not overturned by the resend', async () => {
    const h = await household();
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await h.home.settle();
    await update(h.dewi);
    await tick();
    await saveCategoryNeed(h.dewi.database, h.ws(h.dewi), h.cover, 'essential');
    await h.home.settle();
    await runSharedBookRepairs(h.fandri.database, h.bookId);
    await h.home.settle();
    for (const d of [h.fandri, h.dewi]) expect(await h.marks(d)).toEqual({ [h.cover]: 'essential' });
  });

  it('clearing a held mark goes as a clear, which her phone takes', async () => {
    const h = await household();
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'lifestyle');
    await h.home.settle();
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    await h.home.settle();
    expect(await h.marks(h.dewi)).toEqual({ [h.cover]: 'lifestyle' });
    await clearCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover);
    await h.home.settle();
    for (const d of [h.fandri, h.dewi]) expect(await h.marks(d)).toEqual({});
    expect(await skipsOf(h.dewi.database)).toEqual([]);
  });
});

describe('sharing or joining with a Debts & savings mark already set', () => {
  it('the seed holds it back from a phone on 0.5.3, whose join goes through', async () => {
    const h = await household({ markBeforeJoin: true });
    expect(await h.marks(h.dewi)).toEqual({});
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    expect(anyThirdMark(await h.logged(h.fandri))).toBe(false);
  });

  it('a phone that joins on this build has it after the repair', async () => {
    const h = await household({ dewi: BUILD, markBeforeJoin: true });
    // Shared before anyone else was in the book: nobody could be known to take it, so it waited.
    expect(await h.marks(h.dewi)).toEqual({});
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBe(1);
    await h.home.settle();
    expect(await h.marks(h.dewi)).toEqual({ [h.cover]: 'debts_savings' });
    expect(await projectBook(h.dewi.database, h.bookId)).toEqual(await projectBook(h.fandri.database, h.bookId));
  });
});

describe('a phone that leaves and comes back under the same device id', () => {
  it('gets every mark held while it was gone, though R7 had sent to it before', async () => {
    const h = await household({ dewi: BUILD });
    // R7's first pass for her: nothing held yet, but she is recorded as sent to.
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBe(0);
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBeNull();

    // Her phone leaves the book as his phone sees it: no other phone is in it, so a new mark waits.
    const gone = (at: string | null) => h.fandri.database.db.run(sql`UPDATE book_devices SET removed_at = ${at} WHERE book_id = ${h.bookId} AND device_id = ${h.dewi.deviceId}`);
    await gone('2026-11-16T09:00:00.000Z');
    await saveCategoryNeed(h.fandri.database, h.ws(h.fandri), h.cover, 'debts_savings');
    expect(anyThirdMark(await h.logged(h.fandri))).toBe(false);
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBeNull();

    // She comes back as the same device (a rejoin clears removed_at on her row): the held mark goes to her.
    await gone(null);
    expect((await runSharedBookRepairs(h.fandri.database, h.bookId)).thirdMarks).toBe(1);
    await h.home.settle();
    expect(await h.marks(h.dewi)).toEqual({ [h.cover]: 'debts_savings' });
    expect(await skipsOf(h.dewi.database)).toEqual([]);
  });
});
