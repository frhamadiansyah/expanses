import type { CaptureLine, RawCapture } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getCaptureScope, ingestCaptures, purgeCaptureLeftovers, purgeCaptures, setCaptureScope } from '../src/capture/ingest';
import { bringBack, listSkipped } from '../src/capture/skipped';
import { listSources, setSourceAccount, sourceFor } from '../src/capture/sources';
import {
  archiveAccount,
  confirmDraft,
  type Database,
  dismissDraft,
  editDraft,
  listAccounts,
  reopenDraft,
  listDrafts,
  countPendingDrafts,
  createAccount,
  createWorkspace,
  type WorkspaceContext,
  addCard,
  archiveCard,
  createCardAccount,
  listCards,
} from '../src/index';
import { captureSkipped, captureSources } from '../src/schema-capture';
import { eq } from 'drizzle-orm';
import { draftTransactions } from '../src/schema-drafts';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** A day offset from today, as the caller's own clock reads it. */
const daysFrom = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DAY = daysFrom(0);

const line = (text: string, y: number, height = 0.03): CaptureLine => ({ text, box: [0.1, y, 0.6, height], height });

const at = (time: string, over: Partial<RawCapture> = {}): RawCapture => ({
  id: `note-${time}`,
  kind: 'notification',
  capturedAt: `2026-09-30T${time}:00+07:00`,
  app: 'com.example.bank',
  title: 'Bank',
  body: 'Pembayaran Rp38.000 berhasil. Merchant: TOKO KOPI',
  lines: [],
  imageFile: null,
  ...over,
});

/** A screenshot of a payment, which knows its figure but not whose money it was. */
const shot = (figure: string, over: Partial<RawCapture> = {}): RawCapture => ({
  id: `shot-${figure}`,
  kind: 'screen',
  capturedAt: '2026-09-30T10:03:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: [line('Pay wallet', 0.02), line('Transaksi Berhasil', 0.06), line(`Total Rp${figure}`, 0.5, 0.04)],
  imageFile: `captures/${figure}.png`,
  ...over,
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const wallet = await createAccount(database, ws, { name: 'Pay wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
  return { database, ws, bank, wallet };
}

/** The owner answering "Which account is this?" once for a source: what every later capture of it relies on. */
async function answer(database: Database, ws: WorkspaceContext, capture: RawCapture, accountId: string) {
  const source = await sourceFor(database.db, capture);
  await setSourceAccount(database, source.id, accountId, ws.workspaceId);
  return source;
}

const draftsOf = (database: Database, ws: WorkspaceContext) => listDrafts(database, ws);

describe('a capture becomes a draft', () => {
  it('files money leaving on the account its source names', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);

    const result = await ingestCaptures(database, ws, [at('09:30')], { today: DAY });

    expect(result).toEqual({ drafts: 1, merged: 0, skipped: 0, discardedImages: [] });
    const [draft] = await draftsOf(database, ws);
    expect(draft).toMatchObject({
      kind: 'expense',
      source: 'notification',
      amountMinor: 38_000,
      currency: 'IDR',
      accountId: bank.id,
      toAccountId: null,
      categoryAccountId: null,
      description: 'TOKO KOPI',
      // The day the phone noticed it, because the notification printed no date of its own.
      occurredOn: '2026-09-30',
      captureIds: [at('09:30').id],
      imageFile: null,
      externalRef: `capture:${at('09:30').id}`,
      sourceId: (await listSources(database))[0]!.id,
    });
    // How sure the reader was of the figure travels with the draft, so the sheet can ask about it.
    expect(draft!.confidence).toBeGreaterThan(0);
    expect(draft!.reading).toMatchObject({ skipped: null, type: { value: 'spent' } });
    expect(draft!.rawPayload).toContain('Merchant: TOKO KOPI');
  });

  it('scales a figure that wore no currency by the account it lands on', async () => {
    const { database, ws, bank } = await workspace();
    const usd = await createAccount(database, ws, { name: 'Travel card', kind: 'asset', subtype: 'bank', currency: 'USD' });
    await answer(database, ws, at('09:00'), bank.id);
    await answer(database, ws, at('09:00', { app: 'com.example.card', title: 'Card' }), usd.id);

    await ingestCaptures(
      database,
      ws,
      [
        at('09:30', { body: 'Bayar 50rb berhasil. Merchant: TOKO KOPI' }),
        at('09:40', { app: 'com.example.card', title: 'Card', body: 'Bayar 1,2jt berhasil. Merchant: HOTEL' }),
      ],
      { today: DAY },
    );

    // Rupiah keeps no minor digits and dollars keep two: "50rb" is 50 000 rupiah, "1,2jt" is 1 200 000 dollars.
    const drafts = await draftsOf(database, ws);
    expect(drafts.find((d) => d.description === 'TOKO KOPI')).toMatchObject({ amountMinor: 50_000, currency: 'IDR' });
    expect(drafts.find((d) => d.description === 'HOTEL')).toMatchObject({ amountMinor: 120_000_000, currency: 'USD' });
  });

  it('files money arriving as money received, on the same account', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00', { body: 'Uang masuk Rp150.000 dari ANDI' }), bank.id);

    await ingestCaptures(database, ws, [at('09:30', { id: 'note-in', body: 'Uang masuk Rp150.000 dari ANDI' })], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({
      kind: 'income',
      amountMinor: -150_000,
      accountId: bank.id,
      description: 'ANDI',
    });
  });

  it('files a top-up as a transfer, and asks which account it came from', async () => {
    const { database, ws, wallet } = await workspace();
    await answer(database, ws, at('09:00', { app: 'com.example.pay', title: 'Pay', body: 'Top up saldo Rp200.000 berhasil' }), wallet.id);

    await ingestCaptures(
      database,
      ws,
      [at('09:30', { id: 'note-topup', app: 'com.example.pay', title: 'Pay', body: 'Top up saldo Rp200.000 berhasil' })],
      { today: DAY },
    );

    const [draft] = await draftsOf(database, ws);
    // The money landed in the wallet: what is missing is where it came from, so the draft asks for that.
    expect(draft).toMatchObject({ kind: 'transfer', accountId: null, toAccountId: wallet.id, amountMinor: -200_000 });
  });

  it('asks which account a source it has never seen belongs to', async () => {
    const { database, ws, bank } = await workspace();

    await ingestCaptures(database, ws, [at('09:30')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ accountId: null });
    // The answer is asked once per source, not once per capture.
    await answer(database, ws, at('09:30'), bank.id);
    await ingestCaptures(database, ws, [at('11:30', { id: 'note-later' })], { today: DAY });
    expect((await draftsOf(database, ws)).map((draft) => draft.accountId)).toEqual([null, bank.id]);
  });

  it('asks again when the account it learned has been archived', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);

    await archiveAccount(database, ws, bank.id);
    await ingestCaptures(database, ws, [at('09:30')], { today: DAY });

    // Nothing is filed against an account the owner has put away: the draft asks again instead.
    expect((await draftsOf(database, ws))[0]).toMatchObject({ accountId: null });
  });

  it('queues an image it could not read a figure out of, and asks for the amount', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(
      database,
      ws,
      [{ ...shot('0'), id: 'shot-blank', lines: [line('Pay wallet', 0.02), line('Transaksi Berhasil', 0.06)] }],
      { today: DAY },
    );

    const [draft] = await draftsOf(database, ws);
    expect(draft).toMatchObject({ amountMinor: 0, confidence: null, source: 'screen', description: 'Pay wallet' });
  });

  it('files a screenshot draft under the source’s own workspace', async () => {
    const { database, ws } = await workspace();
    const other = await createWorkspace(database, { name: 'Household', type: 'personal', baseCurrency: 'IDR' });
    const theirs = await createAccount(database, other, { name: 'Shared bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    // The answer named an account of another workspace, which is whose source this is from then on.
    const source = await sourceFor(database.db, shot('38.000'));
    await setSourceAccount(database, source.id, theirs.id, other.workspaceId);

    await ingestCaptures(database, ws, [{ ...shot('52.000'), id: 'shot-next' }], { today: DAY });

    const rows = await database.db.select().from(draftTransactions);
    expect(rows.at(-1)).toMatchObject({ workspaceId: other.workspaceId, accountId: theirs.id });
    expect(await draftsOf(database, other)).toHaveLength(1);
  });
});

describe('what is not worth a draft', () => {
  it('skips an offer, and keeps it where it can be brought back', async () => {
    const { database, ws } = await workspace();

    const result = await ingestCaptures(database, ws, [at('09:30', { body: 'Cashback voucher Rp10.000 untuk kamu' })], { today: DAY });

    expect(result).toEqual({ drafts: 0, merged: 0, skipped: 1, discardedImages: [] });
    expect(await draftsOf(database, ws)).toEqual([]);
    const skipped = await listSkipped(database, ws, DAY);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ reason: 'promo' });
    expect(skipped[0]!.capture.body).toContain('Cashback');
  });

  it('skips an offer handed over twice (the app stopped before the phone let it go) once', async () => {
    const { database, ws } = await workspace();
    const offer = at('09:30', { body: 'Cashback voucher Rp10.000 untuk kamu' });

    await ingestCaptures(database, ws, [offer], { today: DAY });
    const again = await ingestCaptures(database, ws, [offer], { today: DAY });

    expect(again).toMatchObject({ drafts: 0, merged: 0, skipped: 0 });
    expect(await listSkipped(database, ws, DAY)).toHaveLength(1);
  });

  it('skips what arrived when only money going out is wanted', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);
    expect(await getCaptureScope(database)).toBe('everything');

    await setCaptureScope(database, 'expenses-only');
    const received = at('09:30', { id: 'note-in', body: 'Uang masuk Rp150.000 dari ANDI' });
    const spent = at('09:40', { id: 'note-out' });

    const result = await ingestCaptures(database, ws, [received, spent], { today: DAY });

    expect(result).toEqual({ drafts: 1, merged: 0, skipped: 1, discardedImages: [] });
    expect(await draftsOf(database, ws)).toHaveLength(1);
    expect((await listSkipped(database, ws, DAY))[0]).toMatchObject({ reason: 'expenses-only' });
    expect(await getCaptureScope(database)).toBe('expenses-only');
  });

  it('makes the draft anyway when the owner brings it back', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);
    await setCaptureScope(database, 'expenses-only');
    await ingestCaptures(database, ws, [at('09:30', { id: 'note-in', body: 'Uang masuk Rp150.000 dari ANDI' })], { today: DAY });
    const [skipped] = await listSkipped(database, ws, DAY);

    const draftId = await bringBack(database, ws, skipped!.id);

    // Bringing it back is the owner saying "this one too": the scope does not get to refuse it twice.
    expect((await draftsOf(database, ws)).find((draft) => draft.id === draftId)).toMatchObject({
      kind: 'income',
      amountMinor: -150_000,
      accountId: bank.id,
    });
    expect(await listSkipped(database, ws, DAY)).toEqual([]);
  });
});

describe('a backlog arriving at once', () => {
  it('drains twenty captures into the drafts they are, merging as it goes', async () => {
    const { database, ws, bank, wallet } = await workspace();
    await answer(database, ws, at('08:00'), bank.id);
    await answer(database, ws, at('08:00', { app: 'com.example.pay', title: 'Pay', body: 'Top up saldo Rp1.000 berhasil' }), wallet.id);

    const spent = (minutes: number, amount: string) =>
      at(`08:${String(minutes).padStart(2, '0')}`, { id: `note-${minutes}`, body: `Pembayaran Rp${amount} berhasil` });
    const backlog: RawCapture[] = [
      ...Array.from({ length: 16 }, (_, index) => spent(index + 1, `${index + 1}.000`)),
      at('09:00', { id: 'note-topup', app: 'com.example.pay', title: 'Pay', body: 'Top up saldo Rp200.000 berhasil' }),
      // The same movement from the other side, forty minutes later: one transfer, not two drafts.
      at('09:40', { id: 'note-pull', body: 'Pembayaran Rp200.000 berhasil. Merchant: PAY WALLET' }),
      at('10:00', { id: 'note-coffee' }),
      // And the same payment caught again by a screenshot three minutes later: one draft, not two.
      { ...shot('38.000'), id: 'shot-coffee', capturedAt: '2026-09-30T10:03:00+07:00' },
    ];
    expect(backlog).toHaveLength(20);

    // Handed over in the order they were found, which is not the order they arrived in.
    const result = await ingestCaptures(database, ws, [...backlog].reverse(), { today: DAY });

    expect(result).toEqual({ drafts: 18, merged: 2, skipped: 0, discardedImages: [] });
    expect(await countPendingDrafts(database, ws)).toBe(18);
    const drafts = await draftsOf(database, ws);
    const transfer = drafts.find((draft) => draft.kind === 'transfer' && draft.toAccountId === wallet.id)!;
    expect(transfer).toMatchObject({ accountId: bank.id, amountMinor: 200_000, captureIds: ['note-topup', 'note-pull'] });
    const coffee = drafts.find((draft) => draft.captureIds.includes('note-coffee'))!;
    expect(coffee).toMatchObject({ captureIds: ['note-coffee', 'shot-coffee'], imageFile: 'captures/38.000.png' });
  });

  it('never queues the same capture twice', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);
    await ingestCaptures(database, ws, [at('09:30')], { today: DAY });

    const again = await ingestCaptures(database, ws, [at('09:30')], { today: DAY });

    // The same file drained twice is the same payment, and a capture already read is not a second thing to do.
    expect(again).toEqual({ drafts: 0, merged: 0, skipped: 0, discardedImages: [] });
    expect(await countPendingDrafts(database, ws)).toBe(1);
    expect((await listSkipped(database, ws, DAY)).length).toBe(0);
  });
});

describe('cleaning up', () => {
  it('forgets what it skipped a week ago, and hands back the pictures it is done with', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);
    await ingestCaptures(database, ws, [at('09:30', { body: 'Cashback voucher Rp10.000 untuk kamu' })], { today: DAY });
    await ingestCaptures(database, ws, [shot('38.000')], { today: DAY });
    const [picture] = await draftsOf(database, ws);
    await dismissDraft(database, ws, picture!.id);

    const swept = await purgeCaptures(database, daysFrom(8));

    // A draft nobody has dealt with keeps its picture: the owner may still want to look at it.
    expect(swept).toEqual({ skipped: 1, images: ['captures/38.000.png'] });
    expect(await listSkipped(database, ws, DAY)).toEqual([]);
    expect(await database.db.select().from(captureSkipped)).toEqual([]);

    // Nothing is a week old from a day ago, so a second sweep takes nothing away.
    await ingestCaptures(database, ws, [at('11:30', { body: 'Cashback voucher Rp10.000 untuk kamu', id: 'note-promo2' })], { today: DAY });
    expect(await purgeCaptures(database, daysFrom(-1))).toEqual({ skipped: 0, images: [] });
    expect(await listSkipped(database, ws, DAY)).toHaveLength(1);
  });
});

describe('the source’s own workspace', () => {
  it('merges a second sighting inside the workspace the draft was filed in', async () => {
    const { database, ws } = await workspace();
    const other = await createWorkspace(database, { name: 'Household', type: 'personal', baseCurrency: 'IDR' });
    const theirs = await createAccount(database, other, { name: 'Shared bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const source = await sourceFor(database.db, shot('38.000'));
    await setSourceAccount(database, source.id, theirs.id, other.workspaceId);

    await ingestCaptures(database, ws, [{ ...shot('52.000'), id: 'shot-a' }], { today: DAY });
    const second = await ingestCaptures(
      database,
      ws,
      [{ ...shot('52.000'), id: 'shot-b', capturedAt: '2026-09-30T10:05:00+07:00', imageFile: 'captures/b.png' }],
      { today: DAY },
    );

    expect(second.merged).toBe(1);
    const theirDrafts = await draftsOf(database, other);
    expect(theirDrafts).toHaveLength(1);
    expect(theirDrafts[0]!.captureIds).toEqual(['shot-a', 'shot-b']);
    expect(await draftsOf(database, ws)).toEqual([]);
  });

  it('keeps a skipped capture in the source’s own workspace', async () => {
    const { database, ws } = await workspace();
    const other = await createWorkspace(database, { name: 'Household', type: 'personal', baseCurrency: 'IDR' });
    const theirs = await createAccount(database, other, { name: 'Shared bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await answer(database, other, at('09:00'), theirs.id);

    await ingestCaptures(database, ws, [at('09:30', { body: 'Cashback voucher Rp10.000 untuk kamu' })], { today: DAY });

    expect(await listSkipped(database, other, DAY)).toHaveLength(1);
    expect(await listSkipped(database, ws, DAY)).toEqual([]);
  });
});

describe('the day a capture is filed on', () => {
  it('is the day where the owner was, even before seven in the morning', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);

    await ingestCaptures(database, ws, [at('06:30')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ occurredOn: '2026-09-30' });
  });
});

describe('an offer that was really a payment', () => {
  it('comes back from the Skipped list with its amount', async () => {
    const { database, ws, bank } = await workspace();
    await answer(database, ws, at('09:00'), bank.id);
    await ingestCaptures(database, ws, [at('09:30', { body: 'Cashback Rp5.000 masuk! Pakai voucher' })], { today: DAY });
    const [skipped] = await listSkipped(database, ws, DAY);
    expect(skipped).toMatchObject({ reason: 'promo' });

    const draftId = await bringBack(database, ws, skipped!.id);

    const draft = (await draftsOf(database, ws)).find((row) => row.id === draftId)!;
    expect(Math.abs(draft.amountMinor)).toBe(5_000);
  });
});

describe('pictures nothing keeps', () => {
  it('hands back the picture of a capture dropped as already recorded', async () => {
    const { database, ws, bank } = await workspace();
    const groceries = (await listAccounts(database, ws)).find((account) => account.systemKey === 'household.groceries')!;
    await answer(database, ws, at('09:00'), bank.id);
    await answer(database, ws, shot('38.000'), bank.id);
    await ingestCaptures(database, ws, [at('10:00')], { today: DAY });
    const [first] = await draftsOf(database, ws);
    await editDraft(database, ws, first!.id, { categoryAccountId: groceries.id });
    await confirmDraft(database, ws, first!.id);

    const result = await ingestCaptures(database, ws, [{ ...shot('38.000'), id: 'shot-late', capturedAt: '2026-09-30T10:03:00+07:00' }], { today: DAY });

    expect(result).toEqual({ drafts: 0, merged: 1, skipped: 0, discardedImages: ['captures/38.000.png'] });
  });

  it('keeps the picture of a capture drained twice, which its draft still shows', async () => {
    const { database, ws } = await workspace();
    await ingestCaptures(database, ws, [shot('38.000')], { today: DAY });

    const again = await ingestCaptures(database, ws, [shot('38.000')], { today: DAY });

    expect(again.discardedImages).toEqual([]);
  });
});

describe('a merged draft, dealt with', () => {
  async function mergedPair() {
    const { database, ws, bank } = await workspace();
    const groceries = (await listAccounts(database, ws)).find((account) => account.systemKey === 'household.groceries')!;
    await answer(database, ws, at('09:00'), bank.id);
    await ingestCaptures(
      database,
      ws,
      [at('10:00', { id: 'note-coffee' }), { ...shot('38.000'), id: 'shot-coffee', imageFile: 'captures/coffee.png' }],
      { today: DAY },
    );
    const [visible] = await draftsOf(database, ws);
    await editDraft(database, ws, visible!.id, { categoryAccountId: groceries.id });
    const hidden = () => database.db.select().from(draftTransactions).where(eq(draftTransactions.mergedInto, visible!.id));
    return { database, ws, visible: visible!, hidden };
  }

  it('takes the folded-in sightings with it when it is recorded, and brings them back on Undo', async () => {
    const { database, ws, visible, hidden } = await mergedPair();
    expect(await hidden()).toHaveLength(1);

    await confirmDraft(database, ws, visible.id);
    expect((await hidden())[0]).toMatchObject({ status: 'confirmed' });
    expect((await hidden())[0]!.rawPurgeAfter).not.toBeNull();

    await reopenDraft(database, ws, visible.id);
    expect((await hidden())[0]).toMatchObject({ status: 'pending', rawPurgeAfter: null });
  });

  it('takes them with it when it is discarded', async () => {
    const { database, ws, visible, hidden } = await mergedPair();

    await dismissDraft(database, ws, visible.id);

    expect((await hidden())[0]).toMatchObject({ status: 'dismissed' });
  });

  it('lets go of every picture, line and word a week after, once', async () => {
    const { database, ws, visible, hidden } = await mergedPair();
    await confirmDraft(database, ws, visible.id);

    expect((await purgeCaptureLeftovers(database, daysFrom(1))).images).toEqual([]);
    const swept = await purgeCaptureLeftovers(database, daysFrom(8));

    expect(swept.images).toEqual(['captures/coffee.png']);
    const rows = await database.db.select().from(draftTransactions);
    for (const row of rows) {
      expect(row.imageFile).toBeNull();
      expect(row.rawPayload).toBeNull();
      expect(row.readingJson ?? '').not.toContain('"lines"');
    }
    expect((await hidden())[0]!.readingJson).not.toBeNull();
    expect((await purgeCaptureLeftovers(database, daysFrom(8))).images).toEqual([]);
  });

  it('keeps the picture of a draft still waiting, and of a capture skipped this week', async () => {
    const { database, ws } = await workspace();
    await ingestCaptures(database, ws, [shot('38.000')], { today: DAY });
    await ingestCaptures(
      database,
      ws,
      [{ ...shot('10.000'), id: 'shot-promo', lines: [line('Promo', 0.02), line('Cashback Rp10.000', 0.5)], imageFile: 'captures/promo.png' }],
      { today: DAY },
    );
    expect(await listSkipped(database, ws, DAY)).toHaveLength(1);

    expect((await purgeCaptureLeftovers(database, daysFrom(3))).images).toEqual([]);
    // A week on the skipped capture goes, and its picture with it; the waiting draft keeps its own.
    expect((await purgeCaptureLeftovers(database, daysFrom(8))).images).toEqual(['captures/promo.png']);
    expect((await draftsOf(database, ws))[0]).toMatchObject({ imageFile: 'captures/38.000.png' });
  });
});

/** A wallet's transaction detail, paid by a card: the wallet ID at the top, the card under "Payment Method". */
const walletDetail = (id: string, merchant: string, figure: string, paidWith = 'Credit Card NUSA (6175)'): RawCapture => ({
  id,
  kind: 'screen',
  capturedAt: '2026-10-02T21:40:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: [
    line('Transaction Detail', 0.06),
    line(merchant.split(' ')[0]!, 0.11),
    line('02 Oct 2026 • 21:35', 0.14),
    line('KANTONG ID 0811•••9159', 0.14),
    line('Transaction success!', 0.2),
    line(`Payment to ${merchant}`, 0.24),
    line('Total Payment', 0.3),
    line(figure, 0.34),
    line(`Payment Method ${paidWith}`, 0.4),
  ],
  imageFile: `captures/${id}.png`,
});

describe('the card a screen says paid', () => {
  async function withCard() {
    const { database, ws, wallet } = await workspace();
    const card = await createCardAccount(database, ws, { name: 'Travel card', subtype: 'credit_card', currency: 'IDR', issuer: 'NUSA', last4: '6175' });
    return { database, ws, wallet, cardAccountId: card.id };
  }

  it('files the payment on the card’s account, over the account the source learned', async () => {
    const { database, ws, wallet, cardAccountId } = await withCard();
    await answer(database, ws, walletDetail('d-0', 'Lazada Indonesia', 'Rp1.010.000'), wallet.id);

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Lazada Indonesia', 'Rp1.010.000')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ accountId: cardAccountId, amountMinor: 1_010_000 });
  });

  it('files on the card even when the source has not been told whose it is', async () => {
    const { database, ws, cardAccountId } = await withCard();

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Logitek Digital Nusantara', 'Rp295.000')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ accountId: cardAccountId, amountMinor: 295_000 });
  });

  it('falls back to the learned account when no card, or more than one, ends in those digits', async () => {
    const { database, ws, wallet, cardAccountId } = await withCard();
    await answer(database, ws, walletDetail('d-0', 'Lazada Indonesia', 'Rp1.010.000'), wallet.id);

    await ingestCaptures(database, ws, [walletDetail('d-none', 'Lazada Indonesia', 'Rp20.000', 'Credit Card NUSA (9999)')], { today: DAY });
    const bank = (await listAccounts(database, ws)).find((account) => account.name === 'Everyday bank')!;
    await addCard(database, ws, { accountId: bank.id, last4: '6175' });
    await ingestCaptures(database, ws, [walletDetail('d-two', 'Lazada Indonesia', 'Rp30.000')], { today: DAY });

    const drafts = await draftsOf(database, ws);
    expect(drafts.find((draft) => draft.amountMinor === 20_000)).toMatchObject({ accountId: wallet.id });
    expect(drafts.find((draft) => draft.amountMinor === 30_000)).toMatchObject({ accountId: wallet.id });
    expect(cardAccountId).not.toBe(wallet.id);
  });

  it('passes over a card that has been put away', async () => {
    const { database, ws } = await workspace();
    const card = await createCardAccount(database, ws, { name: 'Old card', subtype: 'credit_card', currency: 'IDR', last4: '6175' });
    const [plastic] = (await listCards(database, ws)).filter((row) => row.accountId === card.id);
    await archiveCard(database, ws, plastic!.id);

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Lazada Indonesia', 'Rp1.010.000')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ accountId: null });
  });
});

describe('the note a draft is given', () => {
  it('is the app, then the merchant, when a card paid', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Lazada Indonesia', 'Rp1.010.000')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ description: 'KANTONG Lazada Indonesia' });
    expect((await listSources(database))[0]).toMatchObject({ label: 'KANTONG' });
  });

  it('is the app, then the merchant, when the digits match a card the method does not call one', async () => {
    const { database, ws } = await workspace();
    await createCardAccount(database, ws, { name: 'Travel card', subtype: 'credit_card', currency: 'IDR', last4: '6175' });

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Lazada Indonesia', 'Rp1.010.000', 'NUSA •••• 6175')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ description: 'KANTONG Lazada Indonesia' });
  });

  it('is the merchant alone when the wallet’s balance paid', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Lazada Indonesia', 'Rp1.010.000', 'KANTONG Balance')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ description: 'Lazada Indonesia' });
  });

  it('is the merchant alone when the capture names no payment method', async () => {
    const { database, ws } = await workspace();
    const plain = walletDetail('d-1', 'Lazada Indonesia', 'Rp1.010.000');

    await ingestCaptures(database, ws, [{ ...plain, lines: plain.lines.slice(0, -1) }, at('09:30')], { today: DAY });

    expect((await draftsOf(database, ws)).map((draft) => draft.description).sort()).toEqual(['Lazada Indonesia', 'TOKO KOPI']);
  });

  it('follows the name the owner gave the source', async () => {
    const { database, ws } = await workspace();
    const source = await sourceFor(database.db, walletDetail('d-0', 'Lazada Indonesia', 'Rp1.010.000'));
    await database.db.update(captureSources).set({ label: 'Kantong' }).where(eq(captureSources.id, source.id));

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Logitek Digital Nusantara', 'Rp295.000')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ description: 'Kantong Logitek Digital Nusantara' });
  });

  it('does not say the app twice when the merchant already starts with it', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(database, ws, [walletDetail('d-1', 'Kantong Mart', 'Rp50.000')], { today: DAY });

    expect((await draftsOf(database, ws))[0]).toMatchObject({ description: 'Kantong Mart' });
  });

  it('is a notification’s merchant alone, and its app first when a card paid', async () => {
    const { database, ws } = await workspace();

    await ingestCaptures(
      database,
      ws,
      [at('09:30', { body: 'Pembayaran Rp38.000 berhasil. Merchant: TOKO KOPI. Paid with Credit Card ending 6175' })],
      { today: DAY },
    );

    expect((await draftsOf(database, ws))[0]).toMatchObject({ description: 'Bank TOKO KOPI' });
  });
});
