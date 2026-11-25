import type { RawCapture } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ingestCaptures } from '../src/capture/ingest';
import { setSourceAccount, sourceFor } from '../src/capture/sources';
import { listDrafts, openCashAccount } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

// Invented names and figures: no real person's message.
const sent = (to: string, id = 'sent-1', body = `Rp200.000 udah dikirim ke ${to}.`, title = 'Transfer berhasil'): RawCapture => ({
  id,
  kind: 'notification',
  capturedAt: '2026-11-25T09:30:00+07:00',
  app: 'com.example.wallet',
  title,
  body,
  lines: [],
  imageFile: null,
});

async function setup(banks: { name: string; bank: string; item?: 'bank' | 'savings'; currency?: string }[]) {
  current = await setupDb();
  const { database, ws } = current;
  const wallet = await openCashAccount(database, ws, { item: 'ewallet', name: 'Pay wallet', currency: 'IDR' });
  const opened = [];
  for (const one of banks) opened.push(await openCashAccount(database, ws, { item: one.item ?? 'bank', name: one.name, bank: one.bank, currency: one.currency ?? 'IDR' }));
  const source = await sourceFor(database.db, sent('X'));
  await setSourceAccount(database, source.id, wallet.id, ws.workspaceId);
  return { database, ws, wallet, opened };
}

describe('money a wallet sent to a bank account', () => {
  it('is a transfer to the one current account at that bank', async () => {
    const { database, ws, wallet, opened } = await setup([
      { name: 'Everyday', bank: 'Bank Mandiri' },
      { name: 'Tahapan', bank: 'Bank Central Asia' },
    ]);
    await ingestCaptures(database, ws, [sent('MANDIRI RANI KUSUMA DEWI')], { today: '2026-11-25' });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'transfer', accountId: wallet.id, toAccountId: opened[0]!.id, amountMinor: 200_000, currency: 'IDR', categoryAccountId: null });
  });

  it('reads the bank by its short name: BCA, BNI', async () => {
    const { database, ws, opened } = await setup([
      { name: 'Everyday', bank: 'Bank Mandiri' },
      { name: 'Tahapan', bank: 'Bank Central Asia' },
      { name: 'Taplus', bank: 'Bank Negara Indonesia' },
    ]);
    await ingestCaptures(database, ws, [sent('BCA RANI KUSUMA DEWI', 'a'), sent('', 'b', 'Rp150.000 udah dikirim ke BNI RANI KUSUMA DEWI.')], { today: '2026-11-25' });
    const drafts = await listDrafts(database, ws);
    expect(drafts.map((d) => d.toAccountId).sort()).toEqual([opened[1]!.id, opened[2]!.id].sort());
    expect(drafts.every((d) => d.kind === 'transfer')).toBe(true);
  });

  it('leaves the destination blank when two current accounts are at that bank', async () => {
    const { database, ws, wallet } = await setup([
      { name: 'Everyday', bank: 'Bank Mandiri' },
      { name: 'Bills', bank: 'Bank Mandiri' },
    ]);
    await ingestCaptures(database, ws, [sent('MANDIRI RANI KUSUMA DEWI')], { today: '2026-11-25' });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'transfer', accountId: wallet.id, toAccountId: null, amountMinor: 200_000 });
  });

  it('counts only current accounts in that currency', async () => {
    const { database, ws, opened } = await setup([
      { name: 'Everyday', bank: 'Bank Mandiri' },
      { name: 'Saver', bank: 'Bank Mandiri', item: 'savings' },
      { name: 'Dollars', bank: 'Bank Mandiri', currency: 'USD' },
    ]);
    await ingestCaptures(database, ws, [sent('MANDIRI RANI KUSUMA DEWI')], { today: '2026-11-25' });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'transfer', toAccountId: opened[0]!.id });
  });

  it('stays money spent at a bank the owner keeps no current account at', async () => {
    const { database, ws, wallet } = await setup([{ name: 'Everyday', bank: 'Bank Mandiri' }]);
    await ingestCaptures(database, ws, [sent('BRI BUDI SANTOSO')], { today: '2026-11-25' });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'expense', accountId: wallet.id, toAccountId: null });
  });

  it('stays money spent when the message says nothing was sent: a payment to a shop named like a bank', async () => {
    const { database, ws } = await setup([{ name: 'Everyday', bank: 'Bank Mandiri' }]);
    await ingestCaptures(database, ws, [sent('X', 'p', 'Pembayaran Rp38.000 ke MANDIRI KOPI berhasil.', 'Pembayaran berhasil')], { today: '2026-11-25' });
    const [draft] = await listDrafts(database, ws);
    expect(draft).toMatchObject({ kind: 'expense' });
  });
});
