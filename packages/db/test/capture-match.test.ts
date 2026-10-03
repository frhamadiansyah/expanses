import { expenseLines } from '@expanses/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { findMatch, makeTransferPair, mergeInto, unmerge } from '../src/capture/match';
import { insertDraftRow } from '../src/repos/drafts';
import {
  captureDrafts,
  confirmDraft,
  countPendingDrafts,
  createAccount,
  createDraft,
  dismissDraft,
  listAccounts,
  listDrafts,
  type NewDraft,
  postTransaction,
} from '../src/index';
import { draftTransactions } from '../src/schema-drafts';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const MINUTE = 60_000;

/** When a capture arrived, read off the phone's own clock — which is what an arriving capture carries. */
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const wallet = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((account) => account.systemKey === 'household.groceries')!;
  /** What a bank notification about money leaving the bank became. */
  const draft = (over: Partial<NewDraft> = {}): NewDraft => ({
    source: 'notification',
    occurredOn: '2026-09-29',
    description: 'KOPI KENANGAN',
    amountMinor: 38_000,
    currency: 'IDR',
    accountId: bank.id,
    captureIds: ['c-1'],
    ...over,
  });
  /** The queue after one capture: the row itself, made the way the ingest pipeline makes it. */
  const queued = async (over: Partial<NewDraft> = {}) => {
    await captureDrafts(database, ws, [draft(over)]);
    return (await listDrafts(database, ws)).at(-1)!;
  };
  return { database, ws, bank, wallet, groceries, draft, queued };
}

describe('what an arriving capture turns out to be', () => {
  it('reads one payment seen in a notification and in a screenshot as the same draft', async () => {
    const { database, ws, bank, queued } = await workspace();
    const first = await queued();

    const match = await findMatch(database.db, ws, {
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      direction: 'out',
      at: minutesFromNow(3),
    });

    expect(match).toEqual({ kind: 'same-draft', draftId: first.id });
  });

  it('leaves two coffees of the same price two hours apart as two drafts', async () => {
    const { database, ws, bank, queued } = await workspace();
    await queued();

    // The same amount in the same day is not the same payment: a window has to hold, or every second coffee disappears.
    const match = await findMatch(database.db, ws, {
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      direction: 'out',
      at: minutesFromNow(120),
    });

    expect(match).toEqual({ kind: 'none' });
  });

  it('pairs money leaving one account with the same money arriving in another', async () => {
    const { database, ws, bank, wallet, queued } = await workspace();
    const out = await queued({ amountMinor: 200_000, captureIds: ['c-out'] });

    const match = await findMatch(database.db, ws, {
      amountMinor: -200_000,
      currency: 'IDR',
      accountId: wallet.id,
      direction: 'in',
      at: minutesFromNow(40),
    });

    expect(match).toEqual({ kind: 'transfer-pair', draftId: out.id });
  });

  it('does not pair when the same account is on both sides', async () => {
    const { database, ws, bank, queued } = await workspace();
    await queued({ amountMinor: 200_000 });

    const match = await findMatch(database.db, ws, {
      amountMinor: -200_000,
      currency: 'IDR',
      accountId: bank.id,
      direction: 'in',
      at: minutesFromNow(5),
    });

    expect(match).toEqual({ kind: 'none' });
  });

  it('knows a payment that was already recorded from a capture', async () => {
    const { database, ws, bank, groceries, queued } = await workspace();
    const draft = await queued({ categoryAccountId: groceries.id });
    const { transactionId } = await confirmDraft(database, ws, draft.id);

    const match = await findMatch(database.db, ws, {
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      direction: 'out',
      at: minutesFromNow(5),
    });

    expect(match).toEqual({ kind: 'recorded', transactionId, draftId: draft.id });
  });

  it('keeps a second coffee bought after the first was recorded, however soon after the recording', async () => {
    const { database, ws, bank, groceries, draft } = await workspace();
    // The first coffee was captured two hours ago and recorded just now.
    const firstId = await insertDraftRow(database.db, ws, draft({ categoryAccountId: groceries.id }), minutesFromNow(-120));
    await confirmDraft(database, ws, firstId);

    const match = await findMatch(database.db, ws, {
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      direction: 'out',
      at: minutesFromNow(5),
    });

    expect(match).toEqual({ kind: 'none' });
  });

  it('does not call a capture of an unknown account already recorded', async () => {
    const { database, ws, groceries, queued } = await workspace();
    const first = await queued({ categoryAccountId: groceries.id });
    await confirmDraft(database, ws, first.id);

    const match = await findMatch(database.db, ws, {
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: null,
      direction: 'out',
      at: minutesFromNow(3),
    });

    expect(match).toEqual({ kind: 'none' });
  });

  it('offers to link a payment the owner had already typed in, and never merges it', async () => {
    const { database, ws, bank, groceries } = await workspace();
    const at = minutesFromNow(-30);
    const transactionId = await postTransaction(database, ws, {
      occurredOn: dayOf(at),
      description: 'KOPI KENANGAN',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bank.id, amountMinor: 38_000, currency: 'IDR' }),
    });

    const match = await findMatch(database.db, ws, {
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      direction: 'out',
      at,
    });

    expect(match).toEqual({ kind: 'hand-entered', transactionId });
  });

  it('never matches across a currency', async () => {
    const { database, ws, bank, queued } = await workspace();
    await queued({ currency: 'USD' });

    const match = await findMatch(database.db, ws, {
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      direction: 'out',
      at: minutesFromNow(3),
    });

    expect(match).toEqual({ kind: 'none' });
  });
});

describe('merging a payment seen twice', () => {
  it('keeps one row in the queue, carries both captures, and fills in what the first reading did not know', async () => {
    const { database, ws, bank, queued } = await workspace();
    const first = await queued({ accountId: null, captureIds: ['c-1'] });

    await mergeInto(database.db, ws, first.id, {
      source: 'screen',
      occurredOn: '2026-09-29',
      description: 'KOPI KENANGAN',
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      captureId: 'c-2',
      confidence: 92,
    });

    const rows = await listDrafts(database, ws);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, accountId: bank.id, confidence: 92, captureIds: ['c-1', 'c-2'] });
    // The queue is what the badge counts, and the second capture is not a second thing to do.
    expect(await countPendingDrafts(database, ws)).toBe(1);
  });

  it('keeps the picture it already had', async () => {
    const { database, ws, queued } = await workspace();
    const first = await queued({ imageFile: 'captures/a.png' });

    await mergeInto(database.db, ws, first.id, {
      source: 'screen',
      occurredOn: '2026-09-29',
      description: 'KOPI KENANGAN',
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: null,
      captureId: 'c-2',
      imageFile: 'captures/b.png',
    });

    expect((await listDrafts(database, ws))[0]).toMatchObject({ imageFile: 'captures/a.png' });
  });

  it('splits the capture that arrived last back into its own draft', async () => {
    const { database, ws, queued } = await workspace();
    const first = await queued({ imageFile: 'captures/a.png' });
    await mergeInto(database.db, ws, first.id, {
      source: 'screen',
      occurredOn: '2026-09-29',
      description: 'KOPI KENANGAN',
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: null,
      captureId: 'c-2',
      imageFile: 'captures/b.png',
      externalRef: 'capture:c-2',
    });

    const splitId = await unmerge(database, ws, first.id);

    const rows = await listDrafts(database, ws);
    expect(rows.map((row) => [row.id, row.captureIds])).toEqual([
      [first.id, ['c-1']],
      [splitId, ['c-2']],
    ]);
    // Each capture is its own draft again, with the picture it came with and a ref of its own.
    expect(rows[1]).toMatchObject({ imageFile: 'captures/b.png', externalRef: 'capture:c-2' });
    expect(await countPendingDrafts(database, ws)).toBe(2);
  });

  it('brings a draft merged before this build back by writing the row it never had', async () => {
    const { database, ws, queued } = await workspace();
    const survivor = await queued({ captureIds: ['c-1', 'c-2'] });

    // What a merge that only appended the capture id left behind: no row to bring back.
    const splitId = await unmerge(database, ws, survivor.id);

    const rows = await listDrafts(database, ws);
    expect(rows.map((row) => [row.id, row.captureIds])).toEqual([
      [survivor.id, ['c-1']],
      [splitId, ['c-2']],
    ]);
  });

  it('refuses to split a draft that was read from one capture', async () => {
    const { database, ws, queued } = await workspace();
    const only = await queued();

    await expect(unmerge(database, ws, only.id)).rejects.toThrow(/one capture/i);
  });

  it('refuses to merge into a draft that is no longer waiting', async () => {
    const { database, ws } = await workspace();
    const done = await createDraft(database, ws, {
      source: 'manual',
      occurredOn: '2026-09-29',
      description: 'KOPI KENANGAN',
      amountMinor: 38_000,
      currency: 'IDR',
    });
    await dismissDraft(database, ws, done);

    await expect(
      mergeInto(database.db, ws, done, {
        source: 'notification',
        occurredOn: '2026-09-29',
        description: 'KOPI KENANGAN',
        amountMinor: 38_000,
        currency: 'IDR',
        captureId: 'c-2',
      }),
    ).rejects.toThrow(/not waiting/i);
  });
});

describe('one movement seen from both sides', () => {
  it('turns the pair into a transfer between the two accounts', async () => {
    const { database, ws, bank, wallet, queued } = await workspace();
    const out = await queued({ amountMinor: 200_000, captureIds: ['c-out'] });
    const at = minutesFromNow(40);

    await makeTransferPair(database.db, ws, out.id, {
      source: 'notification',
      occurredOn: dayOf(at),
      description: 'Top up GoPay',
      amountMinor: -200_000,
      currency: 'IDR',
      accountId: wallet.id,
      captureId: 'c-in',
    });

    const rows = await listDrafts(database, ws);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: out.id,
      kind: 'transfer',
      accountId: bank.id,
      toAccountId: wallet.id,
      amountMinor: 200_000,
      captureIds: ['c-out', 'c-in'],
    });
  });

  it('starts from the arriving side when that is the one that left', async () => {
    const { database, ws, bank, wallet, queued } = await workspace();
    // The wallet's own notification about money arriving comes first; the bank's debit arrives second.
    const topUp = await queued({ amountMinor: -200_000, accountId: wallet.id, captureIds: ['c-in'] });

    await makeTransferPair(database.db, ws, topUp.id, {
      source: 'notification',
      occurredOn: '2026-09-29',
      description: 'Transfer GoPay',
      amountMinor: 200_000,
      currency: 'IDR',
      accountId: bank.id,
      captureId: 'c-out',
    });

    expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'transfer', accountId: bank.id, toAccountId: wallet.id, amountMinor: 200_000 });
  });

  it('gives the two sides back when a transfer is unmerged', async () => {
    const { database, ws, bank, wallet, queued } = await workspace();
    const out = await queued({ amountMinor: 200_000, captureIds: ['c-out'] });
    await makeTransferPair(database.db, ws, out.id, {
      source: 'notification',
      occurredOn: '2026-09-29',
      description: 'Top up GoPay',
      amountMinor: -200_000,
      currency: 'IDR',
      accountId: wallet.id,
      captureId: 'c-in',
    });

    const splitId = await unmerge(database, ws, out.id);

    const rows = await listDrafts(database, ws);
    const from = rows.find((row) => row.id === out.id)!;
    const to = rows.find((row) => row.id === splitId)!;
    expect(from).toMatchObject({ kind: 'expense', accountId: bank.id, toAccountId: null, amountMinor: 200_000 });
    expect(to).toMatchObject({ kind: 'income', accountId: wallet.id, amountMinor: -200_000, captureIds: ['c-in'] });
  });

  it('refuses to pair with the account it is already on', async () => {
    const { database, ws, bank, queued } = await workspace();
    const out = await queued({ amountMinor: 200_000, captureIds: ['c-out'] });

    await expect(
      makeTransferPair(database.db, ws, out.id, {
        source: 'notification',
        occurredOn: '2026-09-29',
        description: 'Top up',
        amountMinor: -200_000,
        currency: 'IDR',
        accountId: bank.id,
        captureId: 'c-in',
      }),
    ).rejects.toThrow(/two different accounts/i);
    expect((await listDrafts(database, ws))[0]).toMatchObject({ kind: 'expense' });
  });

  it('leaves a hidden draft out of the queue but keeps it for the split', async () => {
    const { database, ws, bank, wallet, queued } = await workspace();
    const out = await queued({ amountMinor: 200_000, captureIds: ['c-out'] });
    await makeTransferPair(database.db, ws, out.id, {
      source: 'notification',
      occurredOn: '2026-09-29',
      description: 'Top up GoPay',
      amountMinor: -200_000,
      currency: 'IDR',
      accountId: wallet.id,
      captureId: 'c-in',
    });

    const hidden = await database.db.select().from(draftTransactions).where(eq(draftTransactions.mergedInto, out.id));
    expect(hidden).toHaveLength(1);
    expect(await listDrafts(database, ws)).toHaveLength(1);
    // The second capture's own draft is what comes back if the pair is undone, so it is kept as it arrived.
    expect(hidden[0]).toMatchObject({ status: 'pending', accountId: wallet.id, captureIds: JSON.stringify(['c-in']) });
  });

  it('gives a top-up that arrived first back as a top-up, and the bank debit back as spending', async () => {
    const { database, ws, bank, wallet, queued } = await workspace();
    const topUp = await queued({
      kind: 'transfer',
      amountMinor: -200_000,
      accountId: null,
      toAccountId: wallet.id,
      captureIds: ['c-in'],
      reading: {
        skipped: null,
        amount: { value: { minor: 200_000, currency: 'IDR' }, confidence: 85, line: null },
        occurredAt: null,
        type: { value: 'topup', confidence: 85, line: null },
        name: null,
        accountHint: null,
        paymentMethod: null,
      },
    });
    await makeTransferPair(database.db, ws, topUp.id, {
      source: 'notification',
      occurredOn: '2026-09-29',
      description: 'Transfer GoPay',
      amountMinor: 200_000,
      currency: 'IDR',
      kind: 'expense',
      accountId: bank.id,
      captureId: 'c-out',
    });

    const splitId = await unmerge(database, ws, topUp.id);

    const rows = await listDrafts(database, ws);
    expect(rows.find((row) => row.id === topUp.id)).toMatchObject({
      kind: 'transfer',
      accountId: null,
      toAccountId: wallet.id,
      amountMinor: -200_000,
      captureIds: ['c-in'],
    });
    expect(rows.find((row) => row.id === splitId)).toMatchObject({
      kind: 'expense',
      accountId: bank.id,
      toAccountId: null,
      amountMinor: 200_000,
      captureIds: ['c-out'],
    });
  });

  it('splits a pair with a third sighting into its two sides, keeping the sighting with its own side', async () => {
    const { database, ws, bank, wallet, queued } = await workspace();
    const out = await queued({ amountMinor: 200_000, captureIds: ['c-out'] });
    await mergeInto(database.db, ws, out.id, {
      source: 'screen',
      occurredOn: '2026-09-29',
      description: 'Transfer',
      amountMinor: 200_000,
      currency: 'IDR',
      accountId: bank.id,
      captureId: 'c-shot',
    });
    await makeTransferPair(database.db, ws, out.id, {
      source: 'notification',
      occurredOn: '2026-09-29',
      description: 'Top up GoPay',
      amountMinor: -200_000,
      currency: 'IDR',
      accountId: wallet.id,
      captureId: 'c-in',
    });

    const splitId = await unmerge(database, ws, out.id);

    const rows = await listDrafts(database, ws);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === out.id)).toMatchObject({ kind: 'expense', accountId: bank.id, amountMinor: 200_000, captureIds: ['c-out', 'c-shot'] });
    expect(rows.find((row) => row.id === splitId)).toMatchObject({ kind: 'income', accountId: wallet.id, amountMinor: -200_000, captureIds: ['c-in'] });
  });
});
