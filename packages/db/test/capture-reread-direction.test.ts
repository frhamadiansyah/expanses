import { expenseLines, type RawCapture } from '@expanses/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { storedReadingOf } from '../src/capture/learn';
import { rereadUnreadDrafts } from '../src/capture/reread';
import { addCard, confirmDraft, createAccount, createCardAccount, type Database, dismissDraft, editDraft, listAccounts, listDrafts, postTransaction } from '../src/index';
import { draftTransactions } from '../src/schema-drafts';
import { setupDb, type TestDb } from './helpers';

/*
 * A card email an earlier reader took for money in waits in the queue as income. Once the reader reads it as a
 * purchase, the draft is turned round where it stands — but only while it is still what the reader made of it.
 * Every figure, digit, name and address here is invented.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const DAY = new Date().toISOString().slice(0, 10);

const CARD_EMAIL = [
  'Hi Pemegang Kartu Kredit Bank Contoh,',
  '',
  'Anda baru saja melakukan transaksi dengan',
  'Bank Contoh Kartu Kredit',
  'Nomor Kartu\tJenis Kartu\tMerchant',
  '**** **** **** 4732\tVISA\tSTORE.EXAMPLE/BILL',
  'Waktu Transaksi\tMata Uang\tJumlah',
  '05 Nov 26 20:15\tIDR\t27,500',
  'Status\tSukses/ Approved',
  '',
  'Email ini dikirim secara otomatis.',
].join('\n');

const mail = (id: string, body: string, title = 'Contoh Credit Card Transaction Notification (do not reply)'): RawCapture => ({
  id,
  kind: 'notification',
  capturedAt: '2026-11-05T20:16:00+07:00',
  app: 'Bank Contoh <alerts@bankcontoh.example>',
  title,
  body,
  lines: [],
  imageFile: null,
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Contoh card', subtype: 'credit_card', currency: 'IDR' });
  const cardId = await addCard(database, ws, { accountId: card.id, last4: '4732' });
  const all = await listAccounts(database, ws);
  const income = all.find((account) => account.kind === 'income')!.id;
  const cafe = all.find((account) => account.systemKey === 'food_beverage.cafe_dessert')!.id;
  return { database, ws, card: card.id, cardId, income, cafe };
}

const row = async (database: Database, id: string) => (await database.db.select().from(draftTransactions).where(eq(draftTransactions.id, id)))[0]!;

/**
 * Puts a draft back as the reader that missed "Kartu Kredit" left it: money received onto the card's account, no card
 * chosen, its reading saying received.
 */
async function asReadBefore(database: Database, id: string, over: { categoryAccountId?: string | null } = {}) {
  const now = await row(database, id);
  const reading = storedReadingOf(now.readingJson)!;
  await database.db
    .update(draftTransactions)
    .set({
      kind: 'income',
      amountMinor: -Math.abs(now.amountMinor),
      cardId: null,
      categoryAccountId: over.categoryAccountId ?? null,
      readingJson: JSON.stringify({ ...reading, type: { value: 'received', confidence: 60, line: null } }),
    })
    .where(eq(draftTransactions.id, id));
}

/** One card email waiting in the queue as income, as it sat on a phone before the reader fixes. */
async function misread(over: { categoryAccountId?: (made: Awaited<ReturnType<typeof workspace>>) => string | null } = {}) {
  const made = await workspace();
  await ingestCaptures(made.database, made.ws, [mail('mail-old', CARD_EMAIL)], { today: DAY });
  const [draft] = await listDrafts(made.database, made.ws);
  await asReadBefore(made.database, draft!.id, { categoryAccountId: over.categoryAccountId?.(made) ?? null });
  return { ...made, id: draft!.id };
}

describe('a card email read as money in, read again', () => {
  it('becomes spending on the card the digits name, at the same figure', async () => {
    const { database, ws, card, cardId, id } = await misread();
    expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'income', amountMinor: -27_500 });

    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(1);

    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({
      id,
      status: 'pending',
      kind: 'expense',
      amountMinor: 27_500,
      currency: 'IDR',
      accountId: card,
      cardId,
      description: 'STORE.EXAMPLE/BILL',
      occurredOn: '2026-11-05',
    });
    expect(draft!.reading?.type.value).toBe('spent');
  });

  it('reads the words as Mail kept them, no-break spaces and zero-width marks and all', async () => {
    const made = await workspace();
    const { database, ws, card, cardId } = made;
    const flattened = CARD_EMAIL.replace(/ /g, '\u00a0').replace(/Kredit/g, 'Kre\u200bdit\u200e');
    await ingestCaptures(database, ws, [mail('mail-nbsp', flattened)], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    await asReadBefore(database, draft!.id);

    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(1);
    expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'expense', amountMinor: 27_500, accountId: card, cardId });
  });

  it('drops the income category it was given and takes the one the merchant went to last time', async () => {
    const made = await workspace();
    const { database, ws, card, income, cafe } = made;
    await postTransaction(database, ws, {
      occurredOn: '2026-10-20',
      description: 'STORE.EXAMPLE/BILL',
      lines: expenseLines({ categoryAccountId: cafe, paymentAccountId: card, amountMinor: 31_000, currency: 'IDR' }),
    });
    await ingestCaptures(database, ws, [mail('mail-old', CARD_EMAIL)], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    await asReadBefore(database, draft!.id, { categoryAccountId: income });

    await rereadUnreadDrafts(database, { today: DAY });

    expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'expense', amountMinor: 27_500, categoryAccountId: cafe });
  });

  it('clears an income category when the merchant has no spending to go by', async () => {
    const { database, ws } = await misread({ categoryAccountId: (made) => made.income });
    await rereadUnreadDrafts(database, { today: DAY });
    expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'expense', categoryAccountId: null });
  });

  it('keeps an account the owner chose by hand', async () => {
    const { database, ws, id } = await misread();
    const bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await editDraft(database, ws, id, { accountId: bank.id });

    await rereadUnreadDrafts(database, { today: DAY });

    expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'expense', amountMinor: 27_500, accountId: bank.id, cardId: null });
  });

  it('changes nothing the second time', async () => {
    const { database, id } = await misread();
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(1);
    const once = await row(database, id);
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect(await row(database, id)).toEqual(once);
  });

  it('leaves a draft whose kind the owner changed', async () => {
    const { database, ws, id } = await misread();
    await editDraft(database, ws, id, { kind: 'transfer' });
    const before = await row(database, id);
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect(await row(database, id)).toEqual(before);
  });

  it('leaves a draft whose sign the owner turned', async () => {
    const { database, ws, id } = await misread();
    await editDraft(database, ws, id, { amountMinor: 27_500 });
    const before = await row(database, id);
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect(await row(database, id)).toEqual(before);
  });

  it('leaves a draft with no reading kept', async () => {
    const { database, id } = await misread();
    await database.db.update(draftTransactions).set({ readingJson: null }).where(eq(draftTransactions.id, id));
    const before = await row(database, id);
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect(await row(database, id)).toEqual(before);
  });

  it('never touches a draft that was dismissed or recorded', async () => {
    const dismissed = await misread();
    await dismissDraft(dismissed.database, dismissed.ws, dismissed.id);
    expect(await rereadUnreadDrafts(dismissed.database, { today: DAY })).toBe(0);
    expect(await row(dismissed.database, dismissed.id)).toMatchObject({ status: 'dismissed', kind: 'income', amountMinor: -27_500 });
    current?.executor.close();

    const posted = await misread({ categoryAccountId: (made) => made.income });
    await confirmDraft(posted.database, posted.ws, posted.id);
    expect(await rereadUnreadDrafts(posted.database, { today: DAY })).toBe(0);
    expect(await row(posted.database, posted.id)).toMatchObject({ status: 'confirmed', kind: 'income', amountMinor: -27_500 });
  });

  it('keeps money that did come in as income', async () => {
    const made = await workspace();
    const body = ['Mata Uang', 'Jumlah', 'IDR', '27,500', 'Dana telah masuk ke rekening Anda.'].join('\n');
    await ingestCaptures(made.database, made.ws, [mail('mail-in', body, 'Notifikasi')], { today: DAY });
    const [draft] = await listDrafts(made.database, made.ws);
    expect(draft).toMatchObject({ kind: 'income', amountMinor: -27_500 });
    const before = await row(made.database, draft!.id);

    expect(await rereadUnreadDrafts(made.database, { today: DAY })).toBe(0);
    expect(await row(made.database, draft!.id)).toEqual(before);
  });
});
