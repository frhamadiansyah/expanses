import type { RawCapture } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { setSourceAccount, sourceFor } from '../src/capture/sources';
import {
  addCard,
  confirmDraft,
  createAccount,
  createCardAccount,
  type Database,
  DraftError,
  editDraft,
  listAccounts,
  listDrafts,
  listTransactions,
  type WorkspaceContext,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * A capture read in a currency its paying account does not hold — a bank's message for a purchase abroad, in the
 * merchant's own figure. The draft keeps what was read; recording it posts what the account was charged, in the
 * account's currency, with the read figure beside it as a foreign purchase typed on the Add form is kept.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const DAY = new Date().toISOString().slice(0, 10);

const sms = (id: string, body: string): RawCapture => ({
  id,
  kind: 'notification',
  capturedAt: '2026-11-03T14:23:00+07:00',
  app: 'BANKCONTOH',
  title: 'BANKCONTOH',
  body,
  lines: [],
  imageFile: null,
});

const ABROAD = 'Terima kasih utk trx kartukredit XXXX5512 tgl 03-11-2026 14:22:07 di TOKO KOPI CONTOH KRW94.300,00. Jika trx tidak Anda kenal, hub 10000';

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Travel card', subtype: 'credit_card', currency: 'IDR' });
  await addCard(database, ws, { accountId: card.id, last4: '5512' });
  const bank = (await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const wallet = (await createAccount(database, ws, { name: 'Pay wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' })).id;
  const all = await listAccounts(database, ws);
  const cafe = all.find((a) => a.kind === 'expense')!.id;
  const income = all.find((a) => a.kind === 'income')!.id;
  return { database, ws, card: card.id, bank, wallet, cafe, income };
}

async function answer(database: Database, ws: WorkspaceContext, capture: RawCapture, accountId: string) {
  const source = await sourceFor(database.db, capture);
  await setSourceAccount(database, source.id, accountId, ws.workspaceId);
}

const posted = async (database: Database, ws: WorkspaceContext, id: string) => (await listTransactions(database, ws, { id }))[0]!;

describe('a draft read in a currency its account does not hold', () => {
  it('arrives in the merchant’s own figure, on the card the message names', async () => {
    const { database, ws, card } = await workspace();
    await ingestCaptures(database, ws, [sms('sms-abroad', ABROAD)], { today: DAY });

    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'expense', amountMinor: 94_300, currency: 'KRW', exactHundredths: null, accountId: card, occurredOn: '2026-11-03', description: 'TOKO KOPI CONTOH' });
  });

  it('is recorded as what the card was charged, in the card’s currency, with the read figure kept beside it', async () => {
    const { database, ws, card, cafe } = await workspace();
    await ingestCaptures(database, ws, [sms('sms-abroad', ABROAD)], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    await editDraft(database, ws, draft!.id, { categoryAccountId: cafe });

    const { transactionId } = await confirmDraft(database, ws, draft!.id, { charged: { amountMinor: 1_034_500 } });

    const tx = await posted(database, ws, transactionId);
    expect(tx).toMatchObject({ originalCurrency: 'KRW', originalAmountMinor: 94_300, exactHundredths: null, occurredOn: '2026-11-03' });
    expect(tx.entries.map((e) => ({ accountId: e.accountId, amountMinor: e.amountMinor, currency: e.currency })).sort((a, b) => a.amountMinor - b.amountMinor)).toEqual([
      { accountId: card, amountMinor: -1_034_500, currency: 'IDR' },
      { accountId: cafe, amountMinor: 1_034_500, currency: 'IDR' },
    ]);
    // The draft keeps what was read: a second sighting of the same message is still matched against it.
    const [done] = await listDrafts(database, ws, 'confirmed');
    expect(done).toMatchObject({ amountMinor: 94_300, currency: 'KRW', transactionId });
  });

  it('is not recorded without the charged figure, and says which figure is missing', async () => {
    const { database, ws, cafe } = await workspace();
    await ingestCaptures(database, ws, [sms('sms-abroad', ABROAD)], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    await editDraft(database, ws, draft!.id, { categoryAccountId: cafe });

    const refused = await confirmDraft(database, ws, draft!.id).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(DraftError);
    expect(refused).toMatchObject({ code: 'NO_CHARGED_AMOUNT', message: 'Enter the amount charged in IDR' });
    for (const amountMinor of [0, -5, 1.5]) {
      await expect(confirmDraft(database, ws, draft!.id, { charged: { amountMinor } })).rejects.toMatchObject({ code: 'NO_CHARGED_AMOUNT' });
    }
    // Nothing was posted, and the draft still waits.
    expect(await listTransactions(database, ws)).toHaveLength(0);
    expect(await listDrafts(database, ws)).toHaveLength(1);
  });

  it('posts the cents typed on the charged figure, never the cents read on the foreign one', async () => {
    const { database, ws, cafe } = await workspace();
    await ingestCaptures(database, ws, [sms('sms-cents', ABROAD.replace('KRW94.300,00', 'KRW94.300,40'))], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ amountMinor: 94_301, currency: 'KRW', exactHundredths: 9_430_040 });
    await editDraft(database, ws, draft!.id, { categoryAccountId: cafe });

    const whole = await confirmDraft(database, ws, draft!.id, { charged: { amountMinor: 1_034_500 } });
    expect(await posted(database, ws, whole.transactionId)).toMatchObject({ exactHundredths: null, originalAmountMinor: 94_301 });
  });

  it('posts the charged figure’s own cents when it was typed with them', async () => {
    const { database, ws, cafe } = await workspace();
    await ingestCaptures(database, ws, [sms('sms-abroad', ABROAD)], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    await editDraft(database, ws, draft!.id, { categoryAccountId: cafe });

    const { transactionId } = await confirmDraft(database, ws, draft!.id, { charged: { amountMinor: 1_034_501, exactHundredths: 103_450_025 } });
    expect(await posted(database, ws, transactionId)).toMatchObject({ exactHundredths: 103_450_025, originalCurrency: 'KRW' });
  });

  it('records money received in another currency as what arrived in the account', async () => {
    const { database, ws, bank, income } = await workspace();
    const note = sms('note-in', 'Dana masuk USD 120.00 dari PT CONTOH JAYA');
    await answer(database, ws, note, bank);
    await ingestCaptures(database, ws, [note], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'income', amountMinor: -12_000, currency: 'USD', accountId: bank });
    await editDraft(database, ws, draft!.id, { categoryAccountId: income });

    const { transactionId } = await confirmDraft(database, ws, draft!.id, { charged: { amountMinor: 1_950_000 } });
    const tx = await posted(database, ws, transactionId);
    expect(tx).toMatchObject({ originalCurrency: 'USD', originalAmountMinor: 12_000 });
    expect(tx.entries.find((e) => e.accountId === bank)).toMatchObject({ amountMinor: 1_950_000, currency: 'IDR' });
  });

  it('refuses a transfer read in another currency in plain words: its figure is the From account’s own', async () => {
    const { database, ws, bank, wallet } = await workspace();
    const note = sms('note-topup', 'Top up saldo SGD 50.00 berhasil');
    await answer(database, ws, note, wallet);
    await ingestCaptures(database, ws, [note], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'transfer', currency: 'SGD', toAccountId: wallet });
    await editDraft(database, ws, draft!.id, { accountId: bank });

    await expect(confirmDraft(database, ws, draft!.id, { charged: { amountMinor: 600_000 } })).rejects.toMatchObject({
      code: 'TRANSFER_CURRENCY',
      message: 'Enter the transfer amount in IDR',
    });
    // Written in the account's own currency, as the form shows it, it records as any transfer does.
    await editDraft(database, ws, draft!.id, { amountMinor: 600_000, currency: 'IDR' });
    const { transactionId } = await confirmDraft(database, ws, draft!.id);
    expect((await posted(database, ws, transactionId)).originalCurrency).toBeNull();
  });

  it('leaves a draft in its account’s own currency exactly as it was, whatever charged figure comes with it', async () => {
    const { database, ws, card, cafe } = await workspace();
    await ingestCaptures(database, ws, [sms('sms-home', ABROAD.replace('KRW94.300,00', 'IDR48.300,00'))], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    await editDraft(database, ws, draft!.id, { categoryAccountId: cafe });

    const { transactionId } = await confirmDraft(database, ws, draft!.id, { charged: { amountMinor: 999 } });
    const tx = await posted(database, ws, transactionId);
    expect(tx).toMatchObject({ originalCurrency: null, originalAmountMinor: null });
    expect(tx.entries.find((e) => e.accountId === card)).toMatchObject({ amountMinor: -48_300, currency: 'IDR' });
  });
});
