import type { RawCapture } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { setSourceAccount, sourceFor } from '../src/capture/sources';
import {
  captureDrafts,
  confirmDraft,
  createAccount,
  createDraft,
  type Database,
  editDraft,
  importRows,
  listAccounts,
  listDrafts,
  listTransactions,
  type WorkspaceContext,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/* A figure with cents read from a capture or a statement (0068): the draft keeps it, and confirming posts it. */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const DAY = new Date().toISOString().slice(0, 10);

const note = (id: string, body: string): RawCapture => ({
  id,
  kind: 'notification',
  capturedAt: '2026-09-30T09:30:00+07:00',
  app: 'com.example.bank',
  title: 'Bank',
  body,
  lines: [],
  imageFile: null,
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = (await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const wallet = (await createAccount(database, ws, { name: 'Pay wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' })).id;
  const all = await listAccounts(database, ws);
  const groceries = all.find((a) => a.name === 'Groceries')!.id;
  const income = all.find((a) => a.kind === 'income')!.id;
  return { database, ws, bank, wallet, groceries, income };
}

async function answer(database: Database, ws: WorkspaceContext, capture: RawCapture, accountId: string) {
  const source = await sourceFor(database.db, capture);
  await setSourceAccount(database, source.id, accountId, ws.workspaceId);
}

const exactOf = async (database: Database, ws: WorkspaceContext, transactionId: string) => (await listTransactions(database, ws, { id: transactionId }))[0]!.exactHundredths;

describe('a captured figure with cents', () => {
  it('becomes a draft rounded up for money out, keeping the figure, and confirming posts both', async () => {
    const { database, ws, bank, groceries } = await workspace();
    await answer(database, ws, note('note-0', 'Pembayaran Rp1.000 berhasil. Merchant: TOKO KOPI'), bank);
    await ingestCaptures(database, ws, [note('note-1', 'Pembayaran Rp12.500,30 berhasil. Merchant: TOKO KOPI')], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'expense', amountMinor: 12_501, exactHundredths: 1_250_030 });

    await editDraft(database, ws, draft!.id, { categoryAccountId: groceries });
    const { transactionId } = await confirmDraft(database, ws, draft!.id);
    const [tx] = await listTransactions(database, ws, { id: transactionId });
    expect(tx!.entries.map((e) => e.amountMinor)).toEqual([12_501, -12_501]);
    expect(tx!.exactHundredths).toBe(1_250_030);
  });

  it('becomes a draft rounded down for money in', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, note('note-0', 'Uang masuk Rp150.000 dari ANDI'), bank);
    await ingestCaptures(database, ws, [note('note-in', 'Uang masuk Rp12.345,67 dari ANDI')], { today: DAY });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'income', amountMinor: -12_345, exactHundredths: 1_234_567 });
  });

  it('a whole figure has none', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, note('note-0', 'Pembayaran Rp1.000 berhasil. Merchant: TOKO KOPI'), bank);
    await ingestCaptures(database, ws, [note('note-1', 'Pembayaran Rp12.500 berhasil. Merchant: TOKO KOPI')], { today: DAY });
    expect((await listDrafts(database, ws))[0]).toMatchObject({ amountMinor: 12_500, exactHundredths: null });
  });
});

describe('a draft with an exact figure', () => {
  it('keeps it through an edit that leaves the figure, and loses it when the amount changes', async () => {
    const { database, ws, bank, groceries } = await workspace();
    const id = await createDraft(database, ws, { source: 'manual', occurredOn: DAY, description: 'Bakery', amountMinor: 12_501, currency: 'IDR', accountId: bank, exactHundredths: 1_250_030 });
    await editDraft(database, ws, id, { description: 'Bakery, two loaves', amountMinor: 12_501, currency: 'IDR', kind: 'expense', categoryAccountId: groceries });
    expect((await listDrafts(database, ws))[0]!.exactHundredths).toBe(1_250_030);
    await editDraft(database, ws, id, { amountMinor: 13_000 });
    expect((await listDrafts(database, ws))[0]!.exactHundredths).toBeNull();
    await editDraft(database, ws, id, { amountMinor: 13_001, exactHundredths: 1_300_050 });
    expect((await listDrafts(database, ws))[0]!.exactHundredths).toBe(1_300_050);
    const { transactionId } = await confirmDraft(database, ws, id);
    expect(await exactOf(database, ws, transactionId)).toBe(1_300_050);
  });

  it('a transfer leaves it behind: decimals go on a single amount only', async () => {
    const { database, ws, bank, wallet } = await workspace();
    const id = await createDraft(database, ws, {
      source: 'manual', kind: 'transfer', occurredOn: DAY, description: 'Top up', amountMinor: 12_501, currency: 'IDR', accountId: bank, toAccountId: wallet, exactHundredths: 1_250_030,
    });
    const { transactionId } = await confirmDraft(database, ws, id);
    expect(await exactOf(database, ws, transactionId)).toBeNull();
  });
});

describe('a statement row with cents', () => {
  it('imported straight, posts the exact figure beside the rounded amount', async () => {
    const { database, ws, bank, groceries, income } = await workspace();
    await importRows(database, ws, {
      accountId: bank,
      currency: 'IDR',
      rows: [
        { occurredOn: '2026-09-01', description: 'Bakery', amountMinor: 12_501, exactHundredths: 1_250_030, externalRef: 'csv:1', categoryAccountId: groceries },
        { occurredOn: '2026-09-02', description: 'Interest', amountMinor: -12_345, exactHundredths: 1_234_567, externalRef: 'csv:2', categoryAccountId: income },
        { occurredOn: '2026-09-03', description: 'Whole', amountMinor: 10_000, externalRef: 'csv:3', categoryAccountId: groceries },
      ],
    });
    const byName = Object.fromEntries((await listTransactions(database, ws)).map((tx) => [tx.description, tx.exactHundredths]));
    expect(byName).toEqual({ Bakery: 1_250_030, Interest: 1_234_567, Whole: null });
  });

  it('sent to Review, keeps it on the draft and posts it on confirming', async () => {
    const { database, ws, bank, groceries } = await workspace();
    await captureDrafts(database, ws, [
      { source: 'csv', occurredOn: '2026-09-01', description: 'Bakery', amountMinor: 12_501, exactHundredths: 1_250_030, currency: 'IDR', accountId: bank, categoryAccountId: groceries, externalRef: 'csv:1' },
    ]);
    const [draft] = await listDrafts(database, ws);
    expect(draft!.exactHundredths).toBe(1_250_030);
    const { transactionId } = await confirmDraft(database, ws, draft!.id);
    expect(await exactOf(database, ws, transactionId)).toBe(1_250_030);
  });
});
