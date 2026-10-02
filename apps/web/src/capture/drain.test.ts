import type { RawCapture } from '@expanses/core';
import { createDatabase, createWorkspace, listDrafts, migrate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { drainCaptures, scanReceipt, type CaptureBridge } from './drain';

async function setup() {
  const executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { database, ws, close: () => executor.close() };
}

const notification: RawCapture = {
  id: 'note-09:30',
  kind: 'notification',
  capturedAt: '2026-09-30T09:30:00+07:00',
  app: 'com.example.bank',
  title: 'Bank',
  body: 'Pembayaran Rp38.000 berhasil. Merchant: TOKO KOPI',
  lines: [],
  imageFile: null,
};

/** A bridge that hands over what the test says, and has no camera of its own. */
const bridge = (captures: RawCapture[], photographed: RawCapture | null = null): CaptureBridge => ({
  drainCaptures: async () => ({ captures }),
  scanReceipt: async () => ({ capture: photographed }),
});

describe('emptying the phone into the queue', () => {
  it('turns what the phone hands over into drafts', async () => {
    const { database, ws, close } = await setup();
    try {
      const result = await drainCaptures(database, ws, bridge([notification]), '2026-09-30');

      expect(result).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      expect((await listDrafts(database, ws))[0]).toMatchObject({ description: 'TOKO KOPI', amountMinor: 38_000 });
    } finally {
      close();
    }
  });

  it('touches nothing when the phone hands over nothing', async () => {
    const { database, ws, close } = await setup();
    try {
      const result = await drainCaptures(database, ws, bridge([]), '2026-09-30');

      expect(result).toEqual({ drafts: 0, merged: 0, skipped: 0 });
      expect(await listDrafts(database, ws)).toEqual([]);
    } finally {
      close();
    }
  });
});

describe('a receipt photographed in the app', () => {
  it('joins the queue the way any capture does', async () => {
    const { database, ws, close } = await setup();
    try {
      const result = await scanReceipt(database, ws, bridge([], { ...notification, id: 'photo-1', kind: 'photo' }), '2026-09-30');

      expect(result).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      expect((await listDrafts(database, ws))[0]).toMatchObject({ source: 'photo', amountMinor: 38_000 });
    } finally {
      close();
    }
  });

  it('changes nothing when the camera was closed without a picture', async () => {
    const { database, ws, close } = await setup();
    try {
      expect(await scanReceipt(database, ws, bridge([], null), '2026-09-30')).toEqual({ drafts: 0, merged: 0, skipped: 0 });
      expect(await listDrafts(database, ws)).toEqual([]);
    } finally {
      close();
    }
  });
});
