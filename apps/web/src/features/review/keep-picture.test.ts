import type { RawCapture } from '@expanses/core';
import { createDatabase, createWorkspace, listDrafts, migrate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { type CaptureBridge, drainCaptures, pickPhotos, scanReceipt } from '../../capture/drain';
import { isCameraPicture, keepsPicture } from './keep-picture';

/*
 * Which captured pictures stay with the transaction once recorded: the camera's, always; a picture already in Photos
 * (chosen, shared, or a screenshot the scanner read), never. Every figure and shop here is invented.
 */

async function setup() {
  const executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { database, ws, close: () => executor.close() };
}

const capture = (over: Partial<RawCapture>): RawCapture => ({
  id: 'c-1',
  kind: 'shared-image',
  capturedAt: '2026-09-30T09:30:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: [{ text: 'Total Rp41.500 TOKO SINAR PAGI', box: [0.1, 0.4, 0.8, 0.04], height: 0.04 }],
  imageFile: null,
  ...over,
});

/** A phone with one camera photo, one library pick, and a holding area — whichever the test asks for. */
const phone = (opts: { photographed?: RawCapture; picked?: RawCapture[]; waiting?: RawCapture[] }): CaptureBridge => ({
  drainCaptures: async () => ({ captures: opts.waiting ?? [] }),
  ackCaptures: async () => undefined,
  scanReceipt: async () => ({ capture: opts.photographed ?? null }),
  pickPhotos: async () => ({ captures: opts.picked ?? [] }),
  deleteCaptureImage: async () => undefined,
});

describe('the camera’s picture name', () => {
  it('is camera- before the id, in the capture folder', () => {
    expect(isCameraPicture('captures/camera-6F1C.jpg')).toBe(true);
    expect(isCameraPicture('captures/6F1C.jpg')).toBe(false);
    expect(isCameraPicture('captures/camera-')).toBe(false);
    // Only the file's own name counts, not a folder that happens to say camera.
    expect(isCameraPicture('camera-roll/6F1C.jpg')).toBe(false);
  });

  it('keeps nothing for a draft with no picture', () => {
    expect(keepsPicture({ imageFile: null })).toBe(false);
  });
});

describe('which captured pictures are kept once recorded', () => {
  it('keeps a receipt photographed with the app’s camera', async () => {
    const { database, ws, close } = await setup();
    try {
      await scanReceipt(database, ws, phone({ photographed: capture({ id: 'cam-1', kind: 'photo', imageFile: 'captures/camera-cam-1.jpg' }) }), '2026-09-30');
      const [draft] = await listDrafts(database, ws);
      expect(draft).toMatchObject({ source: 'photo', imageFile: 'captures/camera-cam-1.jpg' });
      expect(keepsPicture(draft!)).toBe(true);
    } finally {
      close();
    }
  });

  it('lets go of a picture chosen from Photos, though it is a photo draft as well', async () => {
    const { database, ws, close } = await setup();
    try {
      await pickPhotos(database, ws, phone({ picked: [capture({ id: 'lib-1', imageFile: 'captures/lib-1.jpg' })] }), '2026-09-30');
      const [draft] = await listDrafts(database, ws);
      expect(draft).toMatchObject({ source: 'photo', imageFile: 'captures/lib-1.jpg' });
      expect(keepsPicture(draft!)).toBe(false);
    } finally {
      close();
    }
  });

  it('lets go of a picture shared from another app', async () => {
    const { database, ws, close } = await setup();
    try {
      await drainCaptures(database, ws, phone({ waiting: [capture({ id: 'share-1', imageFile: 'captures/share-1.jpg' })] }), '2026-09-30');
      const [draft] = await listDrafts(database, ws);
      expect(draft).toMatchObject({ source: 'photo', imageFile: 'captures/share-1.jpg' });
      expect(keepsPicture(draft!)).toBe(false);
    } finally {
      close();
    }
  });

  it('lets go of a screenshot the screen scanner read', async () => {
    const { database, ws, close } = await setup();
    try {
      await drainCaptures(database, ws, phone({ waiting: [capture({ id: 'scr-1', kind: 'screen', imageFile: 'captures/scr-1.jpg' })] }), '2026-09-30');
      const [draft] = await listDrafts(database, ws);
      expect(draft).toMatchObject({ source: 'screen', imageFile: 'captures/scr-1.jpg' });
      expect(keepsPicture(draft!)).toBe(false);
    } finally {
      close();
    }
  });
});
