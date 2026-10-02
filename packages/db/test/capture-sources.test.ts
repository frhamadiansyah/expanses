import type { CaptureLine, RawCapture } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { learnFromCorrection } from '../src/capture/learn';
import { deleteSource, listSources, resetSourceTemplate, setSourceAccount } from '../src/capture/sources';
import { createAccount, listDrafts } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** One line of a screenshot, with the place it sat. */
const line = (text: string, y: number, height = 0.03): CaptureLine => ({ text, box: [0.1, y, 0.6, height], height });

/** A screen of an app, caught twice: the same top band, a different figure. */
const screen = (figure: string, over: Partial<RawCapture> = {}): RawCapture => ({
  id: `shot-${figure}`,
  kind: 'screen',
  capturedAt: '2026-09-30T09:00:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: [line('Pay wallet', 0.02), line('Transaksi Berhasil', 0.06), line(`Total Rp${figure}`, 0.5, 0.04)],
  imageFile: `captures/${figure}.png`,
  ...over,
});

/** Another app's screen: different words up top, so a source of its own. */
const otherScreen = (figure: string): RawCapture => ({
  ...screen(figure),
  id: `other-${figure}`,
  lines: [line('Settings', 0.02), line('Notification preferences', 0.06), line(`Batas Rp${figure}`, 0.5, 0.04)],
});

/** A notification, as an app hands it over. */
const notice = (body: string, over: Partial<RawCapture> = {}): RawCapture => ({
  id: `note-${body.slice(0, 6)}`,
  kind: 'notification',
  capturedAt: '2026-09-30T09:00:00+07:00',
  app: 'com.example.pay',
  title: 'Pay',
  body,
  lines: [],
  imageFile: null,
  ...over,
});

const at = (time: string, over: Partial<RawCapture> = {}): RawCapture => ({ ...notice('Pembayaran Rp38.000 berhasil', over), capturedAt: time });

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const wallet = await createAccount(database, ws, { name: 'Pay wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
  return { database, ws, bank, wallet };
}

describe('where captures come from', () => {
  it('takes the app a notification arrived in as its source', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(database, ws, [at('2026-09-30T09:00:00+07:00'), at('2026-09-30T11:00:00+07:00', { id: 'note-second' })], { today: '2026-09-30' });

    const sources = await listSources(database);
    expect(sources).toHaveLength(1);
    // The app is the key, its own name is the label, and both captures were counted against it.
    expect(sources[0]).toMatchObject({ keyKind: 'app', key: 'com.example.pay', label: 'Pay', capturedCount: 2 });
  });

  it('takes two screenshots of one screen as one source, and another screen as its own', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(database, ws, [screen('38.000'), screen('52.000'), otherScreen('9.000')], { today: '2026-09-30' });

    const sources = await listSources(database);
    expect(sources).toHaveLength(2);
    const [pay, settings] = sources.sort((one, two) => one.label.localeCompare(two.label));
    // An image is recognised by its layout, and named after the first thing it says.
    expect(pay).toMatchObject({ keyKind: 'fingerprint', label: 'Pay wallet', capturedCount: 2 });
    expect(settings).toMatchObject({ keyKind: 'fingerprint', label: 'Settings', capturedCount: 1 });
  });

  it('starts a source knowing nothing about the owner', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(database, ws, [screen('38.000')], { today: '2026-09-30' });

    const [source] = await listSources(database);
    expect(source).toMatchObject({ accountId: null, workspaceId: null, template: null });
  });

  it('remembers the account the first answer named, and files the next capture there', async () => {
    const { database, ws, wallet } = await workspace();
    await ingestCaptures(database, ws, [screen('38.000')], { today: '2026-09-30' });
    const [source] = await listSources(database);

    await setSourceAccount(database, source!.id, wallet.id, ws.workspaceId);
    await ingestCaptures(database, ws, [screen('52.000')], { today: '2026-09-30' });

    expect((await listSources(database))[0]).toMatchObject({ accountId: wallet.id, workspaceId: ws.workspaceId });
    expect((await listDrafts(database, ws)).map((draft) => draft.accountId)).toEqual([null, wallet.id]);
  });

  it('can forget a layout without forgetting the account', async () => {
    const { database, ws, wallet } = await workspace();
    await ingestCaptures(database, ws, [screen('38.000')], { today: '2026-09-30' });
    const [source] = await listSources(database);
    await setSourceAccount(database, source!.id, wallet.id, ws.workspaceId);
    const [draft] = await listDrafts(database, ws);
    await learnFromCorrection(database, draft!.id, 'amount', 'Rp38.000');
    expect((await listSources(database))[0]?.template).toMatchObject({ amount: { label: 'Total' } });

    await resetSourceTemplate(database, source!.id);

    // What it learned about the screen is gone; whose it is is not.
    expect((await listSources(database))[0]).toMatchObject({ template: null, accountId: wallet.id });
  });

  it('forgets a source completely when it is deleted', async () => {
    const { database, ws } = await workspace();
    await ingestCaptures(database, ws, [screen('38.000')], { today: '2026-09-30' });
    const [source] = await listSources(database);

    await deleteSource(database, source!.id);

    expect(await listSources(database)).toEqual([]);
    // Nothing is remembered, so the next screen of that app asks which account it is again.
    await ingestCaptures(database, ws, [screen('52.000')], { today: '2026-09-30' });
    expect((await listSources(database))[0]).toMatchObject({ accountId: null, capturedCount: 1 });
  });
});

describe('a picture with nothing written at the top', () => {
  it('is one source however many of them arrive, not a new source each time', async () => {
    const { database, ws } = await workspace();
    // A receipt photographed from below the header: the top band holds no words, so the fingerprint is empty.
    const blank = (figure: string): RawCapture => ({
      ...screen(figure),
      id: `blank-${figure}`,
      kind: 'photo',
      lines: [line(`TOTAL Rp${figure}`, 0.5, 0.04)],
    });

    await ingestCaptures(database, ws, [blank('10.000'), blank('20.000'), blank('30.000')], { today: '2026-09-30' });

    expect(await listSources(database)).toHaveLength(1);
  });
});
