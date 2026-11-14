import type { SplitInput } from '@expanses/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  editSharedExpense,
  eventBalanceRows,
  finishSharedEvent,
  ownerScope,
  recordSharedExpense,
  runSharedBookRepairs,
  setSharedEventSwitches,
  sharedEventView,
  type SharedEventView,
} from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { skipsOf, type Device } from './household';
import { Trip } from './trip';

/*
 * A shared trip's Split costs and Plan switches (0116; owner, 14 Nov 2026), on two phones and one relay: Sari and
 * Dimas, with Wulan as a name without the app. Figures in rupiah, invented.
 */

const BUILD = '0.5.3';

async function seaside(options: { splitCosts?: boolean; names?: string[]; dimasVersion?: string } = {}) {
  const trip = new Trip();
  const sari = await trip.device('Sari', BUILD);
  const dimas = await trip.device('Dimas', options.dimasVersion ?? BUILD);
  await trip.share(sari, options.names ?? ['Wulan'], 'IDR', options.splitCosts === undefined ? {} : { splitCosts: options.splitCosts });
  await trip.join(dimas, sari);
  await trip.settle([sari, dimas]);
  const view = async (d: Device): Promise<SharedEventView> => (await sharedEventView(d.database, ownerScope(d.ws), trip.eventOf(d)))!;
  const me = async (d: Device) => (await view(d)).me;
  const named = async (d: Device, name: string) => (await view(d)).people.find((p) => p.name === name)!.personId;
  const settle = () => trip.settle([sari, dimas]);
  const switches = (d: Device, to: { splitCosts?: boolean; plan?: boolean }) => setSharedEventSwitches(d.database, ownerScope(d.ws), trip.eventOf(d), to);
  /** What `payer` paid from their own bank, split as given (everyone, by default). */
  const spend = async (d: Device, amountMinor: number, note: string, split?: SplitInput) => {
    const everyone = (await view(d)).people.map((p) => p.personId);
    return recordSharedExpense(d.database, ownerScope(d.ws), trip.eventOf(d), {
      occurredOn: '2026-10-06', amountMinor, currency: 'IDR', rateToEvent: '1', payerPersonId: await me(d),
      paidFrom: { accountId: d.bank, chargedMinor: null }, split: split ?? { mode: 'equal', people: everyone }, categoryId: null, note,
    });
  };
  const balancesOf = async (d: Device) => Object.fromEntries((await view(d)).people.map((p) => [p.name, p.balanceMinor]));
  return { trip, sari, dimas, view, me, named, settle, switches, spend, balancesOf };
}

describe('Split costs and Plan, one value on both phones', () => {
  it('an event shared before the switches splits costs and has a plan', async () => {
    const s = await seaside();
    for (const d of [s.sari, s.dimas]) expect(await s.view(d)).toMatchObject({ splitCosts: true, planOff: false });
  });

  it('turned off on one phone reaches the other, and on again from that one comes back', async () => {
    const s = await seaside();
    await s.switches(s.sari, { splitCosts: false });
    await s.settle();
    expect(await s.view(s.dimas)).toMatchObject({ splitCosts: false, planOff: false });
    await s.switches(s.dimas, { splitCosts: true, plan: false });
    await s.settle();
    for (const d of [s.sari, s.dimas]) expect(await s.view(d)).toMatchObject({ splitCosts: true, planOff: true });
    expect(await skipsOf(s.dimas.database)).toEqual([]);
  });

  it('two phones changing it at once agree on the later change, each switch on its own', async () => {
    const s = await seaside();
    await s.switches(s.sari, { splitCosts: false });
    await s.switches(s.dimas, { plan: false });
    await s.switches(s.dimas, { splitCosts: true });
    await s.settle();
    const sari = await s.view(s.sari);
    const dimas = await s.view(s.dimas);
    expect({ splitCosts: sari.splitCosts, planOff: sari.planOff }).toEqual({ splitCosts: dimas.splitCosts, planOff: dimas.planOff });
    expect(sari.planOff).toBe(true);
  });

  it('a Done trip refuses a switch until it is reopened', async () => {
    const s = await seaside();
    await finishSharedEvent(s.sari.database, ownerScope(s.sari.ws), s.trip.eventOf(s.sari), true);
    await expect(s.switches(s.sari, { splitCosts: false })).rejects.toThrow(/done/);
  });
});

describe('Split costs when the event is shared', () => {
  it('shared as one pot, both phones start with it off', async () => {
    const s = await seaside({ splitCosts: false, names: [] });
    for (const d of [s.sari, s.dimas]) expect((await s.view(d)).splitCosts).toBe(false);
  });

  it('the event’s own Plan switch comes with it', async () => {
    const trip = new Trip();
    const sari = await trip.device('Sari', BUILD);
    const { saveEvent, setEventPlanOff, eventBookOfEventTx } = await import('../../src/index');
    const eventId = await saveEvent(sari.database, ownerScope(sari.ws), { name: 'Hill walk', startsOn: '2026-10-05', endsOn: '2026-10-06' });
    await setEventPlanOff(sari.database, ownerScope(sari.ws), eventId, true);
    await sari.engine.shareEvent(sari.ws, { eventId, currency: 'IDR', personName: 'Sari', deviceName: 'Sari phone', names: [] });
    expect(await eventBookOfEventTx(sari.database.db, eventId)).toMatchObject({ planOff: true, splitCosts: true });
  });
});

describe('one pot: the money', () => {
  it('spending recorded while off is all its payer’s, whatever split was sent: every balance stays at zero', async () => {
    const s = await seaside({ splitCosts: false });
    await s.spend(s.sari, 840_000, 'Guesthouse');
    await s.spend(s.dimas, 126_000, 'Ferry');
    await s.settle();
    for (const d of [s.sari, s.dimas]) {
      const v = await s.view(d);
      expect(v.expenses.map((e) => e.split)).toEqual([
        { mode: 'equal', people: [await s.named(d, 'Sari')] },
        { mode: 'equal', people: [await s.named(d, 'Dimas')] },
      ]);
      expect(await s.balancesOf(d)).toEqual({ Sari: 0, Dimas: 0, Wulan: 0 });
      expect(v.payments).toEqual([]);
      expect(v.spentMinor).toBe(966_000);
    }
    // Each phone's own books carry the whole of what its person paid.
    expect((await s.view(s.sari)).myShareMinor).toBe(840_000);
    expect((await s.view(s.dimas)).myShareMinor).toBe(126_000);
  });

  it('splits recorded before it was switched off are kept, hidden from Debts, and back when it is on again', async () => {
    const s = await seaside();
    await s.spend(s.sari, 900_000, 'Guesthouse');
    await s.settle();
    const owed = { Sari: 600_000, Dimas: -300_000, Wulan: -300_000 };
    expect(await s.balancesOf(s.dimas)).toEqual(owed);
    expect(await eventBalanceRows(s.dimas.database, ownerScope(s.dimas.ws))).toHaveLength(1);

    await s.switches(s.dimas, { splitCosts: false });
    await s.settle();
    for (const d of [s.sari, s.dimas]) {
      expect((await s.view(d)).expenses[0]!.split.mode).toBe('equal');
      expect((await s.view(d)).expenses[0]!.split).toMatchObject({ people: expect.arrayContaining([await s.named(d, 'Wulan')]) });
      expect(await eventBalanceRows(d.database, ownerScope(d.ws))).toEqual([]);
    }

    await s.switches(s.sari, { splitCosts: true });
    await s.settle();
    expect(await s.balancesOf(s.dimas)).toEqual(owed);
    expect(await eventBalanceRows(s.dimas.database, ownerScope(s.dimas.ws))).toHaveLength(1);
  });

  it('an edit while off keeps the split it had; an amounts split the new figure no longer fits becomes the payer’s', async () => {
    const s = await seaside();
    const [sari, dimas] = [await s.me(s.sari), await s.named(s.sari, 'Dimas')];
    const equal = await s.spend(s.sari, 300_000, 'Kayaks');
    const byAmount = await s.spend(s.sari, 500_000, 'Dinner', { mode: 'amounts', shares: [{ personId: sari, minor: 200_000 }, { personId: dimas, minor: 300_000 }] });
    await s.switches(s.sari, { splitCosts: false });
    const ws = ownerScope(s.sari.ws);
    await editSharedExpense(s.sari.database, ws, s.trip.eventOf(s.sari), equal, { amountMinor: 330_000, note: 'Kayaks and paddles' });
    await editSharedExpense(s.sari.database, ws, s.trip.eventOf(s.sari), byAmount, { note: 'Dinner by the bay' });
    let v = await s.view(s.sari);
    expect(v.expenses.find((e) => e.expenseId === equal)!.split).toEqual({ mode: 'equal', people: v.people.map((p) => p.personId) });
    expect(v.expenses.find((e) => e.expenseId === byAmount)!.split.mode).toBe('amounts');
    await editSharedExpense(s.sari.database, ws, s.trip.eventOf(s.sari), byAmount, { amountMinor: 520_000 });
    v = await s.view(s.sari);
    expect(v.expenses.find((e) => e.expenseId === byAmount)!.split).toEqual({ mode: 'equal', people: [sari] });
    await s.settle();
    expect(await s.balancesOf(s.dimas)).toEqual(await s.balancesOf(s.sari));
  });
});

/** What 0.5.2 holds after applying a switch: the field's clock and the log's account of it, no column, so splits show. */
async function asOldBuildHeldIt(d: Device) {
  await d.database.execScript('UPDATE shared_events SET split_off = 0, plan_off = 0');
}

/** Migration 0116 on that phone as it updates, its columns already there: the recovery and the clock drop alone. */
async function migrateTo0116(d: Device) {
  const text = readFileSync(fileURLToPath(new URL('../../migrations/0116_trip_split_costs.sql', import.meta.url)), 'utf8');
  await d.database.execScript(text.replace(/^ALTER TABLE .*$/gm, ''));
}

/** The phone now runs this build and says so on its next sync. */
function update(d: Device) {
  d.engine = new SyncEngine(d.database, d.transport, d.keys, undefined, { appVersion: BUILD, shareRecords: d.records });
}

const clocksOf = (d: Device) =>
  d.database.db.values<[string]>(sql`SELECT field FROM sync_field_clocks WHERE entity = 'shared_event' AND field IN ('splitOff', 'planOff') ORDER BY field`);

describe('one pot: a split nobody is in', () => {
  it('an edit of an expense whose split could not be read makes it the payer’s alone', async () => {
    const s = await seaside({ splitCosts: false });
    const id = await s.spend(s.sari, 210_000, 'Snorkels');
    // As a peer's unreadable split arrives (I2): nobody in it.
    await s.sari.database.execScript(`UPDATE event_expense_details SET split_mode = 'amounts', split_json = '[]' WHERE id = '${id}'`);
    expect((await s.view(s.sari)).expenses[0]!.unreadable).toBeTruthy();
    await editSharedExpense(s.sari.database, ownerScope(s.sari.ws), s.trip.eventOf(s.sari), id, { note: 'Snorkels and fins' });
    const v = await s.view(s.sari);
    expect(v.expenses[0]).toMatchObject({ split: { mode: 'equal', people: [v.me] }, unreadable: null, note: 'Snorkels and fins' });
  });
});

describe('a phone on an older build', () => {
  it('keeps one pot waiting while it is in the event; switching back on is allowed', async () => {
    const s = await seaside({ dimasVersion: '0.5.2' });
    expect((await s.view(s.sari)).phonesBehind).toEqual(["Dimas's phone"]);
    await expect(s.switches(s.sari, { splitCosts: false })).rejects.toThrow('Every phone in Coast week needs the latest version first.');
    // Plan has no such wait: an older build goes on showing the plan, and nothing is owed because of it.
    await s.switches(s.sari, { plan: false });
    const onePot = await seaside({ dimasVersion: '0.5.2', splitCosts: false });
    await onePot.switches(onePot.sari, { splitCosts: true });
    expect((await onePot.view(onePot.sari)).splitCosts).toBe(true);
  });

  it('once updated, finds the switches its older build saved with their clocks: right from its first open', async () => {
    const s = await seaside({ dimasVersion: '0.5.2', splitCosts: false });
    await s.switches(s.sari, { plan: false });
    await s.settle();
    await asOldBuildHeldIt(s.dimas);
    expect(await s.view(s.dimas)).toMatchObject({ splitCosts: true, planOff: false });

    await migrateTo0116(s.dimas);
    expect(await s.view(s.dimas)).toMatchObject({ splitCosts: false, planOff: true });
    expect(await clocksOf(s.dimas)).toEqual([['planOff'], ['splitOff']]);
    update(s.dimas);
    await s.settle();
    await runSharedBookRepairs(s.sari.database, s.trip.bookId);
    await s.settle();
    for (const d of [s.sari, s.dimas]) expect(await s.view(d)).toMatchObject({ splitCosts: false, planOff: true });
    expect(await skipsOf(s.dimas.database)).toEqual([]);
  });

  it('a switch whose saved clock is not the field’s is dropped, and the repair sends it again once he says his version', async () => {
    const s = await seaside({ dimasVersion: '0.5.2', splitCosts: false });
    await s.switches(s.sari, { plan: false });
    // Her phone's first pass is for itself, crossing to this build.
    await runSharedBookRepairs(s.sari.database, s.trip.bookId);
    await s.settle();
    await asOldBuildHeldIt(s.dimas);
    // The log's account no longer matches the clocks (a row the log kept another way): nothing can be recovered.
    await s.dimas.database.execScript("UPDATE settings SET value = json_set(value, '$.clocks.splitOff', 'x', '$.clocks.planOff', 'x') WHERE key LIKE 'shared-events.log.%|shared_event|%'");
    // While he is on 0.5.2 nothing more goes, however often her phone runs its repairs.
    expect((await runSharedBookRepairs(s.sari.database, s.trip.bookId)).tripSwitches).toBeNull();

    await migrateTo0116(s.dimas);
    expect(await s.view(s.dimas)).toMatchObject({ splitCosts: true, planOff: false });
    expect(await clocksOf(s.dimas)).toEqual([]);
    update(s.dimas);
    await s.settle();
    // His own pass has nothing to send: he holds no clock for either switch.
    expect((await runSharedBookRepairs(s.dimas.database, s.trip.bookId)).tripSwitches).toBe(0);
    expect((await runSharedBookRepairs(s.sari.database, s.trip.bookId)).tripSwitches).toBe(1);
    await s.settle();
    for (const d of [s.sari, s.dimas]) expect(await s.view(d)).toMatchObject({ splitCosts: false, planOff: true });
    expect(await skipsOf(s.dimas.database)).toEqual([]);
    // One pass for his crossing: none after.
    expect((await runSharedBookRepairs(s.sari.database, s.trip.bookId)).tripSwitches).toBeNull();
  });

  it('a resend never beats a later change made on the updated phone', async () => {
    const s = await seaside({ dimasVersion: '0.5.2', splitCosts: false });
    await s.settle();
    await asOldBuildHeldIt(s.dimas);
    await s.dimas.database.execScript("DELETE FROM settings WHERE key LIKE 'shared-events.log.%|shared_event|%'");
    await migrateTo0116(s.dimas);
    update(s.dimas);
    // He turns it off and on again before her repair has run: his change is the later one.
    await s.switches(s.dimas, { splitCosts: false });
    await s.switches(s.dimas, { splitCosts: true });
    await s.settle();
    await runSharedBookRepairs(s.sari.database, s.trip.bookId);
    await s.settle();
    for (const d of [s.sari, s.dimas]) expect((await s.view(d)).splitCosts).toBe(true);
  });
});

describe('the stored rows', () => {
  it('keeps the switches on the event row, 1 for off', async () => {
    const s = await seaside({ splitCosts: false });
    const [row] = await s.dimas.database.db.values<[number, number]>(sql`SELECT split_off, plan_off FROM shared_events WHERE book_id = ${s.trip.bookId}`);
    expect(row).toEqual([1, 0]);
  });
});
