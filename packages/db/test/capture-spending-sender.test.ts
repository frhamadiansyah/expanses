import type { RawCapture } from '@expanses/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { fixSpendingSenderDrafts } from '../src/capture/reread';
import { listSources, tidySenderSources } from '../src/capture/sources';
import { addCard, confirmDraft, createCardAccount, type Database, listAccounts, listDrafts } from '../src/index';
import { captureSources } from '../src/schema-capture';
import { draftTransactions } from '../src/schema-drafts';
import { setupDb, type TestDb } from './helpers';

/*
 * A Maybank card email is a purchase, always: the owner's rule. The reader guessed money in from a "Kartu Kredit" whose
 * two words the email kept apart (two spaces, a line break), and a sender handed over as a name and an address on two
 * lines made a source called "Id". Every figure, digit, merchant and address here is invented.
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

  it('is a purchase from the debit account too, whatever its words say', async () => {
    const { database, ws } = await workspace();
    const body = [
      'Terima kasih Anda telah menggunakan aplikasi kami. Berikut ini adalah aktivitas yang telah Anda lakukan:',
      'Tanggal dan Jam\t: 04/11/2026, 09:12:40',
      'Tipe Transaksi\t: QR Pembayaran',
      'Dari Rekening\t: ****8810 IDR',
      'Nama Merchant\t: Kedai Contoh, Kebayo',
      'Jumlah\t: IDR 82,000.00',
      'Status\t: Sukses',
      'Dana masuk ke rekening merchant. Kredit poin diberikan.',
    ].join('\n');
    await ingestCaptures(database, ws, [mail('m-debit', body, 'm2uadvisor@maybank.co.id', 'Transaksi Kartu Kredit diterima')], { today: DAY });
    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft).toMatchObject({ kind: 'expense', amountMinor: 82_000 });
  });

  it('is still skipped when the bank says it was declined', async () => {
    const { database, ws } = await workspace();
    const body = CARD_EMAIL.replace('Sukses/Approved', 'Ditolak/Declined');
    expect(await ingestCaptures(database, ws, [mail('m-1', body)], { today: DAY })).toMatchObject({ drafts: 0, skipped: 1 });
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

describe('the one-time fix of Maybank drafts waiting as income', () => {
  /** A draft as an older build left it: money in, on no card, under an income category, its words gone. */
  async function asOldBuildLeftIt(database: Database, id: string, over: Partial<typeof draftTransactions.$inferInsert>) {
    await database.db
      .update(draftTransactions)
      .set({ kind: 'income', amountMinor: -47_500, cardId: null, accountId: null, rawPayload: null, readingJson: '{"type":{"value":"received"}}', ...over })
      .where(eq(draftTransactions.id, id));
  }

  it('turns every pending one into a purchase on its card, once', async () => {
    const { database, ws, card, cardId, income } = await workspace();
    await ingestCaptures(database, ws, [mail('m-a', CARD_EMAIL), mail('m-b', CARD_EMAIL.replace('47,500', '12,000')), mail('m-c', CARD_EMAIL.replace('47,500', '9,000'))], {
      today: DAY,
    });
    const [a, b, c] = (await listDrafts(database, ws, 'pending')).sort((x, y) => x.amountMinor - y.amountMinor).reverse();
    // a: negative figure, an income category, a reading that names the card; b: a positive figure and no reading at all.
    await asOldBuildLeftIt(database, a!.id, { categoryAccountId: income, readingJson: JSON.stringify({ type: { value: 'received' }, accountHint: '4732', amount: null }) });
    await asOldBuildLeftIt(database, b!.id, { amountMinor: 12_000, readingJson: null });
    // c was confirmed as income by the owner: it is no longer waiting, and stays as it is.
    await asOldBuildLeftIt(database, c!.id, { amountMinor: -9_000, categoryAccountId: income, accountId: card });
    await confirmDraft(database, ws, c!.id);
    const confirmedBefore = await row(database, c!.id);

    expect(await fixSpendingSenderDrafts(database, { today: DAY })).toBe(2);

    expect(await row(database, a!.id)).toMatchObject({ kind: 'expense', amountMinor: 47_500, accountId: card, cardId, categoryAccountId: null, status: 'pending' });
    expect(await row(database, b!.id)).toMatchObject({ kind: 'expense', amountMinor: 12_000, status: 'pending' });
    expect(await row(database, c!.id)).toEqual(confirmedBefore);

    // Run once per device: a draft made income again afterwards is left alone.
    await asOldBuildLeftIt(database, a!.id, {});
    expect(await fixSpendingSenderDrafts(database, { today: DAY })).toBe(0);
    expect((await row(database, a!.id)).kind).toBe('income');
  });

  it('turns round a draft whose source an older build named "Id"', async () => {
    const { database, ws, card } = await workspace();
    await ingestCaptures(database, ws, [mail('m-a', CARD_EMAIL, `Maybank\n${SENDER}`)], { today: DAY });
    const [a] = await listDrafts(database, ws, 'pending');
    await database.db.update(captureSources).set({ label: 'Id' });
    // The reading it kept names the card's digits, as every build's did.
    await asOldBuildLeftIt(database, a!.id, { readingJson: (await row(database, a!.id)).readingJson });

    expect(await fixSpendingSenderDrafts(database, { today: DAY })).toBe(1);
    expect(await row(database, a!.id)).toMatchObject({ kind: 'expense', amountMinor: 47_500, accountId: card });
  });

  it('leaves money in from any other sender as it is', async () => {
    const { database, ws } = await workspace();
    const body = ['Mata Uang', 'Jumlah', 'IDR', '500,000', 'Dana telah masuk ke rekening Anda.'].join('\n');
    await ingestCaptures(database, ws, [mail('m-other', body, 'alerts@bankcontoh.co.id', 'Notifikasi')], { today: DAY });
    const [draft] = await listDrafts(database, ws, 'pending');
    expect(await fixSpendingSenderDrafts(database, { today: DAY })).toBe(0);
    expect((await row(database, draft!.id)).kind).toBe('income');
  });
});
