import type { CaptureLine, RawCapture, Template } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { learnFromCorrection } from '../src/capture/learn';
import { listSources } from '../src/capture/sources';
import { listDrafts } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const line = (text: string, y: number, height = 0.03): CaptureLine => ({ text, box: [0.1, y, 0.6, height], height });

/** One screen of a wallet app, with the figure the owner paid this time. */
const screen = (figure: string, name = 'TOKO KOPI', over: Partial<RawCapture> = {}): RawCapture => ({
  id: `shot-${figure}`,
  kind: 'screen',
  capturedAt: '2026-09-30T09:00:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: [line('Pay wallet', 0.02), line('Transaksi Berhasil', 0.06), line(`Total Rp${figure}`, 0.5, 0.04), line(`Merchant ${name}`, 0.6), line('Biaya Rp2.000', 0.7)],
  imageFile: `captures/${figure}.png`,
  ...over,
});

/** A notification: words, no lines, nothing to anchor. */
const notice = (body: string): RawCapture => ({
  id: `note-${body.slice(0, 6)}`,
  kind: 'notification',
  capturedAt: '2026-09-30T09:00:00+07:00',
  app: 'com.example.pay',
  title: 'Pay',
  body,
  lines: [],
  imageFile: null,
});

async function learned(field: 'amount' | 'name' | 'date', value: string, first: RawCapture) {
  current = await setupDb();
  const { database, ws } = current;
  await ingestCaptures(database, ws, [first], { today: '2026-09-30' });
  const [draft] = await listDrafts(database, ws);
  const ok = await learnFromCorrection(database, draft!.id, field, value);
  const [source] = await listSources(database);
  return { database, ws, draft: draft!, ok, template: source?.template ?? null, sourceId: source!.id };
}

describe('learning where a field was', () => {
  it('anchors a corrected amount to its label, and reads the next screen from there', async () => {
    const { database, ws, ok, template, sourceId } = await learned('amount', 'Rp38.000', screen('38.000'));

    expect(ok).toBe(true);
    expect(template).toEqual<Template>({ amount: { label: 'Total', region: [0.1, 0.5, 0.6, 0.04] } });

    // The next screen of the same app prints another figure, a little differently, and is read from the label.
    await ingestCaptures(database, ws, [{ ...screen('52.000'), id: 'shot-next' }], { today: '2026-09-30' });
    const drafts = await listDrafts(database, ws);
    const next = drafts.find((candidate) => candidate.captureIds.includes('shot-next'))!;
    expect(next).toMatchObject({ amountMinor: 5_200_000, confidence: 95, sourceId });
  });

  it('takes a corrected figure the way the owner types it', async () => {
    const { ok, template } = await learned('amount', '38000', screen('38.000'));

    expect(ok).toBe(true);
    expect(template).toMatchObject({ amount: { label: 'Total' } });
  });

  it('anchors a corrected name to the line it sits on', async () => {
    const { ok, template } = await learned('name', 'TOKO KOPI', screen('38.000'));

    expect(ok).toBe(true);
    expect(template).toMatchObject({ name: { label: 'Merchant', region: [0.1, 0.6, 0.6, 0.03] } });
  });

  it('learns nothing from a notification, which has no lines to point at', async () => {
    const { ok, template } = await learned('amount', '38000', notice('Pembayaran Rp38.000 berhasil'));

    expect(ok).toBe(false);
    expect(template).toBeNull();
  });

  it('learns nothing from a value the capture never printed', async () => {
    const { ok } = await learned('amount', '999.000', screen('38.000'));

    expect(ok).toBe(false);
  });

  it('replaces what it learned about a field when it is corrected again', async () => {
    current = await setupDb();
    const { database, ws } = current;
    await ingestCaptures(database, ws, [screen('38.000')], { today: '2026-09-30' });
    const [draft] = await listDrafts(database, ws);

    expect(await learnFromCorrection(database, draft!.id, 'amount', 'Rp38.000')).toBe(true);
    // The owner says the amount is the other figure: the field keeps one place, and this is now it.
    expect(await learnFromCorrection(database, draft!.id, 'amount', 'Rp2.000')).toBe(true);

    const [source] = await listSources(database);
    expect(source?.template).toMatchObject({ amount: { label: 'Biaya', region: [0.1, 0.7, 0.6, 0.03] } });
  });
});
