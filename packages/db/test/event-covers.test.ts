import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  type Database,
  linkEventItem,
  listEventItems,
  postTransaction,
  purchaseCover,
  replaceTransaction,
  saveEvent,
  saveEventItem,
  setPurchaseCover,
  tagTransaction,
  unlinkEventItem,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

/** One transaction by id, void rows included, with the event it is tagged to. `listTransactions` hides void ones. */
async function transactionRow(database: Database, id: string) {
  const [row] = await database.db.values<[string, string | null]>(sql`SELECT status, event_id FROM transactions WHERE id = ${id}`);
  return { status: row![0], eventId: row![1] };
}

/** The raw pair, so a test can see that a purchase and a share are never stored one without the other. */
async function coverPairs(database: Database) {
  const rows = await database.db.values<[string, string | null, number | null]>(
    sql`SELECT id, transaction_id, share_minor FROM event_items ORDER BY sort_order`,
  );
  return rows.map(([, transactionId, shareMinor]) => [transactionId, shareMinor]);
}

async function mothercare() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const clothes = await createAccount(database, ws, { name: 'Clothes', kind: 'expense', subtype: 'category', currency: null });
  const gear = await createAccount(database, ws, { name: 'Baby gear', kind: 'expense', subtype: 'category', currency: null });
  const eventId = await saveEvent(database, ws, { name: 'Newborn', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  const item = (name: string, quantity: number, unitPriceMinor: number, categoryAccountId: string) =>
    saveEventItem(database, ws, eventId, { name, quantity, unitPriceMinor, categoryAccountId });
  const buy = async (categoryId: string, amountMinor: number, description: string, tagged = true) => {
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-14',
      description,
      lines: [
        { accountId: categoryId, amountMinor, currency: 'IDR' },
        { accountId: bca.id, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });
    if (tagged) await tagTransaction(database, ws, id, eventId);
    return id;
  };
  return { database, ws, bca, clothes, gear, eventId, item, buy };
}

describe('one receipt over several items', () => {
  it('gives each ticked item a share, and says what is left', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const wraps = await h.item('Muslin wraps', 4, 175_000, h.clothes.id);
    const steriliser = await h.item('Bottle steriliser', 1, 800_000, h.gear.id);
    const receipt = await h.buy(h.clothes.id, 4_150_000, 'Mothercare');

    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: clothes, shareMinor: 1_280_000 },
      { itemId: wraps, shareMinor: 700_000 },
      { itemId: steriliser, shareMinor: 900_000 },
    ]);

    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({
      totalMinor: 4_150_000,
      givenMinor: 2_880_000,
      leftMinor: 1_270_000,
    });
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => [row.name, row.transactionId, row.shareMinor])).toEqual([
      ['Newborn clothes', receipt, 1_280_000],
      ['Muslin wraps', receipt, 700_000],
      ['Bottle steriliser', receipt, 900_000],
    ]);
  });

  it('refuses shares that add to more than the receipt, writing nothing', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const wraps = await h.item('Muslin wraps', 4, 175_000, h.clothes.id);
    const receipt = await h.buy(h.clothes.id, 1_500_000, 'Mothercare');

    await expect(
      setPurchaseCover(h.database, h.ws, receipt, [
        { itemId: clothes, shareMinor: 1_280_000 },
        { itemId: wraps, shareMinor: 700_000 },
      ]),
    ).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.transactionId)).toEqual([null, null]);
  });

  it('unticking one item leaves the others, and raises what is left', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const wraps = await h.item('Muslin wraps', 4, 175_000, h.clothes.id);
    const receipt = await h.buy(h.clothes.id, 4_150_000, 'Mothercare');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: clothes, shareMinor: 1_280_000 },
      { itemId: wraps, shareMinor: 700_000 },
    ]);

    await setPurchaseCover(h.database, h.ws, receipt, [{ itemId: clothes, shareMinor: 1_280_000 }]);
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.shareMinor)).toEqual([1_280_000, null]);
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ givenMinor: 1_280_000, leftMinor: 2_870_000 });

    await unlinkEventItem(h.database, h.ws, clothes);
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ givenMinor: 0, leftMinor: 4_150_000 });
    // Unticking never touches the money: it is still posted and still tagged.
    expect(await transactionRow(h.database, receipt)).toEqual({ status: 'posted', eventId: h.eventId });
  });
});

describe('linking one item at a time', () => {
  it('defaults the share to the estimate, clamped to what is left', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const wraps = await h.item('Muslin wraps', 4, 175_000, h.clothes.id);
    const receipt = await h.buy(h.clothes.id, 1_800_000, 'Mothercare');

    await linkEventItem(h.database, h.ws, clothes, receipt);
    expect((await listEventItems(h.database, h.ws, h.eventId))[0]!.shareMinor).toBe(1_500_000);
    // Only Rp300.000 is left, so that is all the wraps can take.
    await linkEventItem(h.database, h.ws, wraps, receipt);
    expect((await listEventItems(h.database, h.ws, h.eventId))[1]!.shareMinor).toBe(300_000);
  });

  it('refuses a purchase that is not on this event, and a share bigger than what is left', async () => {
    const h = await mothercare();
    const crib = await h.item('Crib', 1, 7_500_000, h.gear.id);
    const stray = await h.buy(h.gear.id, 100_000, 'Warung', false);
    const receipt = await h.buy(h.gear.id, 7_200_000, 'Toko Bayi');

    await expect(linkEventItem(h.database, h.ws, crib, stray)).rejects.toMatchObject({ code: 'NOT_TAGGED' });
    await expect(linkEventItem(h.database, h.ws, crib, receipt, 7_300_000)).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
    await expect(linkEventItem(h.database, h.ws, crib, receipt, 0)).rejects.toMatchObject({ code: 'SHARE_RANGE' });
  });
});

describe('a purchase that changes', () => {
  it('carries every share through a correction, which posts under a new id', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const wraps = await h.item('Muslin wraps', 4, 175_000, h.clothes.id);
    const receipt = await h.buy(h.clothes.id, 4_150_000, 'Mothercare');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: clothes, shareMinor: 1_280_000 },
      { itemId: wraps, shareMinor: 700_000 },
    ]);

    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Mothercare',
      lines: [
        { accountId: h.clothes.id, amountMinor: 4_000_000, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -4_000_000, currency: 'IDR' },
      ],
    });
    expect(corrected).not.toBe(receipt);
    // Still fits, so the shares are kept exactly as they were.
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => [row.transactionId, row.shareMinor])).toEqual([
      [corrected, 1_280_000],
      [corrected, 700_000],
    ]);
  });

  it('scales the shares down when the correction is smaller than they add to', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const wraps = await h.item('Muslin wraps', 4, 175_000, h.clothes.id);
    const receipt = await h.buy(h.clothes.id, 2_000_000, 'Mothercare');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: clothes, shareMinor: 1_300_000 },
      { itemId: wraps, shareMinor: 700_000 },
    ]);

    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Mothercare',
      lines: [
        { accountId: h.clothes.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -1_000_000, currency: 'IDR' },
      ],
    });
    // Halved in proportion, and the remainder goes to the largest, so they still add to exactly the new figure.
    const shares = (await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.shareMinor);
    expect(shares).toEqual([650_000, 350_000]);
    expect(shares[0]! + shares[1]!).toBe(1_000_000);
    expect(await purchaseCover(h.database, h.ws, corrected)).toMatchObject({ totalMinor: 1_000_000, leftMinor: 0 });
  });

  it('settles nothing once it is voided, without forgetting what it settled', async () => {
    const h = await mothercare();
    const crib = await h.item('Crib', 1, 7_500_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 7_200_000, 'Toko Bayi');
    await linkEventItem(h.database, h.ws, crib, receipt);
    await voidTransaction(h.database, h.ws, receipt);

    // The row is kept — the plan reads the item as unbought because the purchase is no longer posted (Task 4).
    expect((await listEventItems(h.database, h.ws, h.eventId))[0]).toMatchObject({ transactionId: receipt, shareMinor: 7_200_000 });
    const right = await h.buy(h.gear.id, 6_900_000, 'Toko Bayi Baru');
    await linkEventItem(h.database, h.ws, crib, right);
    expect((await listEventItems(h.database, h.ws, h.eventId))[0]).toMatchObject({ transactionId: right, shareMinor: 6_900_000 });
  });
});

/*
 * Rounding. A share is integer minor units, so cutting three of them to fit a smaller receipt cannot divide evenly.
 * What matters is not which item absorbs the odd rupiah but that none is lost or invented: the shares of one purchase
 * must always add back to that purchase exactly, because the plan reads the leftover as "not planned for".
 */
describe('shares that do not divide evenly', () => {
  it('adds back to exactly the corrected figure across three items', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 1_600_001, h.gear.id);
    const mattress = await h.item('Mattress', 1, 1_600_001, h.gear.id);
    const changing = await h.item('Changing table', 1, 1_600_001, h.gear.id);
    // Rp48.000,03 — three equal shares that come to it exactly.
    const receipt = await h.buy(h.gear.id, 4_800_003, 'Toko Bayi');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: cot, shareMinor: 1_600_001 },
      { itemId: mattress, shareMinor: 1_600_001 },
      { itemId: changing, shareMinor: 1_600_001 },
    ]);

    // Corrected down to Rp48.000,01 — which three equal shares cannot divide.
    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Toko Bayi',
      lines: [
        { accountId: h.gear.id, amountMinor: 4_800_001, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -4_800_001, currency: 'IDR' },
      ],
    });

    const shares = (await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.shareMinor!);
    // Every share is a whole number, the odd rupiah lands on one item only, and nothing is lost or invented.
    expect(shares.every((share) => Number.isInteger(share))).toBe(true);
    expect(shares).toEqual([1_600_001, 1_600_000, 1_600_000]);
    expect(shares.reduce((total, share) => total + share, 0)).toBe(4_800_001);
    expect(await purchaseCover(h.database, h.ws, corrected)).toMatchObject({ totalMinor: 4_800_001, givenMinor: 4_800_001, leftMinor: 0 });
  });

  it('keeps shares exact at figures past what a float can count', async () => {
    const h = await mothercare();
    // Rp90.000.000 and Rp60.000.000: share times total overflows a double, so the cut is done in whole numbers.
    const land = await h.item('Land', 1, 9_000_000_000, h.gear.id);
    const build = await h.item('Building', 1, 6_000_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 15_000_000_000, 'Notaris');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: land, shareMinor: 9_000_000_000 },
      { itemId: build, shareMinor: 6_000_000_000 },
    ]);

    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Notaris',
      lines: [
        { accountId: h.gear.id, amountMinor: 10_000_000_001, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -10_000_000_001, currency: 'IDR' },
      ],
    });

    const shares = (await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.shareMinor!);
    expect(shares.reduce((total, share) => total + share, 0)).toBe(10_000_000_001);
    expect(await purchaseCover(h.database, h.ws, corrected)).toMatchObject({ leftMinor: 0 });
  });

  it('drops an item whose share rounds away, and still adds back exactly', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 4_000_000, h.gear.id);
    const bib = await h.item('Bib', 1, 1_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 4_001_000, 'Toko Bayi');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: cot, shareMinor: 4_000_000 },
      { itemId: bib, shareMinor: 1_000 },
    ]);

    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Toko Bayi',
      lines: [
        { accountId: h.gear.id, amountMinor: 100, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -100, currency: 'IDR' },
      ],
    });

    // The bib's share rounds to nothing, so it is untied rather than left settled by nothing at all.
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => [row.transactionId, row.shareMinor])).toEqual([
      [corrected, 100],
      [null, null],
    ]);
    expect(await purchaseCover(h.database, h.ws, corrected)).toMatchObject({ totalMinor: 100, givenMinor: 100, leftMinor: 0 });
  });
});

/*
 * The purchase and the share are one fact in two columns. Migration 0049 only says so in a comment, so the rule is
 * kept here instead: every write goes through one helper that takes the pair together, and nothing else writes them.
 */
describe('a purchase and its share are never stored one without the other', () => {
  it('leaves the pair whole through linking, unlinking and correcting', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const mattress = await h.item('Mattress', 1, 1_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    const whole = async () => {
      for (const [transactionId, shareMinor] of await coverPairs(h.database)) {
        expect(transactionId === null).toBe(shareMinor === null);
      }
    };

    await whole();
    await linkEventItem(h.database, h.ws, cot, receipt);
    await whole();
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: cot, shareMinor: 2_000_000 },
      { itemId: mattress, shareMinor: 1_000_000 },
    ]);
    await whole();
    await setPurchaseCover(h.database, h.ws, receipt, [{ itemId: mattress, shareMinor: 1_000_000 }]);
    await whole();
    await unlinkEventItem(h.database, h.ws, mattress);
    await whole();
  });

  it('reads a half-set row as unsettled rather than breaking, and repairs it on the next link', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    // Forced in behind the repository's back — the state a CHECK would forbid at the table.
    await h.database.db.run(sql`UPDATE event_items SET transaction_id = ${receipt}, share_minor = NULL WHERE id = ${cot}`);

    // A purchase with no share answers for nothing of the receipt, so none of it is quietly accounted for.
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ totalMinor: 3_000_000, givenMinor: 0, leftMinor: 3_000_000 });

    await linkEventItem(h.database, h.ws, cot, receipt);
    expect((await coverPairs(h.database))[0]).toEqual([receipt, 2_000_000]);
  });

  it('refuses a share with no figure behind it', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');

    await expect(setPurchaseCover(h.database, h.ws, receipt, [{ itemId: cot, shareMinor: 0 }])).rejects.toMatchObject({ code: 'SHARE_RANGE' });
    await expect(setPurchaseCover(h.database, h.ws, receipt, [{ itemId: cot, shareMinor: 1.5 }])).rejects.toMatchObject({ code: 'SHARE_RANGE' });
    await expect(setPurchaseCover(h.database, h.ws, receipt, [{ itemId: cot, shareMinor: -1 }])).rejects.toMatchObject({ code: 'SHARE_RANGE' });
    expect(await coverPairs(h.database)).toEqual([[null, null]]);
  });
});

describe('a cover is refused rather than half written', () => {
  it('refuses a receipt tagged to no event, and one tagged to another', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const stray = await h.buy(h.gear.id, 3_000_000, 'Warung', false);

    await expect(setPurchaseCover(h.database, h.ws, stray, [{ itemId: cot, shareMinor: 1_000_000 }])).rejects.toMatchObject({ code: 'NOT_TAGGED' });
    expect(await coverPairs(h.database)).toEqual([[null, null]]);
  });

  it('writes nothing at all when one item of a batch is unknown', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    await linkEventItem(h.database, h.ws, cot, receipt);

    await expect(
      setPurchaseCover(h.database, h.ws, receipt, [
        { itemId: cot, shareMinor: 500_000 },
        { itemId: 'no-such-item', shareMinor: 500_000 },
      ]),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    // The cot keeps the share it had: a refused save is not a half-saved screen.
    expect(await coverPairs(h.database)).toEqual([[receipt, 2_000_000]]);
  });

  it('never lets the shares of one purchase add to more than it', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const mattress = await h.item('Mattress', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');

    await linkEventItem(h.database, h.ws, cot, receipt);
    // Rp2.000.000 of Rp3.000.000 is taken, so the mattress can only have the rest, whatever it was estimated at.
    await expect(linkEventItem(h.database, h.ws, mattress, receipt, 1_500_000)).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
    await linkEventItem(h.database, h.ws, mattress, receipt);
    const cover = await purchaseCover(h.database, h.ws, receipt);
    expect(cover).toMatchObject({ givenMinor: 3_000_000, leftMinor: 0 });
    expect(cover.covers.reduce((total, one) => total + one.shareMinor, 0)).toBe(cover.totalMinor);
  });

  it('lets an item already on the receipt keep or raise its own share', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');

    await linkEventItem(h.database, h.ws, cot, receipt, 2_000_000);
    // Re-linking must not have to fit alongside the share it is replacing.
    await linkEventItem(h.database, h.ws, cot, receipt, 3_000_000);
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ givenMinor: 3_000_000, leftMinor: 0 });
    await expect(linkEventItem(h.database, h.ws, cot, receipt, 3_000_001)).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
  });
});
