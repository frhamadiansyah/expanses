import { expenseLines, type RawCapture } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { listSkipped } from '../src/capture/skipped';
import { listSources, setSourceAccount } from '../src/capture/sources';
import { captureSources } from '../src/schema-capture';
import { addCard, createAccount, createCardAccount, listAccounts, listDrafts, postTransaction } from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * A card issuer's transaction email, handed over by a Shortcuts Mail automation into "Log notification" with
 * Title = Subject, Body = Body, App = Sender. Every figure, digit, code and address here is invented.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const DAY = new Date().toISOString().slice(0, 10);

const body = (over: { merchant?: string; currency?: string; amount?: string; status?: string } = {}) =>
  [
    'Hi Pemegang Kartu Kredit Bank Contoh,',
    '',
    'Anda baru saja melakukan transaksi dengan',
    'Bank Contoh Kartu Kredit',
    'Nomor Kartu\tJenis Kartu\tMerchant',
    `**** **** **** 4732\tVISA\t${over.merchant ?? 'Tokobaju* B-QX7TPLM22'}`,
    'Waktu Transaksi\tMata Uang\tJumlah',
    `03 Nov 26 09:41\t${over.currency ?? 'IDR'}\t${over.amount ?? '245,500'}`,
    `Status\t${over.status ?? 'Sukses/ Approved'}`,
    '',
    'Untuk pengembalian dana atau promo cashback, kunjungi situs kami.',
  ].join('\n');

const mail = (id: string, text: string, sender = 'Bank Contoh <alerts@bankcontoh.co.id>'): RawCapture => ({
  id,
  kind: 'notification',
  capturedAt: '2026-11-03T09:42:10+07:00',
  app: sender,
  title: 'Contoh Credit Card Transaction Notification (do not reply)',
  body: text,
  lines: [],
  imageFile: null,
});

async function withCard() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Contoh card', subtype: 'credit_card', currency: 'IDR' });
  await addCard(database, ws, { accountId: card.id, last4: '4732' });
  return { database, ws, card };
}

describe('a bank email', () => {
  it('becomes a draft on the card it names, noted with the merchant exactly as sent', async () => {
    const { database, ws, card } = await withCard();

    expect(await ingestCaptures(database, ws, [mail('mail-1', body())], { today: DAY })).toMatchObject({ drafts: 1, skipped: 0 });

    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft).toMatchObject({
      kind: 'expense',
      amountMinor: 245_500,
      currency: 'IDR',
      occurredOn: '2026-11-03',
      accountId: card.id,
      description: 'Tokobaju* B-QX7TPLM22',
    });
  });

  it('keeps each sender as a capture source of its own, named for the sender', async () => {
    const { database, ws } = await withCard();
    await ingestCaptures(
      database,
      ws,
      [mail('mail-1', body()), mail('mail-2', body({ amount: '18,000' }), 'alerts@bankcontoh.co.id'), mail('mail-3', body({ amount: '9,000' }), 'notify@mail.lain.com')],
      { today: DAY },
    );

    const sources = await listSources(database);
    expect(sources.map((source) => [source.keyKind, source.key, source.label]).sort()).toEqual([
      ['app', 'alerts@bankcontoh.co.id', 'Bank Contoh'],
      ['app', 'notify@mail.lain.com', 'Lain'],
    ]);
    expect(sources.find((source) => source.key === 'alerts@bankcontoh.co.id')!.capturedCount).toBe(2);
  });

  it('keeps a source made before senders were keyed by address, with the account it learned', async () => {
    const { database, ws } = await withCard();
    const bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    // A message app that hands over an email address as its sender made this source, keyed on the address as it came.
    const now = new Date().toISOString();
    await database.db.insert(captureSources).values({
      id: 'legacy-source',
      workspaceId: null,
      keyKind: 'app',
      key: 'Kawan.Contoh@Example.com',
      label: 'Com',
      accountId: null,
      templateJson: null,
      readOffers: 0,
      capturedCount: 3,
      createdAt: now,
      updatedAt: now,
    });
    await setSourceAccount(database, 'legacy-source', bank.id, ws.workspaceId);

    const message = { ...mail('msg-1', 'Pembayaran Rp38.000 berhasil. Merchant: TOKO KOPI', 'Kawan.Contoh@Example.com'), title: 'Kawan' };
    await ingestCaptures(database, ws, [message], { today: DAY });

    const sources = await listSources(database);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: 'legacy-source', key: 'Kawan.Contoh@Example.com', capturedCount: 4, accountId: bank.id });
    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft).toMatchObject({ accountId: bank.id, amountMinor: 38_000 });
  });

  it('is recorded in the currency it was charged in', async () => {
    const { database, ws } = await withCard();
    await ingestCaptures(database, ws, [mail('mail-sgd', body({ currency: 'SGD', amount: '18.40' }))], { today: DAY });

    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft).toMatchObject({ amountMinor: 1_840, currency: 'SGD' });
  });

  it('makes nothing of a purchase the bank declined, and lists nothing to bring back', async () => {
    const { database, ws } = await withCard();

    expect(await ingestCaptures(database, ws, [mail('mail-no', body({ status: 'Ditolak/ Declined' }))], { today: DAY })).toMatchObject({
      drafts: 0,
      skipped: 1,
    });
    expect(await listDrafts(database, ws, 'pending')).toHaveLength(0);
    expect(await listSkipped(database, ws, DAY)).toHaveLength(0);
  });

  it('arrives under the category the same merchant went to last time, whatever its reference code', async () => {
    const { database, ws, card } = await withCard();
    const all = await listAccounts(database, ws);
    const cafe = all.find((account) => account.systemKey === 'food_beverage.cafe_dessert')!.id;
    await postTransaction(database, ws, {
      occurredOn: '2026-10-20',
      description: 'Tokobaju* C-8ZK2LMQ04',
      lines: expenseLines({ categoryAccountId: cafe, paymentAccountId: card.id, amountMinor: 120_000, currency: 'IDR' }),
    });

    await ingestCaptures(database, ws, [mail('mail-1', body())], { today: DAY });

    const [draft] = await listDrafts(database, ws, 'pending');
    expect(draft).toMatchObject({ description: 'Tokobaju* B-QX7TPLM22', categoryAccountId: cafe });
  });
});
