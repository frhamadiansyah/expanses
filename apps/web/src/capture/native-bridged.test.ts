import { describe, expect, it, vi } from 'vitest';

/*
 * The phone's plugin as Capacitor's encoder delivers it: an empty array and a nil are dropped on the way over, so a
 * text capture has no `lines` or `imageFile`, and a screenshot with no text on it has no `lines`.
 */
vi.mock('@capacitor/core', () => ({
  WebPlugin: class {},
  registerPlugin: () => ({
    drainCaptures: async () => ({
      captures: [{ id: 'n1', kind: 'notification', capturedAt: '2026-10-15T18:00:00+07:00', app: 'BANK', body: 'Rp10.000' }],
    }),
    scanReceipt: async () => ({ capture: { id: 'p1', kind: 'photo', capturedAt: '2026-10-15T18:00:00+07:00' } }),
    recognizeImage: async () => ({}),
    takeStatementBatch: async () => ({ images: [{}, { lines: [{ text: 'x', box: [0, 0, 1, 1], height: 1 }] }] }),
  }),
}));

const { native } = await import('./native');

describe('the capture bridge on the phone', () => {
  it('makes a drained capture whole again', async () => {
    const { captures } = await native.drainCaptures();
    expect(captures[0]).toEqual({
      id: 'n1',
      kind: 'notification',
      capturedAt: '2026-10-15T18:00:00+07:00',
      app: 'BANK',
      title: null,
      body: 'Rp10.000',
      lines: [],
      imageFile: null,
    });
  });

  it('makes a photographed receipt with no text whole again', async () => {
    const { capture } = await native.scanReceipt();
    expect(capture).toMatchObject({ app: null, title: null, body: null, lines: [], imageFile: null });
  });

  it('reads a picture with no text on it as no lines', async () => {
    expect(await native.recognizeImage({ base64: '' })).toEqual({ lines: [] });
    const { images } = await native.takeStatementBatch({ batchId: 'b' });
    expect(images.map((image) => image.lines.length)).toEqual([0, 1]);
  });
});
