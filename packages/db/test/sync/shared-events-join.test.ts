import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listSharedBooks, recordSharedExpense, voidSharedExpense } from '../../src/index';
import type { Device } from './household';
import { meetsVersion, SHARED_EVENTS_MIN_APP_VERSION } from '../../src/sync/events/version';
import { Trip } from './trip';

/*
 * An event's own relay book (shared events §3, §6, §7): Rina shares "Coast week" with Budi as a name; Andi joins with
 * his own name; Budi installs the app and claims his. Each step is the real invite, claim and pull.
 */

/** The event's people on one phone: each name, and whether it has the app (1) or not (0). */
const people = (d: Device, bookId: string) =>
  d.database.db.values<[string, number]>(sql`SELECT name, member_id IS NOT NULL FROM event_people WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY name`);

describe('sharing and joining an event', () => {
  it('Andi joins as himself and Budi claims his name; every phone holds the same people, its own event and trip balance', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    const budi = await trip.device('Budi');
    const bookId = await trip.share(rina, ['Budi']);
    await trip.join(andi, rina);
    await trip.join(budi, andi, 'Budi'); // any member invites: every member owns the event's book
    await trip.settle();
    for (const d of [rina, andi, budi]) {
      expect(await people(d, bookId)).toEqual([['Andi', 1], ['Budi', 1], ['Rina', 1]]);
      const [event] = await d.database.db.values<[string, string]>(sql`SELECT e.name, a.currency FROM event_books b JOIN events e ON e.id = b.event_id JOIN accounts a ON a.id = b.balance_account_id WHERE b.book_id = ${bookId}`);
      expect(event).toEqual(['Coast week', 'TRY']);
      expect(await d.database.db.values(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${bookId}`)).toEqual([]);
    }
    // Budi's member is his person (R1).
    const [budiPerson] = await budi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
    expect(await rina.database.db.values(sql`SELECT name FROM event_people WHERE book_id = ${bookId} AND id = ${budiPerson![0]}`)).toEqual([['Budi']]);
    expect((await listSharedBooks(rina.database)).find((b) => b.bookId === bookId)?.kind).toBe('event');
  });

  it('seals the people into the preview, and a currency an older build refuses before it claims anything (R10)', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    await trip.share(rina, ['Budi']);
    const { code } = await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' });
    const preview = await andi.engine.previewInvite(code);
    expect(preview.baseCurrency).toBe('XXX');
    expect(preview.event).toMatchObject({ name: 'Coast week', currency: 'TRY', minAppVersion: '0.4.0' });
    expect(preview.event!.people.map((p) => [p.name, p.claimed])).toEqual([['Budi', false], ['Rina', true]]);
    await expect(andi.engine.joinBook(code, { ws: andi.ws, memberName: 'Andi', deviceName: 'phone' })).rejects.toMatchObject({ code: 'CURRENCY' });
    expect((await andi.engine.previewInvite(code)).claimed).toBe(false);
  });

  it('refuses a build below the minimum before claiming', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const old = await trip.device('Old', '0.3.0');
    await trip.share(rina);
    const { code } = await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' });
    await expect(old.engine.joinEvent(code, { ws: old.ws, personId: null, name: 'Old', deviceName: 'phone' })).rejects.toMatchObject({ code: 'APP_OUTDATED' });
    expect((await old.engine.previewInvite(code)).claimed).toBe(false);
  });

  it('a name is claimed once: of two phones claiming Budi on invites made together, the second is refused and leaves nothing behind', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const budi = await trip.device('Budi');
    const impostor = await trip.device('Other');
    await trip.share(rina, ['Budi']);
    const first = (await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' })).code;
    const second = (await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' })).code;
    await trip.join(budi, rina, 'Budi', first);
    await expect(trip.join(impostor, rina, 'Budi', second)).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    expect(await impostor.database.db.values(sql`SELECT 1 FROM event_books`)).toEqual([]);
    expect(await impostor.database.db.values(sql`SELECT 1 FROM shared_books`)).toEqual([]);
    await trip.settle([rina, budi]);
    expect(await people(rina, trip.bookId)).toEqual([['Budi', 1], ['Rina', 1]]);
  });
});

describe('leaving and removing (D9)', () => {
  it('Andi cannot leave while he owes; at zero he leaves, his own books keep the event, and Rina’s phone rotates the key', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const [rinaPerson] = await rina.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const dinner = await recordSharedExpense(rina.database, rina.ws, trip.eventOf(rina), {
      occurredOn: '2026-10-06', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: rinaPerson![0],
      paidFrom: { accountId: rina.bank, chargedMinor: 336_000 }, split: { mode: 'equal', people: [rinaPerson![0], andiPerson![0]] }, categoryId: null, note: 'Dinner',
    });
    await trip.settle([rina, andi]);
    await expect(andi.engine.leaveEvent(trip.bookId)).rejects.toMatchObject({ code: 'NOT_SETTLED', message: expect.stringContaining('Andi') });
    await voidSharedExpense(rina.database, rina.ws, trip.eventOf(rina), dinner);
    await trip.settle([rina, andi]);
    await andi.engine.leaveEvent(trip.bookId);
    await trip.settle([rina]);
    expect(await andi.database.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([['unshared']]);
    expect(await andi.database.db.values(sql`SELECT 1 FROM event_books WHERE book_id = ${trip.bookId}`)).toEqual([[1]]);
    expect(await rina.database.db.values(sql`SELECT epoch FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([[2]]);
  });

  it('Rina removes Andi, who has the app, at zero and in no record: his devices go and his name is marked removed', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    await rina.engine.removeEventMember(rina.ws, trip.eventOf(rina), andiPerson![0]);
    await trip.settle([rina, andi]);
    expect(await rina.database.db.values(sql`SELECT removed_at IS NOT NULL FROM event_people WHERE book_id = ${trip.bookId} AND id = ${andiPerson![0]}`)).toEqual([[1]]);
    expect(await andi.database.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([['unshared']]);
  });

  it('a person’s new phone joins as the same person once the lost one is removed (§7 Lost phone, C2)', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    const andiNew = await trip.device('Andi');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    // While Andi's phone is still in, nobody else makes an invite as Andi (C2).
    await expect(rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina', forPersonId: andiPerson![0] })).rejects.toMatchObject({
      code: 'STILL_HAS_PHONE',
      message: 'Andi still has a phone in this event. Remove Andi’s old phone first, or Andi invites the new one.',
    });
    // The lost phone removed first, which every phone sees in the log; then Rina's invite for Andi's new phone.
    await rina.engine.removeDevice(trip.bookId, andi.deviceId);
    await trip.settle([rina]);
    const { code } = await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina', forPersonId: andiPerson![0] });
    await andiNew.engine.joinEvent(code, { ws: andiNew.ws, personId: null, name: 'Andi', deviceName: 'new phone' });
    await trip.settle([rina, andiNew]);
    expect(await andiNew.database.db.values(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([[andiPerson![0]]]);
    expect(await people(andiNew, trip.bookId)).toEqual([['Andi', 1], ['Rina', 1]]);
  });

  it('Andi links a second phone of his own on his own invite while the first is still in (C2)', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    const tablet = await trip.device('Andi');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const { code } = await andi.engine.createEventInvite(trip.bookId, { inviterName: 'Andi', forPersonId: andiPerson![0] });
    await tablet.engine.joinEvent(code, { ws: tablet.ws, personId: null, name: 'Andi', deviceName: 'tablet' });
    await trip.settle([rina, andi, tablet]);
    for (const d of [rina, andi, tablet]) {
      expect(await d.database.db.values(sql`SELECT member_id FROM sync_authority_devices WHERE book_id = ${trip.bookId} AND device_id = ${tablet.deviceId} AND removed_seq IS NULL`)).toEqual([[andiPerson![0]]]);
    }
  });

  it('a phone linked as Andi on an invite Budi signed, while Andi’s phone is in, is refused on every phone (C2)', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    const budi = await trip.device('Budi');
    const impostor = await trip.device('Other');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.join(budi, rina);
    await trip.settle([rina, andi, budi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    // Past the screen's own refusal: an invite made straight on the engine, as a modified build would.
    const { code } = await budi.engine.createInvite(trip.bookId, { inviterName: 'Budi', sameMember: true, memberId: andiPerson![0] });
    await expect(impostor.engine.joinEvent(code, { ws: impostor.ws, personId: null, name: 'Andi', deviceName: 'phone' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    await trip.settle([rina, andi, budi]);
    for (const d of [rina, andi, budi]) {
      expect(await d.database.db.values(sql`SELECT 1 FROM sync_authority_devices WHERE book_id = ${trip.bookId} AND device_id = ${impostor.deviceId}`)).toEqual([]);
      expect(await d.database.db.values(sql`SELECT error FROM sync_skipped WHERE book_id = ${trip.bookId} AND entity = 'device' AND id = ${impostor.deviceId}`)).toEqual([
        ['AUTHORITY: introduction as a member who still has a phone in, on an invite another member signed'],
      ]);
    }
  });
});

describe('the app version a joiner needs (R10)', () => {
  it('compares release by release, and an unknown version never meets it', () => {
    expect(meetsVersion('0.4.0', SHARED_EVENTS_MIN_APP_VERSION)).toBe(true);
    expect(meetsVersion('0.10.0', '0.4.0')).toBe(true);
    expect(meetsVersion('1.0', '0.4.0')).toBe(true);
    expect(meetsVersion('0.3.9', '0.4.0')).toBe(false);
    expect(meetsVersion('0.4', '0.4.0')).toBe(true);
    expect(meetsVersion(null, '0.4.0')).toBe(false);
  });
});
