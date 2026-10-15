import type { RawCapture } from '@expanses/core';
import { createDatabase, createWorkspace, listDrafts, migrate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { drainCaptures, drainNow, lastDrain, scanReceipt, type CaptureBridge } from './drain';
import { reportLine } from '../features/capture/CaptureSettingsPage';

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

/** A bridge that hands over what the test says, has no camera of its own, and writes down what it was told. */
const bridge = (captures: RawCapture[], photographed: RawCapture | null = null) => {
  const acked: string[][] = [];
  const deleted: string[] = [];
  const stand: CaptureBridge = {
    drainCaptures: async () => ({ captures }),
    ackCaptures: async ({ ids }) => {
      acked.push(ids);
    },
    scanReceipt: async () => ({ capture: photographed }),
    deleteCaptureImage: async ({ file }) => {
      deleted.push(file);
    },
  };
  return Object.assign(stand, { acked, deleted });
};

const counts = (result: { drafts: number; merged: number; skipped: number }) => ({
  drafts: result.drafts,
  merged: result.merged,
  skipped: result.skipped,
});

const offer: RawCapture = {
  ...notification,
  id: 'offer-1',
  kind: 'screen',
  body: null,
  title: null,
  lines: [{ text: 'Dapatkan voucher diskon 50% untuk transaksi berikutnya!', box: [0.1, 0.1, 0.8, 0.05], height: 0.05 }],
  imageFile: 'captures/offer-1.jpg',
};

describe('emptying the phone into the queue', () => {
  it('turns what the phone hands over into drafts', async () => {
    const { database, ws, close } = await setup();
    try {
      const result = await drainCaptures(database, ws, bridge([notification]), '2026-09-30');

      expect(counts(result)).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      expect((await listDrafts(database, ws))[0]).toMatchObject({ description: 'TOKO KOPI', amountMinor: 38_000 });
    } finally {
      close();
    }
  });

  it('lets the phone drop the captures only after they are stored', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([notification]);
      await drainCaptures(database, ws, phone, '2026-09-30');

      expect(phone.acked).toEqual([['note-09:30']]);
    } finally {
      close();
    }
  });

  it('still reports what it stored when the phone fails to let the captures go', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([notification]);
      phone.ackCaptures = async () => {
        throw new Error('bridge gone');
      };
      // The drafts are written; the next drain hands the captures over again and the queue takes each one once.
      expect(counts(await drainCaptures(database, ws, phone, '2026-09-30'))).toEqual({ drafts: 1, merged: 0, skipped: 0 });
    } finally {
      close();
    }
  });

  it('keeps the captures on the phone when storing them fails', async () => {
    const executor = createNodeExecutor();
    const database = createDatabase(executor);
    try {
      // Never migrated: the write fails, as a drain cut short would.
      const phone = bridge([notification]);
      const ws = { workspaceId: 'nowhere' } as unknown as Parameters<typeof drainCaptures>[1];

      await expect(drainCaptures(database, ws, phone, '2026-09-30')).rejects.toThrow();
      expect(phone.acked).toEqual([]);
      expect(phone.deleted).toEqual([]);
    } finally {
      executor.close();
    }
  });

  it('takes a capture handed over twice (killed before the ack) once, and keeps its picture', async () => {
    const { database, ws, close } = await setup();
    try {
      const pictured = { ...notification, id: 'shot-1', kind: 'screen' as const, imageFile: 'captures/shot-1.jpg' };
      const phone = bridge([pictured]);
      await drainCaptures(database, ws, phone, '2026-09-30');
      await drainCaptures(database, ws, phone, '2026-09-30');

      expect(await listDrafts(database, ws)).toHaveLength(1);
      expect(phone.acked).toEqual([['shot-1'], ['shot-1']]);
      expect(phone.deleted).not.toContain('captures/shot-1.jpg');
    } finally {
      close();
    }
  });

  it('keeps the picture of a skipped capture for its week, then deletes it', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([offer]);
      const result = await drainCaptures(database, ws, phone, '2026-09-30');

      expect(result.skipped).toBe(1);
      expect(phone.deleted).not.toContain('captures/offer-1.jpg');

      // A later drain, long after the week, finds nothing new and still sweeps what is left.
      const later = bridge([]);
      await drainCaptures(database, ws, later, '2099-01-01');
      expect(later.deleted).toContain('captures/offer-1.jpg');
    } finally {
      close();
    }
  });

  it('touches nothing when the phone hands over nothing', async () => {
    const { database, ws, close } = await setup();
    try {
      const result = await drainCaptures(database, ws, bridge([]), '2026-09-30');

      expect(counts(result)).toEqual({ drafts: 0, merged: 0, skipped: 0 });
      expect(await listDrafts(database, ws)).toEqual([]);
    } finally {
      close();
    }
  });
});

describe('the last drain, as Settings → Capture shows it', () => {
  it('reports what was handed over and what came of it', async () => {
    const { database, ws, close } = await setup();
    try {
      await drainNow(database, ws, bridge([notification]));

      expect(lastDrain()).toMatchObject({ found: 1, error: null, result: { drafts: 1, merged: 0, skipped: 0 } });
      expect(reportLine(lastDrain())).toMatch(/1 handed over → 1 new, 0 merged, 0 skipped$/);
    } finally {
      close();
    }
  });

  it('keeps the error a quiet drain would swallow, with how many were handed over', async () => {
    const executor = createNodeExecutor();
    const database = createDatabase(executor);
    try {
      const ws = { workspaceId: 'nowhere' } as unknown as Parameters<typeof drainCaptures>[1];

      await expect(drainNow(database, ws, bridge([notification]))).rejects.toThrow();
      expect(lastDrain()).toMatchObject({ found: 1, result: null });
      expect(lastDrain()?.error).toBeTruthy();
      expect(reportLine(lastDrain())).toMatch(/failed with 1 handed over: /);
    } finally {
      executor.close();
    }
  });

  it('says when the phone could not hand anything over at all', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([]);
      phone.drainCaptures = async () => {
        throw new Error('The holding area could not be read');
      };

      await expect(drainNow(database, ws, phone)).rejects.toThrow();
      expect(reportLine(lastDrain())).toMatch(/failed: The holding area could not be read$/);
    } finally {
      close();
    }
  });

  it('runs one drain at a time, each with its own outcome', async () => {
    const { database, ws, close } = await setup();
    try {
      const [first, second] = await Promise.all([
        drainNow(database, ws, bridge([notification])),
        drainNow(database, ws, bridge([notification])),
      ]);

      // The second hand-over of the same capture is taken once: it finds the first drain's write.
      expect(counts(first)).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      expect(counts(second)).toEqual({ drafts: 0, merged: 0, skipped: 0 });
    } finally {
      close();
    }
  });

  it('reads as not checked before any drain', () => {
    expect(reportLine(null)).toBe('Not checked since the app opened.');
  });
});

describe('a receipt photographed in the app', () => {
  it('joins the queue the way any capture does', async () => {
    const { database, ws, close } = await setup();
    try {
      const result = await scanReceipt(database, ws, bridge([], { ...notification, id: 'photo-1', kind: 'photo' }), '2026-09-30');

      expect(counts(result)).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      expect((await listDrafts(database, ws))[0]).toMatchObject({ source: 'photo', amountMinor: 38_000 });
    } finally {
      close();
    }
  });

  it('has nothing to acknowledge: the photo never waited in the holding area', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([], { ...notification, id: 'photo-2', kind: 'photo', imageFile: 'captures/photo-2.jpg' });
      await scanReceipt(database, ws, phone, '2026-09-30');

      expect(phone.acked).toEqual([]);
      expect(phone.deleted).not.toContain('captures/photo-2.jpg');
    } finally {
      close();
    }
  });

  it('changes nothing when the camera was closed without a picture', async () => {
    const { database, ws, close } = await setup();
    try {
      expect(counts(await scanReceipt(database, ws, bridge([], null), '2026-09-30'))).toEqual({ drafts: 0, merged: 0, skipped: 0 });
      expect(await listDrafts(database, ws)).toEqual([]);
    } finally {
      close();
    }
  });
});
