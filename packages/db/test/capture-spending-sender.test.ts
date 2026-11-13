import type { RawCapture } from '@expanses/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { fixCardEmailDrafts } from '../src/capture/reread';
import { listSources, tidySenderSources } from '../src/capture/sources';
import { addCard, confirmDraft, createCardAccount, type Database, listAccounts, listDrafts } from '../src/index';
import { captureSources } from '../src/schema-capture';
import { draftTransactions } from '../src/schema-drafts';
import { setupDb, type TestDb } from './helpers';

/*
 * A Maybank credit card purchase email is a purchase: the reader guessed money in from a "Kartu Kredit" whose two words
 * the email kept apart (two spaces, a line break), and a sender handed over as a name and an address on two lines made
 * a source called "Id". A refund, a top-up, a decline and the debit app's money in stay what they are. Every figure,
 * digit, merchant and address here is invented.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const DAY = '2026-11-13';
const SENDER = 'alerts@maybank.co.id';

/** The email as the Mail automation hands it over: a flattened table, every label before its value. */
const CARD_EMAIL = [
  'Hi Pemegang Kartu Kredit Maybank,',
  'Anda baru saja melakukan transaksi dengan Maybank Kartu Kredit',
  'Nomor Kartu',
  'Jenis Kartu',
  'Merchant',
  '**** **** **** 4732',
  'VISA',
  'Ojekku* A-QZ81LMNOPQ2',
  'Waktu Transaksi',
  'Mata Uang',
  'Jumlah',
  '05 Nov 26 18:22',
  'IDR',
  '47,500',
  'Status',
  'Sukses/Approved',
  'Jika ada pertanyaan, hubungi layanan nasabah kami.',
].join('\n');

const mail = (id: string, body: string, app: string = SENDER, title = 'Maybank Credit Card Transaction Notification (do not reply)'): RawCapture => ({
  id,
  kind: 'notification',
  capturedAt: '2026-11-05T18:23:00+07:00',
  app,
  title,
  body,
  lines: [],
  imageFile: null,
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Maybank card', subtype: 'credit_card', currency: 'IDR' });
  const cardId = await addCard(database, ws, { accountId: card.id, last4: '4732' });
  const all = await listAccounts(database, ws);
  const income = all.find((account) => account.kind === 'income')!.id;
  return { database, ws, card: card.id, cardId, income };
}

const row = async (database: Database, id: string) => (await database.db.select().from(draftTransactions).where(eq(draftTransactions.id, id)))[0]!;

describe('a Maybank card email', () => {
  it.each([
    ['as the table arrives', CARD_EMAIL],
    ['with "Kartu Kredit" apart by two spaces', CARD_EMAIL.replace(/Kartu Kredit/g, 'Kartu  Kredit')],
    ['with "Kartu Kredit" apart by a tab', CARD_EMAIL.replace(/Kartu Kredit/g, 'Kartu\tKredit')],
    ['with "Kartu Kredit" broken over two lines', CARD_EMAIL.replace(/Kartu Kredit/g, 'Kartu\nKredit')],
    ['with Windows line ends and no-break spaces', CARD_EMAIL.replace(/\n/g, '\r\n').replace(/Kartu Kredit/g, 'Kartu  Kredit')],
    ['with a credit named under the table', `${CARD_EMAIL}\nDana masuk dan kredit poin dalam 2 hari.`],
  ])('is a purchase on the card it names, %s', async (_, body) => {
    const { database, ws, card, cardId } = await workspace();
    await ingestCaptures(database, ws, [mail('m-1', body)], { today: DAY });
    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft).toMatchObject({ kind: 'expense', amountMinor: 47_500, currency: 'IDR', accountId: card, cardId, description: 'Ojekku* A-QZ81LMNOPQ2' });
  });

  it.each([
    ['an address', SENDER],
    ['a name and an address', `Maybank <${SENDER}>`],
    ['a name, then the address on its own line', `Maybank\n${SENDER}`],
    ['a name, then the address after a space', `Maybank Kartu Kredit ${SENDER}`],
  ])('comes from a source named Maybank when the sender is %s', async (_, app) => {
    const { database, ws } = await workspace();
    await ingestCaptures(database, ws, [mail('m-1', CARD_EMAIL, app)], { today: DAY });
    const [source] = await listSources(database);
    expect(source!.label).toMatch(/^Maybank/);
    expect(source!.label).not.toBe('Id');
  });

  const M2U = 'm2uadvisor@maybank.co.id';
  const m2u = (lines: string[]) =>
    ['Terima kasih Anda telah menggunakan aplikasi kami. Berikut ini adalah aktivitas yang telah Anda lakukan:', ...lines, 'Status\t: Sukses'].join('\n');

  it('from the debit app is read as it reads: a payment is spending, money arriving is income', async () => {
    const { database, ws } = await workspace();
    const paid = m2u(['Tanggal dan Jam\t: 04/11/2026, 09:12:40', 'Tipe Transaksi\t: QR Pembayaran', 'Dari Rekening\t: ****8810 IDR', 'Nama Merchant\t: Kedai Contoh, Kebayo', 'Jumlah\t: IDR 82,000.00']);
    const arrived = 'Dana masuk ke rekening ****8810 sebesar IDR 1,250,000.00 dari PT CONTOH JAYA. Terima kasih.';
    await ingestCaptures(database, ws, [mail('m-paid', paid, M2U, 'Aktivitas M2U'), mail('m-in', arrived, M2U, 'Dana masuk')], { today: DAY });
    const drafts = await listDrafts(database, ws, 'pending');
    expect(drafts.find((one) => one.amountMinor === 82_000)?.kind).toBe('expense');
    expect(drafts.find((one) => Math.abs(one.amountMinor) === 1_250_000)).toMatchObject({ kind: 'income', amountMinor: -1_250_000 });
  });

  it('that is a top-up paid by the card stays a top-up', async () => {
    const { database, ws } = await workspace();
    const body = 'Top up saldo DOMPETKU Rp150.000 dengan Maybank Kartu Kredit **** 4732 berhasil.';
    await ingestCaptures(database, ws, [mail('m-topup', body, SENDER, 'Transaksi Kartu Kredit')], { today: DAY });
    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft!.kind).toBe('transfer');
  });

  it('that is a refund to the card stays a refund', async () => {
    const { database, ws } = await workspace();
    const body = CARD_EMAIL.replace('Jika ada pertanyaan, hubungi layanan nasabah kami.', 'Dana dikembalikan ke kartu. Pengembalian dana berhasil.');
    await ingestCaptures(database, ws, [mail('m-refund', body)], { today: DAY });
    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft).toMatchObject({ kind: 'income', amountMinor: -47_500 });
  });

  it('is still skipped when the bank says it was declined', async () => {
    const { database, ws } = await workspace();
    const body = CARD_EMAIL.replace('Sukses/Approved', 'Ditolak/Declined');
    expect(await ingestCaptures(database, ws, [mail('m-1', body)], { today: DAY })).toMatchObject({ drafts: 0, skipped: 1 });
  });

  it('is skipped when a plain notice says the card purchase was declined', async () => {
    const { database, ws } = await workspace();
    const body = 'Transaksi Maybank Kartu Kredit **** 4732 sebesar Rp 47.500 di OJEKKU ditolak. Dana tidak masuk ke merchant.';
    expect(await ingestCaptures(database, ws, [mail('m-1', body, SENDER, 'Transaksi Kartu Kredit Ditolak')], { today: DAY })).toMatchObject({ drafts: 0, skipped: 1 });
  });

  it('leaves another bank on .co.id named for itself, and its money in as money in', async () => {
    const { database, ws } = await workspace();
    const body = ['Mata Uang', 'Jumlah', 'IDR', '500,000', 'Dana telah masuk ke rekening Anda.'].join('\n');
    await ingestCaptures(database, ws, [mail('m-other', body, 'kartukreditbca@bca.co.id', 'Notifikasi')], { today: DAY });
    const [source] = await listSources(database);
    expect(source!.label).toBe('Bca');
    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft!.kind).toBe('income');
  });
});

describe('a source an older build named "Id"', () => {
  it('is named for the bank, and the next email from that sender still finds it', async () => {
    const { database, ws } = await workspace();
    const raw = `Maybank\n${SENDER}`;
    await database.db.insert(captureSources).values({
      id: 'src-old',
      workspaceId: null,
      keyKind: 'app',
      key: raw,
      label: 'Id',
      accountId: null,
      templateJson: null,
      readOffers: 0,
      capturedCount: 3,
      createdAt: '2026-11-11T12:00:00.000Z',
      updatedAt: '2026-11-11T12:00:00.000Z',
    });
    expect(await tidySenderSources(database)).toBe(1);
    expect(await tidySenderSources(database)).toBe(0);
    await ingestCaptures(database, ws, [mail('m-new', CARD_EMAIL, raw)], { today: DAY });
    const sources = await listSources(database);
    expect(sources.map((source) => [source.id, source.label])).toEqual([['src-old', 'Maybank']]);
  });
});

describe('the one-time fix of Maybank card drafts waiting as income', () => {
  /** A draft as an older build's reader left it: money in, the figure's sign turned, no card chosen, read as received. */
  async function asOldBuildLeftIt(database: Database, id: string, over: Partial<typeof draftTransactions.$inferInsert> = {}) {
    const now = await row(database, id);
    const reading = JSON.parse(now.readingJson!) as Record<string, unknown>;
    await database.db
      .update(draftTransactions)
      .set({
        kind: 'income',
        amountMinor: -Math.abs(now.amountMinor),
        cardId: null,
        categoryAccountId: null,
        rawPayload: null,
        readingJson: JSON.stringify({ ...reading, type: { value: 'received', confidence: 85, line: null } }),
        ...over,
      })
      .where(eq(draftTransactions.id, id));
  }

  async function queued(made: Awaited<ReturnType<typeof workspace>>, count: number, app = SENDER) {
    const figures = ['47,500', '12,000', '9,000', '8,000', '7,000', '6,000'].slice(0, count);
    await ingestCaptures(made.database, made.ws, figures.map((figure, n) => mail(`m-${n}`, CARD_EMAIL.replace('47,500', figure), app)), { today: DAY });
    return (await listDrafts(made.database, made.ws, 'pending')).sort((x, y) => y.amountMinor - x.amountMinor);
  }

  it('turns the reader’s own income into a purchase on its card, once, and leaves a confirmed one as it is', async () => {
    const made = await workspace();
    const { database, ws, card, cardId, income } = made;
    const [a, c] = await queued(made, 2);
    await asOldBuildLeftIt(database, a!.id);
    await asOldBuildLeftIt(database, c!.id, { categoryAccountId: income });
    await confirmDraft(database, ws, c!.id);
    const confirmedBefore = await row(database, c!.id);

    expect(await fixCardEmailDrafts(database, { today: DAY })).toBe(1);

    expect(await row(database, a!.id)).toMatchObject({ kind: 'expense', amountMinor: 47_500, accountId: card, cardId, categoryAccountId: null, status: 'pending' });
    expect(await row(database, c!.id)).toEqual(confirmedBefore);

    // Once per device: a draft made income again afterwards is left alone.
    await asOldBuildLeftIt(database, a!.id);
    expect(await fixCardEmailDrafts(database, { today: DAY })).toBe(0);
    expect((await row(database, a!.id)).kind).toBe('income');
  });

  it('leaves a draft the owner changed, or one read as a refund or a top-up', async () => {
    const made = await workspace();
    const { database, ws, income } = made;
    const other = await createCardAccount(database, ws, { name: 'Other card', subtype: 'credit_card', currency: 'IDR' });
    const [account, category, sign, refund, topup] = await queued(made, 5);
    await asOldBuildLeftIt(database, account!.id, { accountId: other.id });
    await asOldBuildLeftIt(database, category!.id, { categoryAccountId: income });
    // Income with its figure made positive by hand: the owner's doing.
    await asOldBuildLeftIt(database, sign!.id, { amountMinor: 9_000 });
    for (const [draft, type] of [
      [refund!, 'refund'],
      [topup!, 'topup'],
    ] as const) {
      const reading = JSON.parse((await row(database, draft.id)).readingJson!) as Record<string, unknown>;
      await asOldBuildLeftIt(database, draft.id, { readingJson: JSON.stringify({ ...reading, type: { value: type, confidence: 85, line: null } }) });
    }
    const before = await Promise.all([account, category, sign, refund, topup].map((draft) => row(database, draft!.id)));

    expect(await fixCardEmailDrafts(database, { today: DAY })).toBe(0);
    expect(await Promise.all([account, category, sign, refund, topup].map((draft) => row(database, draft!.id)))).toEqual(before);
  });

  it('turns round a draft that kept no reading only while its category is none, keeping its account', async () => {
    const made = await workspace();
    const { database, income } = made;
    const [bare, categorised] = await queued(made, 2);
    await asOldBuildLeftIt(database, bare!.id, { readingJson: null, accountId: null });
    await asOldBuildLeftIt(database, categorised!.id, { readingJson: null, categoryAccountId: income });

    expect(await fixCardEmailDrafts(database, { today: DAY })).toBe(1);
    expect(await row(database, bare!.id)).toMatchObject({ kind: 'expense', amountMinor: 47_500, accountId: null });
    expect((await row(database, categorised!.id)).kind).toBe('income');
  });

  it('turns round a draft whose source an older build named "Id"', async () => {
    const made = await workspace();
    const [a] = await queued(made, 1, `Maybank\n${SENDER}`);
    await made.database.db.update(captureSources).set({ label: 'Id' });
    await asOldBuildLeftIt(made.database, a!.id);

    expect(await fixCardEmailDrafts(made.database, { today: DAY })).toBe(1);
    expect(await row(made.database, a!.id)).toMatchObject({ kind: 'expense', amountMinor: 47_500, accountId: made.card });
  });

  it('leaves money in from the debit app and from any other sender as it is', async () => {
    const { database, ws } = await workspace();
    const body = ['Mata Uang', 'Jumlah', 'IDR', '500,000', 'Dana telah masuk ke rekening Anda.'].join('\n');
    await ingestCaptures(database, ws, [mail('m-other', body, 'alerts@bankcontoh.co.id', 'Notifikasi'), mail('m-m2u', body.replace('500,000', '600,000'), 'm2uadvisor@maybank.co.id', 'Notifikasi')], { today: DAY });
    expect(await fixCardEmailDrafts(database, { today: DAY })).toBe(0);
    expect((await listDrafts(database, ws, 'pending')).map((draft) => draft.kind)).toEqual(['income', 'income']);
  });
});
