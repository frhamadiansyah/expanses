import type { CaptureLine, RawCapture } from '@expanses/core';
import { addCard, createCardAccount, createDatabase, createDraft, createWorkspace, listDrafts, listSources, migrate, sourceFor } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { drainCaptures, drainNow, lastDrain, pickPhotos, scanReceipt, type CaptureBridge } from './drain';
import { nextWaitingStatement, takeOfferedStatement } from './statements';
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

/** A bridge that hands over what the test says, has no camera or library of its own, and writes down what it was told. */
const bridge = (captures: RawCapture[], photographed: RawCapture | null = null, picked: RawCapture[] = []) => {
  const acked: string[][] = [];
  const deleted: string[] = [];
  const stand: CaptureBridge = {
    drainCaptures: async () => ({ captures }),
    ackCaptures: async ({ ids }) => {
      acked.push(ids);
    },
    scanReceipt: async () => ({ capture: photographed }),
    pickPhotos: async () => ({ captures: picked }),
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

/**
 * A capture as the phone's bridge really hands it over: Capacitor's encoder drops an empty array and a nil, so a
 * text capture arrives with no `lines` and no `imageFile` key at all.
 */
const asBridged = (capture: RawCapture): RawCapture => {
  const { lines, imageFile, ...rest } = capture;
  return { ...rest, ...(lines.length > 0 ? { lines } : {}), ...(imageFile !== null ? { imageFile } : {}) } as RawCapture;
};

describe('captures as the bridge hands them over', () => {
  it('reads a notification whose empty lines the bridge dropped', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([asBridged(notification)]);
      const result = await drainCaptures(database, ws, phone, '2026-09-30');

      expect(counts(result)).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      expect(phone.acked).toEqual([[notification.id]]);
    } finally {
      close();
    }
  });

  it('reads a photographed receipt with no text on it', async () => {
    const { database, ws, close } = await setup();
    try {
      const blank: RawCapture = { ...notification, id: 'blank', kind: 'photo', app: null, title: null, body: null };
      await expect(scanReceipt(database, ws, bridge([], asBridged(blank)), '2026-09-30')).resolves.toBeDefined();
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

/*
 * Invented statement rows, as Vision reads them: date, description and amount, each its own line on one height. No
 * figure, shop or date here is from a real statement.
 */
const statementPage = (rows: readonly (readonly [string, string, string])[]): CaptureLine[] =>
  rows.flatMap(([on, description, amount], i) => {
    const y = 0.12 + i * 0.05;
    const at = (text: string, x: number, w: number): CaptureLine => ({ text, box: [x, y, w, 0.02], height: 0.02 });
    return [at(on, 0.05, 0.1), at(description, 0.25, 0.5), at(amount, 0.85, 0.12)];
  });

const STATEMENT_PAGE = statementPage([
  ['03SEP', 'KEDAI LANGIT SORE', '61,500'],
  ['07SEP', 'TOKO ALAT TULIS RIANG', '23,750'],
  ['11SEP', 'BENGKEL SEPEDA MAJU', '142,000'],
]);

/** A picture from the library, read on the phone and kept as the camera's is. */
const chosen = (id: string, over: Partial<RawCapture> = {}): RawCapture => ({
  ...notification,
  id,
  kind: 'shared-image',
  app: null,
  title: null,
  imageFile: `captures/${id}.jpg`,
  ...over,
});

describe('pictures chosen from Photos', () => {
  it('makes one receipt a draft, its picture kept', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([], null, [chosen('lib-1')]);
      const { result, statement } = await pickPhotos(database, ws, phone, '2026-09-30');

      expect(statement).toBeNull();
      expect(counts(result)).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      expect((await listDrafts(database, ws))[0]).toMatchObject({ source: 'photo', amountMinor: 38_000 });
      expect(phone.deleted).not.toContain('captures/lib-1.jpg');
    } finally {
      close();
    }
  });

  it('sends one statement page to the card picker, keeping its lines and letting its picture go', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([], null, [chosen('lib-2', { body: null, lines: STATEMENT_PAGE })]);
      const { result, statement } = await pickPhotos(database, ws, phone, '2026-09-30');

      expect(counts(result)).toEqual({ drafts: 0, merged: 0, skipped: 0 });
      expect(await listDrafts(database, ws)).toEqual([]);
      expect(phone.deleted).toContain('captures/lib-2.jpg');
      expect(takeOfferedStatement(statement!)).toEqual([STATEMENT_PAGE]);
      // The picker opens its own at once: nothing is left for Review to hand on.
      expect(nextWaitingStatement()).toBeNull();
    } finally {
      close();
    }
  });

  it('sends two or more pictures to the card picker as one statement, whatever is on them', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([], null, [chosen('lib-3'), chosen('lib-4')]);
      const { statement } = await pickPhotos(database, ws, phone, '2026-09-30');

      expect(await listDrafts(database, ws)).toEqual([]);
      expect(phone.deleted).toEqual(expect.arrayContaining(['captures/lib-3.jpg', 'captures/lib-4.jpg']));
      expect(takeOfferedStatement(statement!)).toHaveLength(2);
    } finally {
      close();
    }
  });

  it('changes nothing when the library was closed without a picture', async () => {
    const { database, ws, close } = await setup();
    try {
      const { result, statement } = await pickPhotos(database, ws, bridge([], null, []), '2026-09-30');
      expect(statement).toBeNull();
      expect(counts(result)).toEqual({ drafts: 0, merged: 0, skipped: 0 });
    } finally {
      close();
    }
  });
});

describe('one screenshot shared from Photos', () => {
  it('is a draft when it is a payment, and a statement waiting for its card when it is a statement page', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([chosen('share-1'), chosen('share-2', { body: null, lines: STATEMENT_PAGE })]);
      const result = await drainCaptures(database, ws, phone, '2026-09-30');

      expect(counts(result)).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      // Both leave the holding area; only the statement's picture goes.
      expect(phone.acked).toEqual([['share-1', 'share-2']]);
      expect(phone.deleted).toContain('captures/share-2.jpg');
      expect(phone.deleted).not.toContain('captures/share-1.jpg');
      const waiting = nextWaitingStatement();
      expect(waiting).not.toBeNull();
      expect(takeOfferedStatement(waiting!)).toEqual([STATEMENT_PAGE]);
      expect(nextWaitingStatement()).toBeNull();
    } finally {
      close();
    }
  });

  it('leaves a screen scanner capture to the queue, statement-shaped or not: only the share sheet is checked', async () => {
    const { database, ws, close } = await setup();
    try {
      const phone = bridge([chosen('shot-9', { kind: 'screen', body: null, lines: STATEMENT_PAGE })]);
      await drainCaptures(database, ws, phone, '2026-09-30');
      expect(nextWaitingStatement()).toBeNull();
    } finally {
      close();
    }
  });
});

describe('a drain reads again what an earlier reader left at nothing', () => {
  it('fills a waiting message’s figure even when the phone hands nothing over, and says so', async () => {
    const { database, ws, close } = await setup();
    try {
      const sms: RawCapture = {
        ...notification,
        id: 'sms-abroad',
        app: 'BANKCONTOH',
        title: 'BANKCONTOH',
        body: 'Terima kasih utk trx kartukredit XXXX5512 tgl 03-11-2026 14:22:07 di TOKO KOPI CONTOH KRW94.300,00. Jika trx tidak Anda kenal, hub 10000',
      };
      const source = await sourceFor(database.db, sms);
      // As the queue held it before the reader knew the currency: no figure, the sender for a name.
      await createDraft(database, ws, {
        source: 'notification',
        kind: 'expense',
        occurredOn: '2026-11-03',
        description: 'BANKCONTOH',
        amountMinor: 0,
        currency: 'IDR',
        sourceId: source.id,
        captureIds: [sms.id],
        externalRef: `capture:${sms.id}`,
        rawPayload: `${sms.title}\n${sms.body}`,
        reading: { skipped: 'unreadable', amount: null, occurredAt: null, type: { value: 'spent', confidence: 0, line: null }, name: null, accountHint: '5512', paymentMethod: null },
      });

      const result = await drainCaptures(database, ws, bridge([]), '2026-11-05');

      expect(result).toMatchObject({ drafts: 0, merged: 0, skipped: 0, reread: 1 });
      expect((await listDrafts(database, ws))[0]).toMatchObject({ amountMinor: 94_300, currency: 'KRW', description: 'TOKO KOPI CONTOH' });
      // Read once: the next drain finds nothing left to read again.
      expect((await drainCaptures(database, ws, bridge([]), '2026-11-05')).reread).toBe(0);
    } finally {
      close();
    }
  });
});

describe('a drain puts right a Maybank email an older build queued as money in', () => {
  it('turns it into a purchase once, and names its source for the bank', async () => {
    const { database, ws, close } = await setup();
    try {
      // The sender as an older build kept it: a name and an address on two lines, read as a source called "Id".
      const mail: RawCapture = {
        ...notification,
        id: 'mail-old',
        app: 'Maybank\nalerts@maybank.co.id',
        title: 'Maybank Credit Card Transaction Notification (do not reply)',
        body: 'Nomor Kartu\tMerchant\tMata Uang\tJumlah\n**** 4732\tKEDAI CONTOH\tIDR\t31,500',
      };
      const source = await sourceFor(database.db, mail);
      // Keyed and named as that build made it: on the sender exactly as handed over, called for its last dot.
      await database.execScript(`UPDATE capture_sources SET key = '${mail.app}', label = 'Id'`);
      await createDraft(database, ws, {
        source: 'notification',
        kind: 'income',
        occurredOn: '2026-11-11',
        description: 'KEDAI CONTOH',
        amountMinor: -31_500,
        currency: 'IDR',
        sourceId: source.id,
        captureIds: [mail.id],
        externalRef: `capture:${mail.id}`,
        rawPayload: null,
      });

      expect((await drainCaptures(database, ws, bridge([]), '2026-11-13')).reread).toBe(1);
      expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'expense', amountMinor: 31_500 });
      expect((await listSources(database)).map((one) => one.label)).toEqual(['Maybank']);
      expect((await drainCaptures(database, ws, bridge([]), '2026-11-13')).reread).toBe(0);
    } finally {
      close();
    }
  });
});

/*
 * The owner's report of 2026-11-18, end to end: a credit card purchase email handed over by the Shortcuts Email trigger
 * ("Log notification": Title = Subject, Body = Body, App = Sender) and drained into the queue. Its sender came through
 * as something no Maybank domain could be read from. Invented throughout.
 */
describe('a credit card purchase email drained from the phone', () => {
  const LINES = [
    'Hi Pemegang Kartu Kredit Maybank,',
    'Anda baru saja melakukan transaksi dengan',
    'Maybank Kartu Kredit',
    'Nomor Kartu',
    'Jenis Kartu',
    'Merchant',
    '**** **** **** 4321',
    'VISA',
    'Grab* A-ZZ9EXAMPLE01',
    'Waktu Transaksi',
    'Mata Uang',
    'Jumlah',
    '02 Nov 26 09:41',
    'IDR',
    '57,300',
    'Status',
    'Sukses/Approved',
    'Apabila Anda tidak melakukan transaksi',
    'segera hubungi Maybank Customer Care',
    '1500611 atau +622100000000 (dari luar negeri)',
  ];
  const email = (body: string, app: string | null): RawCapture => ({
    id: 'mail-2026-11-18',
    kind: 'notification',
    capturedAt: '2026-11-18T13:16:00+07:00',
    app,
    title: null,
    body,
    lines: [],
    imageFile: null,
  });

  async function withCard() {
    const made = await setup();
    const card = await createCardAccount(made.database, made.ws, { name: 'Maybank Visa', subtype: 'credit_card', currency: 'IDR' });
    const cardId = await addCard(made.database, made.ws, { accountId: card.id, last4: '4321' });
    return { ...made, card: card.id, cardId };
  }

  it.each([
    ['as shown', LINES.join('\n'), 'notifikasi@kartu.example.com'],
    ['with its card’s "Kredit" on a line of its own', LINES.join('\n').replace(/Kartu Kredit/g, 'Kartu\nKredit'), 'notifikasi@kartu.example.com'],
    ['with blank lines and indents between the cells', LINES.map((line) => `  ${line}`).join('\n\n'), 'Maybank Kartu Kredit'],
    ['with no sender at all', LINES.join('\n').replace(/Kartu Kredit/g, 'Kartu \nKredit'), null],
  ])('is an expense on the card ending in its digits, %s', async (_, body, app) => {
    const { database, ws, card, cardId, close } = await withCard();
    try {
      const result = await drainCaptures(database, ws, bridge([email(body, app)]), '2026-11-18');
      expect(counts(result)).toEqual({ drafts: 1, merged: 0, skipped: 0 });
      const [draft] = await listDrafts(database, ws);
      expect(draft).toMatchObject({ kind: 'expense', amountMinor: 57_300, currency: 'IDR', accountId: card, cardId, description: 'Grab* A-ZZ9EXAMPLE01', occurredOn: '2026-11-02' });
    } finally {
      close();
    }
  });

  it('comes from a source named Maybank when the sender holds the bank’s domain', async () => {
    const { database, ws, close } = await withCard();
    try {
      await drainCaptures(database, ws, bridge([email(LINES.join('\n'), 'Maybank Kartu Kredit <notifikasi@maybank.co.id>, balasan@mailer.example.com')]), '2026-11-18');
      expect((await listSources(database)).map((one) => one.label)).toEqual(['Maybank']);
    } finally {
      close();
    }
  });

  it('is put right on the next drain when the build before queued it as money in, once', async () => {
    const { database, ws, card, cardId, close } = await withCard();
    try {
      const mail = email(LINES.join('\n').replace(/Kartu Kredit/g, 'Kartu\nKredit'), 'notifikasi@kartu.example.com');
      const source = await sourceFor(database.db, mail);
      // As the build before this one wrote it: money in on the card's account, no card chosen, read as received.
      await createDraft(database, ws, {
        source: 'notification',
        kind: 'income',
        occurredOn: '2026-11-02',
        description: 'Grab* A-ZZ9EXAMPLE01',
        amountMinor: -57_300,
        currency: 'IDR',
        accountId: card,
        sourceId: source.id,
        captureIds: [mail.id],
        externalRef: `capture:${mail.id}`,
        rawPayload: mail.body,
        reading: {
          skipped: null,
          amount: { value: { minor: 57_300, currency: 'IDR' }, confidence: 90, line: null },
          occurredAt: { value: '2026-11-02T09:41', confidence: 90, line: null },
          type: { value: 'received', confidence: 85, line: null },
          name: { value: 'Grab* A-ZZ9EXAMPLE01', confidence: 90, line: null },
          accountHint: '4321',
          paymentMethod: null,
        },
      });

      expect((await drainCaptures(database, ws, bridge([]), '2026-11-21')).reread).toBe(1);
      expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'expense', amountMinor: 57_300, accountId: card, cardId, description: 'Grab* A-ZZ9EXAMPLE01', status: 'pending' });
      expect((await drainCaptures(database, ws, bridge([]), '2026-11-21')).reread).toBe(0);
    } finally {
      close();
    }
  });
});
