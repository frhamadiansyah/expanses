import type { RawCapture, Reading } from '@expanses/core';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { rereadUnreadDrafts } from '../src/capture/reread';
import { addCard, createCardAccount, type Database, dismissDraft, editDraft, listAccounts, listDrafts } from '../src/index';
import { draftTransactions } from '../src/schema-drafts';
import { setupDb, type TestDb } from './helpers';

/*
 * A message whose figure an earlier reader could not read waits in the queue at 0, with its words. Once the reader
 * can read it, the draft is read again where it stands — and nothing the owner put on it is touched.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const DAY = new Date().toISOString().slice(0, 10);

const sms = (id: string, body: string, over: Partial<RawCapture> = {}): RawCapture => ({
  id,
  kind: 'notification',
  // The message arrived after midnight: the day it was noticed is not the day it prints.
  capturedAt: '2026-11-04T00:10:00+07:00',
  app: 'BANKCONTOH',
  title: 'BANKCONTOH',
  body,
  lines: [],
  imageFile: null,
  ...over,
});

const ABROAD = 'Terima kasih utk trx kartukredit XXXX5512 tgl 03-11-2026 14:22:07 di TOKO KOPI CONTOH KRW94.300,00. Jika trx tidak Anda kenal, hub 10000';

/** What the reader that knew no won made of such a message: nothing but the card. */
const UNREAD: Reading = {
  skipped: 'unreadable',
  amount: null,
  occurredAt: null,
  type: { value: 'spent', confidence: 0, line: null },
  name: null,
  accountHint: '5512',
  paymentMethod: null,
};

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Travel card', subtype: 'credit_card', currency: 'IDR' });
  await addCard(database, ws, { accountId: card.id, last4: '5512' });
  const cafe = (await listAccounts(database, ws)).find((a) => a.kind === 'expense')!.id;
  return { database, ws, card: card.id, cafe };
}

/** Puts a draft back as the earlier reader left it: spending of no figure, the sender for a name, the day it was noticed. */
async function asReadBefore(database: Database, id: string) {
  await database.db
    .update(draftTransactions)
    .set({ kind: 'expense', amountMinor: 0, currency: 'IDR', description: 'BANKCONTOH', occurredOn: '2026-11-04', confidence: null, readingJson: JSON.stringify(UNREAD) })
    .where(eq(draftTransactions.id, id));
  await database.db.run(sql`UPDATE draft_transactions SET exact_hundredths = NULL WHERE id = ${id}`);
}

/** One such draft waiting in the queue, as it sat on a phone before the reader learned the currency. */
async function unread(body = ABROAD, id = 'sms-abroad') {
  const made = await workspace();
  await ingestCaptures(made.database, made.ws, [sms(id, body)], { today: DAY });
  const [draft] = await listDrafts(made.database, made.ws);
  await asReadBefore(made.database, draft!.id);
  return { ...made, id: draft!.id };
}

const row = async (database: Database, id: string) => (await database.db.select().from(draftTransactions).where(eq(draftTransactions.id, id)))[0]!;

describe('a draft that was read as nothing, read again', () => {
  it('takes the figure, its currency, the merchant and the printed day, and keeps the account it was filed on', async () => {
    const { database, ws, card, id } = await unread();
    expect((await listDrafts(database, ws))[0]).toMatchObject({ amountMinor: 0, currency: 'IDR', description: 'BANKCONTOH' });

    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(1);

    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({
      id,
      kind: 'expense',
      status: 'pending',
      amountMinor: 94_300,
      currency: 'KRW',
      exactHundredths: null,
      description: 'TOKO KOPI CONTOH',
      occurredOn: '2026-11-03',
      accountId: card,
      externalRef: 'capture:sms-abroad',
    });
    // The reading it now carries is the new one, and how sure it is of the figure with it.
    expect(draft!.reading?.amount?.value).toEqual({ minor: 94_300, currency: 'KRW' });
    expect(draft!.confidence).toBe(draft!.reading!.amount!.confidence);
  });

  it('keeps the cents of a figure printed with them, rounded up for money out', async () => {
    const { database, ws } = await unread(ABROAD.replace('KRW94.300,00', 'KRW94.300,40'), 'sms-cents');
    await rereadUnreadDrafts(database, { today: DAY });
    expect((await listDrafts(database, ws))[0]).toMatchObject({ amountMinor: 94_301, currency: 'KRW', exactHundredths: 9_430_040 });
  });

  it('changes nothing the second time', async () => {
    const { database, id } = await unread();
    await rereadUnreadDrafts(database, { today: DAY });
    const once = await row(database, id);
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect(await row(database, id)).toEqual(once);
  });

  it('leaves the category, the note and the day the owner put on it, and still fills the figure nobody typed', async () => {
    const { database, ws, cafe, id } = await unread();
    await editDraft(database, ws, id, { categoryAccountId: cafe, description: 'Kopi sama teman', occurredOn: '2026-11-02' });

    await rereadUnreadDrafts(database, { today: DAY });

    expect((await listDrafts(database, ws))[0]).toMatchObject({
      amountMinor: 94_300,
      currency: 'KRW',
      categoryAccountId: cafe,
      description: 'Kopi sama teman',
      occurredOn: '2026-11-02',
    });
  });

  it('never touches a draft that has a figure, whoever put it there', async () => {
    const { database, ws, id } = await unread();
    await editDraft(database, ws, id, { amountMinor: 1_050_000 });
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect((await listDrafts(database, ws))[0]).toMatchObject({ amountMinor: 1_050_000, currency: 'IDR', description: 'BANKCONTOH' });
  });

  it('never touches a figure the owner emptied: only a zero the reader left is read again', async () => {
    const { database, ws } = await workspace();
    await ingestCaptures(database, ws, [sms('sms-abroad', ABROAD)], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    // Read whole by today's reader, then set to nothing by hand.
    await editDraft(database, ws, draft!.id, { amountMinor: 0, currency: 'IDR' });

    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect((await listDrafts(database, ws))[0]).toMatchObject({ amountMinor: 0, currency: 'IDR' });
  });

  it('passes over a draft that was dealt with, one whose words are gone, and one that is not a message', async () => {
    const { database, ws, id } = await unread();
    await dismissDraft(database, ws, id);
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);

    const gone = await unread();
    await gone.database.db.update(draftTransactions).set({ rawPayload: null }).where(eq(draftTransactions.id, gone.id));
    expect(await rereadUnreadDrafts(gone.database, { today: DAY })).toBe(0);

    const screen = await unread();
    await screen.database.db.update(draftTransactions).set({ source: 'screen' }).where(eq(draftTransactions.id, screen.id));
    expect(await rereadUnreadDrafts(screen.database, { today: DAY })).toBe(0);
    expect((await row(screen.database, screen.id)).amountMinor).toBe(0);
  });

  it('leaves a message alone when it still says no figure', async () => {
    const { database, ws, id } = await unread('Terima kasih utk trx kartukredit XXXX5512 tgl 03-11-2026 14:22:07 di TOKO KOPI CONTOH. Jika trx tidak Anda kenal, hub 10000', 'sms-none');
    const before = await row(database, id);
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect(await row(database, id)).toEqual(before);
    expect((await listDrafts(database, ws))[0]!.amountMinor).toBe(0);
  });

  it('leaves a message alone when it now reads as something else than the draft is', async () => {
    // Filed as spending by the reader that read nothing; it is money received, which is another draft altogether.
    const { database, id } = await unread('Dana masuk KRW 94.300 dari PT CONTOH JAYA ke kartu XXXX5512', 'sms-in');
    expect(await rereadUnreadDrafts(database, { today: DAY })).toBe(0);
    expect(await row(database, id)).toMatchObject({ kind: 'expense', amountMinor: 0 });
  });
});
