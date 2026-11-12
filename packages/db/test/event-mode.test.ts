import type { RawCapture } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { setSourceAccount, sourceFor } from '../src/capture/sources';
import {
  confirmDraft,
  createAccount,
  createDraft,
  defaultUntil,
  deleteEvent,
  editDraft,
  eventModeCovers,
  eventModeState,
  keepEventModeOn,
  listAccounts,
  listDrafts,
  listTransactions,
  parseEventMode,
  readEventMode,
  saveEvent,
  startEventMode,
  writeEventMode,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const event = { id: 'e1', startsOn: '2026-11-12', endsOn: '2026-11-20', currency: 'TRY' };

describe('event mode, the model', () => {
  it('opens until the event ends, in its currency, from its first day or today', () => {
    expect(startEventMode({ workspaceId: 'w', event, baseCurrency: 'IDR', today: '2026-11-14' })).toEqual({
      workspaceId: 'w',
      eventId: 'e1',
      until: '2026-11-20',
      currency: 'TRY',
      from: '2026-11-12',
    });
    // Turned on before the trip starts: from today. No currency of its own: the base.
    expect(startEventMode({ workspaceId: 'w', event: { ...event, currency: null }, baseCurrency: 'IDR', today: '2026-11-10' })).toMatchObject({
      currency: 'IDR',
      from: '2026-11-10',
    });
  });

  it('defaults Until to a week from today when the event has no end, or ended already', () => {
    expect(defaultUntil('', '2026-11-14')).toBe('2026-11-20');
    expect(defaultUntil(null, '2026-11-28')).toBe('2026-12-04');
    expect(defaultUntil('2026-11-01', '2026-11-14')).toBe('2026-11-20');
    expect(defaultUntil('2026-11-14', '2026-11-14')).toBe('2026-11-14');
  });

  it('is on through Until and ended from the day after', () => {
    const mode = { until: '2026-11-20' };
    expect(eventModeState(mode, '2026-11-12')).toBe('on');
    expect(eventModeState(mode, '2026-11-20')).toBe('on');
    expect(eventModeState(mode, '2026-11-21')).toBe('ended');
  });

  it('covers the days from its start through Until only', () => {
    const mode = { from: '2026-11-12', until: '2026-11-20' };
    expect(eventModeCovers(mode, '2026-11-11')).toBe(false);
    expect(eventModeCovers(mode, '2026-11-12')).toBe(true);
    expect(eventModeCovers(mode, '2026-11-20')).toBe(true);
    expect(eventModeCovers(mode, '2026-11-21')).toBe(false);
  });

  it('Keep on adds one day each time, and never leaves it ended', () => {
    const mode = startEventMode({ workspaceId: 'w', event, baseCurrency: 'IDR', today: '2026-11-14' });
    const once = keepEventModeOn(mode, '2026-11-21');
    expect(once.until).toBe('2026-11-21');
    expect(keepEventModeOn(once, '2026-11-21').until).toBe('2026-11-22');
    // Seen three days late: on through today, not a day already gone.
    expect(keepEventModeOn(mode, '2026-11-24').until).toBe('2026-11-24');
  });

  it('reads nothing from a value that is not a mode', () => {
    expect(parseEventMode(null)).toBeNull();
    expect(parseEventMode('not json')).toBeNull();
    expect(parseEventMode(JSON.stringify({ eventId: 'e1' }))).toBeNull();
  });
});

describe('event mode, on this phone', () => {
  it('keeps one event at a time: turning it on for another replaces the first', async () => {
    current = await setupDb();
    const { database, ws } = current;
    await writeEventMode(database, startEventMode({ workspaceId: ws.workspaceId, event, baseCurrency: 'IDR', today: '2026-11-14' }));
    await writeEventMode(database, startEventMode({ workspaceId: ws.workspaceId, event: { ...event, id: 'e2' }, baseCurrency: 'IDR', today: '2026-11-14' }));
    expect((await readEventMode(database.db))?.eventId).toBe('e2');
    await writeEventMode(database, null);
    expect(await readEventMode(database.db)).toBeNull();
  });
});

describe('a capture while event mode is on', () => {
  const TODAY = '2026-11-14';
  const sms = (id: string, day: string): RawCapture => ({
    id,
    kind: 'notification',
    capturedAt: `${day}T14:02:00+03:00`,
    app: 'com.example.bank',
    title: 'Bank',
    body: 'Pembayaran Rp38.000 berhasil. Merchant: CORNER MARKET',
    lines: [],
    imageFile: null,
  });

  async function trip() {
    current = await setupDb();
    const { database, ws } = current;
    const bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const source = await sourceFor(database.db, sms('first', TODAY));
    await setSourceAccount(database, source.id, bank.id, ws.workspaceId);
    const eventId = await saveEvent(database, ws, { name: 'Lake trip', startsOn: '2026-11-12', endsOn: '2026-11-20', setId: null });
    await writeEventMode(database, startEventMode({ workspaceId: ws.workspaceId, event: { id: eventId, startsOn: '2026-11-12', endsOn: '2026-11-20' }, baseCurrency: 'IDR', today: TODAY }));
    const groceries = (await listAccounts(database, ws)).find((account) => account.systemKey === 'household.groceries')!;
    return { database, ws, eventId, groceries };
  }

  it('arrives with the event picked, and is recorded in it', async () => {
    const { database, ws, eventId, groceries } = await trip();
    await ingestCaptures(database, ws, [sms('in-range', '2026-11-14')], { today: TODAY });

    const [draft] = await listDrafts(database, ws);
    expect(draft!.eventId).toBe(eventId);
    await editDraft(database, ws, draft!.id, { categoryAccountId: groceries.id });
    const { transactionId } = await confirmDraft(database, ws, draft!.id);
    const [tx] = await listTransactions(database, ws, { id: transactionId });
    expect(tx!.eventId).toBe(eventId);
  });

  it('dated outside the range, arrives with no event', async () => {
    const { database, ws } = await trip();
    await ingestCaptures(database, ws, [sms('before', '2026-11-05')], { today: TODAY });
    expect((await listDrafts(database, ws))[0]!.eventId).toBeNull();
  });

  it('after Until has passed, arrives with no event', async () => {
    const { database, ws } = await trip();
    await ingestCaptures(database, ws, [sms('late', '2026-11-20')], { today: '2026-11-21' });
    expect((await listDrafts(database, ws))[0]!.eventId).toBeNull();
  });

  it('a form that takes the event off records it in none', async () => {
    const { database, ws, groceries } = await trip();
    await ingestCaptures(database, ws, [sms('taken-off', '2026-11-14')], { today: TODAY });
    const [draft] = await listDrafts(database, ws);
    await editDraft(database, ws, draft!.id, { categoryAccountId: groceries.id });
    const { transactionId } = await confirmDraft(database, ws, draft!.id, { extras: { eventId: null } });
    expect((await listTransactions(database, ws, { id: transactionId }))[0]!.eventId).toBeNull();
  });

  it('an event deleted before it is confirmed is no answer any more', async () => {
    const { database, ws, eventId, groceries } = await trip();
    await ingestCaptures(database, ws, [sms('deleted', '2026-11-14')], { today: TODAY });
    const [draft] = await listDrafts(database, ws);
    await deleteEvent(database, ws, eventId);
    // And no later capture is tagged for it either.
    await ingestCaptures(database, ws, [sms('after-delete', '2026-11-15')], { today: TODAY });
    expect((await listDrafts(database, ws)).find((d) => d.id !== draft!.id)!.eventId).toBeNull();
    await editDraft(database, ws, draft!.id, { categoryAccountId: groceries.id });
    const { transactionId } = await confirmDraft(database, ws, draft!.id);
    expect((await listTransactions(database, ws, { id: transactionId }))[0]!.eventId).toBeNull();
  });
});

describe('event mode fix round 1', () => {
  it('a draft whose event was archived reads no event, and a form naming that event records it in none (M2)', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((account) => account.systemKey === 'household.groceries')!;
    const eventId = await saveEvent(database, ws, { name: 'Lake trip', startsOn: '2026-11-12', endsOn: '2026-11-20', setId: null });
    const id = await createDraft(database, ws, {
      source: 'manual', occurredOn: '2026-11-14', description: 'Corner market', amountMinor: 38_000, currency: 'IDR',
      accountId: bank.id, categoryAccountId: groceries.id, eventId,
    });
    expect((await listDrafts(database, ws))[0]!.eventId).toBe(eventId);
    await deleteEvent(database, ws, eventId);
    expect((await listDrafts(database, ws))[0]!.eventId).toBeNull();
    // The form still holding the event it opened with: the archived event is no answer.
    const { transactionId } = await confirmDraft(database, ws, id, { extras: { eventId } });
    expect((await listTransactions(database, ws, { id: transactionId }))[0]!.eventId).toBeNull();
  });
});
