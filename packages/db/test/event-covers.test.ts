import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  type Database,
  eventPlanFor,
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

/** The same pair for one named item, for the tests that span two occasions and cannot sort by one's order. */
async function coverOfItem(database: Database, itemId: string) {
  const rows = await database.db.values<[string | null, number | null]>(
    sql`SELECT transaction_id, share_minor FROM event_items WHERE id = ${itemId}`,
  );
  return rows[0]!;
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
  /** A receipt whose lines are written out, for the ones that are not one category against one bank. */
  const receiptOf = async (lines: { accountId: string; amountMinor: number }[], description: string) => {
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-14',
      description,
      lines: lines.map((line) => ({ ...line, currency: 'IDR' })),
    });
    await tagTransaction(database, ws, id, eventId);
    return id;
  };
  return { database, ws, bca, clothes, gear, eventId, item, buy, receiptOf };
}

/*
 * A discount, a partial refund or a price correction booked back to a spending category is a negative expense line on
 * the same receipt. The money that left the account is the lines added up, not each line's size added up, so the
 * ceiling has to be the net — otherwise a share larger than the payment is accepted and the plan reports rupiah that
 * were never spent.
 */
describe('a receipt with a discount line on it', () => {
  /** Rp50.000 of gear, Rp10.000 off, Rp40.000 out of the bank. */
  const discounted = async () => {
    const h = await mothercare();
    const receipt = await h.receiptOf(
      [
        { accountId: h.gear.id, amountMinor: 5_000_000 },
        { accountId: h.gear.id, amountMinor: -1_000_000 },
        { accountId: h.bca.id, amountMinor: -4_000_000 },
      ],
      'Toko Bayi',
    );
    return { ...h, receipt };
  };

  it('counts the discount against the receipt rather than adding its size to it', async () => {
    const h = await discounted();
    expect(await purchaseCover(h.database, h.ws, h.receipt)).toMatchObject({ totalMinor: 4_000_000, givenMinor: 0, leftMinor: 4_000_000 });
  });

  it('refuses a share larger than the money that actually left', async () => {
    const h = await discounted();
    const cot = await h.item('Cot', 1, 6_000_000, h.gear.id);

    await expect(setPurchaseCover(h.database, h.ws, h.receipt, [{ itemId: cot, shareMinor: 6_000_000 }])).rejects.toMatchObject({
      code: 'OVER_ALLOCATED',
    });
    await expect(linkEventItem(h.database, h.ws, cot, h.receipt, 6_000_000)).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
    expect(await coverPairs(h.database)).toEqual([[null, null]]);

    // The whole of it is still answerable — it is only the invented Rp20.000 that is refused.
    await setPurchaseCover(h.database, h.ws, h.receipt, [{ itemId: cot, shareMinor: 4_000_000 }]);
    expect(await purchaseCover(h.database, h.ws, h.receipt)).toMatchObject({ givenMinor: 4_000_000, leftMinor: 0 });
  });

  it('answers nothing at all when the receipt is a refund on balance', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const refund = await h.receiptOf(
      [
        { accountId: h.gear.id, amountMinor: -1_000_000 },
        { accountId: h.bca.id, amountMinor: 1_000_000 },
      ],
      'Toko Bayi refund',
    );

    expect(await purchaseCover(h.database, h.ws, refund)).toMatchObject({ totalMinor: 0, leftMinor: 0 });
    // Not NOTHING_LEFT: nothing of this receipt is spoken for, there was simply never any money on it, and sending
    // someone to a screen that splits a payment between items would be sending them nowhere.
    await expect(linkEventItem(h.database, h.ws, cot, refund)).rejects.toMatchObject({ code: 'SHARE_RANGE' });
    await expect(setPurchaseCover(h.database, h.ws, refund, [{ itemId: cot, shareMinor: 1 }])).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
    expect(await coverPairs(h.database)).toEqual([[null, null]]);
  });

  it('never lets the plan read back more bought than the event spent', async () => {
    const h = await discounted();
    const cot = await h.item('Cot', 1, 6_000_000, h.gear.id);
    // The most the receipt will answer, whatever the item was estimated at.
    const { totalMinor } = await purchaseCover(h.database, h.ws, h.receipt);
    await linkEventItem(h.database, h.ws, cot, h.receipt, totalMinor);

    const plan = await eventPlanFor(h.database, h.ws, h.eventId);
    // Rp40.000 left the bank, so that is the most the item can have cost — and what is not planned for is a remainder,
    // never a debt: `spentMinor − boughtActualMinor` cannot go below nought.
    expect(plan.boughtActualMinor).toBe(4_000_000);
    expect(plan.notPlannedMinor).toBeGreaterThanOrEqual(0);
    expect(plan.boughtActualMinor + plan.notPlannedMinor).toBe(plan.spentMinor);
  });
});

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

/*
 * Ticking an item off claims what is left of the receipt — the whole of it when nothing else has been ticked against
 * it, which is one receipt buying one thing, the ordinary case. The estimate is what was planned and the receipt is
 * what was spent; a default that took the estimate would report every purchase as exactly on plan and push the
 * difference into "not planned for", which is the plan disowning money it meant to spend.
 */
describe('linking one item at a time', () => {
  it('claims the whole receipt, so the item reads as bought over rather than the plan reading as exact', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const receipt = await h.buy(h.clothes.id, 1_800_000, 'Mothercare');

    await linkEventItem(h.database, h.ws, clothes, receipt);
    expect((await listEventItems(h.database, h.ws, h.eventId))[0]!.shareMinor).toBe(1_800_000);

    // Rp15.000 planned, Rp18.000 spent, Rp3.000 over — and nothing left over for the plan to call unplanned.
    expect(await eventPlanFor(h.database, h.ws, h.eventId)).toMatchObject({
      boughtEstimateMinor: 1_500_000,
      boughtActualMinor: 1_800_000,
      differenceMinor: 300_000,
      overCount: 1,
      notPlannedMinor: 0,
    });
  });

  it('leaves nothing for a second item, because a shared receipt is answered on one screen and not by ticks', async () => {
    const h = await mothercare();
    const clothes = await h.item('Newborn clothes', 10, 150_000, h.clothes.id);
    const wraps = await h.item('Muslin wraps', 4, 175_000, h.clothes.id);
    const receipt = await h.buy(h.clothes.id, 1_800_000, 'Mothercare');

    await linkEventItem(h.database, h.ws, clothes, receipt);
    /*
     * Its own code, not SHARE_RANGE: nobody typed a share, so "a share is a whole figure above nought" would be a
     * message about a figure that does not exist. NOTHING_LEFT is the one refusal a screen can route somewhere —
     * to the cover screen the next three lines then use.
     */
    await expect(linkEventItem(h.database, h.ws, wraps, receipt)).rejects.toMatchObject({
      code: 'NOTHING_LEFT',
      message: expect.stringContaining('what the receipt covers'),
    });
    // A share someone did type is still judged as a figure: nought is malformed wherever the receipt stands.
    await expect(linkEventItem(h.database, h.ws, wraps, receipt, 0)).rejects.toMatchObject({ code: 'SHARE_RANGE' });
    // The two shares together, checked against the one receipt in one write: this is what a shared receipt needs.
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: clothes, shareMinor: 1_100_000 },
      { itemId: wraps, shareMinor: 700_000 },
    ]);
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.shareMinor)).toEqual([1_100_000, 700_000]);
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ givenMinor: 1_800_000, leftMinor: 0 });
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

  /*
   * The case above exercises the magnitude but cannot see the arithmetic: the odd rupiah handed to the largest share
   * hides a floor that came out one short, so the total is exact either way. This one can see it. At a third of
   * Rp300.000.000 the double product 9.000.000.015 × 10.000.000.000 is past what a double counts in whole numbers, and
   * it rounds down across an integer boundary: `Math.floor((was * now) / old)` gives the fittings 3.000.000.004 where
   * the true third is 3.000.000.005, and the rupiah it lost reappears on the land, which is not where it was spent.
   * Each share is checked on its own, not merely the total.
   */
  it('cuts every share exactly at figures past what a float can count', async () => {
    const h = await mothercare();
    const land = await h.item('Land', 1, 12_000_000_000, h.gear.id);
    const fittings = await h.item('Fittings', 1, 9_000_000_015, h.gear.id);
    const build = await h.item('Building', 1, 8_999_999_985, h.gear.id);
    const receipt = await h.buy(h.gear.id, 30_000_000_000, 'Notaris');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: land, shareMinor: 12_000_000_000 },
      { itemId: fittings, shareMinor: 9_000_000_015 },
      { itemId: build, shareMinor: 8_999_999_985 },
    ]);

    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Notaris',
      lines: [
        { accountId: h.gear.id, amountMinor: 10_000_000_000, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -10_000_000_000, currency: 'IDR' },
      ],
    });

    const shares = (await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.shareMinor!);
    // Each is exactly a third of what it was, so a third of the receipt divides with nothing left over at all.
    expect(shares).toEqual([4_000_000_000, 3_000_000_005, 2_999_999_995]);
    expect(shares.reduce((total, share) => total + share, 0)).toBe(10_000_000_000);
    expect(await purchaseCover(h.database, h.ws, corrected)).toMatchObject({ leftMinor: 0 });
  });

  /*
   * The odd rupiah goes to the largest share, not to the first one on the list — largest because a rupiah is least
   * visible there. The tests above cannot tell the two apart: their shares are equal, or the first is also the largest.
   */
  it('hands the odd rupiah to the largest share, not the first one', async () => {
    const h = await mothercare();
    const bib = await h.item('Bib', 1, 1_000_000, h.gear.id);
    const cot = await h.item('Cot', 1, 2_000_001, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_001, 'Toko Bayi');
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: bib, shareMinor: 1_000_000 },
      { itemId: cot, shareMinor: 2_000_001 },
    ]);

    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Toko Bayi',
      lines: [
        { accountId: h.gear.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -1_000_000, currency: 'IDR' },
      ],
    });

    // Both floor short by a fraction; the rupiah between them belongs to the cot, which is second on the list.
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => row.shareMinor)).toEqual([333_333, 666_667]);
    expect(await purchaseCover(h.database, h.ws, corrected)).toMatchObject({ givenMinor: 1_000_000, leftMinor: 0 });
  });

  /*
   * Nothing in this module writes a negative share, but the column permits one and `coverOf` already reads a half-set
   * row defensively. BigInt division truncates toward nought rather than flooring, so a hand-written negative row taken
   * at face value would shrink the total it is dividing by and leave the shares written adding to more than the
   * corrected receipt — the one thing the cut in proportion exists to prevent.
   */
  it('adds back exactly even when a share was written negative behind its back', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 3_000_000, h.gear.id);
    const bib = await h.item('Bib', 1, 1_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    await linkEventItem(h.database, h.ws, cot, receipt, 3_000_000);
    await h.database.db.run(sql`UPDATE event_items SET transaction_id = ${receipt}, share_minor = -1000000 WHERE id = ${bib}`);

    const corrected = await replaceTransaction(h.database, h.ws, receipt, {
      occurredOn: '2026-09-14',
      description: 'Toko Bayi',
      lines: [
        { accountId: h.gear.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: h.bca.id, amountMinor: -1_000_000, currency: 'IDR' },
      ],
    });

    // The negative reads as nothing, so the cot takes the whole of the corrected figure and the bib is simply untied.
    expect((await listEventItems(h.database, h.ws, h.eventId)).map((row) => [row.transactionId, row.shareMinor])).toEqual([
      [corrected, 1_000_000],
      [null, null],
    ]);
    expect(await purchaseCover(h.database, h.ws, corrected)).toMatchObject({ totalMinor: 1_000_000, givenMinor: 1_000_000, leftMinor: 0 });
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
    // Nothing of the receipt was spoken for, so the tick claims all of it and the pair is whole again.
    expect((await coverPairs(h.database))[0]).toEqual([receipt, 3_000_000]);
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

  /*
   * A void keeps its tag and keeps its entries — that is what lets a correction carry the shares over — so being
   * tagged to this event is not on its own enough to answer an item. Only a payment still posted can: a voided one
   * is money that did not happen, and `expenseTotalOf` would lend its whole amount as a ceiling all the same.
   */
  it('refuses a receipt that has been voided, though it is still tagged to this event', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    await voidTransaction(h.database, h.ws, receipt);
    // The tag survives the void; it is the status, not the tag, that has to refuse it.
    expect(await transactionRow(h.database, receipt)).toEqual({ status: 'void', eventId: h.eventId });

    await expect(linkEventItem(h.database, h.ws, cot, receipt)).rejects.toMatchObject({ code: 'NOT_TAGGED' });
    await expect(linkEventItem(h.database, h.ws, cot, receipt, 1_000_000)).rejects.toMatchObject({ code: 'NOT_TAGGED' });
    await expect(setPurchaseCover(h.database, h.ws, receipt, [{ itemId: cot, shareMinor: 1_000_000 }])).rejects.toMatchObject({ code: 'NOT_TAGGED' });
    expect(await coverPairs(h.database)).toEqual([[null, null]]);
  });

  /*
   * The tick a void does NOT take off, so that correcting a receipt does not untick everything it answered: the
   * refusal above is about writing a new link onto a dead payment, not about tearing down the ones already there.
   */
  it('leaves a share already written where it is when the payment behind it is voided', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    await linkEventItem(h.database, h.ws, cot, receipt);
    await voidTransaction(h.database, h.ws, receipt);

    expect(await coverPairs(h.database)).toEqual([[receipt, 3_000_000]]);
    // The reading is where the void counts for nothing: the item is not bought and the event spent nothing.
    const plan = await eventPlanFor(h.database, h.ws, h.eventId);
    expect(plan).toMatchObject({ spentMinor: 0, boughtCount: 0, boughtActualMinor: 0 });
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
    expect(await coverPairs(h.database)).toEqual([[receipt, 3_000_000]]);
  });

  /*
   * A screen that sends the same item twice — a double tap, a stale row merged with a fresh one — must not have its
   * figure counted twice. The check is made over the same map that is written, so the figure checked is the figure
   * written: one share, and a leftover that matches it.
   */
  it('writes one share for an item named twice, and checks the figure it writes', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');

    // Two entries of Rp20.000 against a Rp30.000 receipt: doubled they would not fit, and yet this is not too much.
    await setPurchaseCover(h.database, h.ws, receipt, [
      { itemId: cot, shareMinor: 2_000_000 },
      { itemId: cot, shareMinor: 2_000_000 },
    ]);

    const cover = await purchaseCover(h.database, h.ws, receipt);
    expect(cover).toMatchObject({ totalMinor: 3_000_000, givenMinor: 2_000_000, leftMinor: 1_000_000 });
    expect(cover.covers).toEqual([{ itemId: cot, shareMinor: 2_000_000 }]);
    expect(await coverPairs(h.database)).toEqual([[receipt, 2_000_000]]);
  });

  it('never lets the shares of one purchase add to more than it', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const mattress = await h.item('Mattress', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');

    await linkEventItem(h.database, h.ws, cot, receipt);
    // The cot's tick took the whole receipt, so the mattress can have none of it — neither a figure someone typed
    // nor the default, which is what is left and here is nought.
    await expect(linkEventItem(h.database, h.ws, mattress, receipt, 1_500_000)).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
    // A tick with nothing left is NOTHING_LEFT, which a screen can route to "What it covers"; a typed figure that
    // does not fit is still OVER_ALLOCATED, and a malformed one still SHARE_RANGE. Three cases, three codes.
    await expect(linkEventItem(h.database, h.ws, mattress, receipt)).rejects.toMatchObject({ code: 'NOTHING_LEFT' });
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

/*
 * A receipt moved from one occasion to another. The link the first occasion's item holds is deliberately left
 * standing — tag it back and the tick is back where it was — so what is left of a receipt has to be read against
 * the occasion it is tagged to now. Counting the old occasion's share here was worth a real figure: Rp20.000 of a
 * Rp30.000 receipt offered to the new occasion, and a Rp10.000 under on its plan that nothing on screen explained.
 */
describe('a receipt retagged to another occasion', () => {
  it('reads what is left against the occasion it is tagged to now, not the item it used to answer', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    await linkEventItem(h.database, h.ws, cot, receipt, 1_000_000);

    const shower = await saveEvent(h.database, h.ws, { name: 'Baby shower', startsOn: '2026-09-01', endsOn: '2026-09-30' });
    const hampers = await saveEventItem(h.database, h.ws, shower, { name: 'Hampers', unitPriceMinor: 3_000_000, categoryAccountId: h.gear.id });
    await tagTransaction(h.database, h.ws, receipt, shower);

    // The cot's Rp10.000 is an occasion this payment is no longer on: none of the receipt is spoken for here.
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ totalMinor: 3_000_000, givenMinor: 0, leftMinor: 3_000_000 });
    // So the ordinary tick claims the whole receipt, and the plan reads neither over nor under.
    await linkEventItem(h.database, h.ws, hampers, receipt);
    expect(await eventPlanFor(h.database, h.ws, shower)).toMatchObject({
      boughtActualMinor: 3_000_000,
      spentMinor: 3_000_000,
      differenceMinor: 0,
      notPlannedMinor: 0,
    });

    // Tagged back, the cot answers exactly as it did: the reading was narrowed, nothing was torn down.
    await tagTransaction(h.database, h.ws, receipt, h.eventId);
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ givenMinor: 1_000_000, leftMinor: 2_000_000 });
  });

  it('answers no item while it is tagged to no occasion at all', async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    await linkEventItem(h.database, h.ws, cot, receipt, 1_000_000);

    await tagTransaction(h.database, h.ws, receipt, null);
    // An untagged payment belongs to no plan, so nothing of it is given away — and nothing may be written to it.
    expect(await purchaseCover(h.database, h.ws, receipt)).toMatchObject({ totalMinor: 3_000_000, givenMinor: 0, leftMinor: 3_000_000 });
    await expect(linkEventItem(h.database, h.ws, cot, receipt)).rejects.toMatchObject({ code: 'NOT_TAGGED' });
    // The share it already carries is untouched by the reading either way.
    expect(await coverPairs(h.database)).toEqual([[receipt, 1_000_000]]);
  });
});

/*
 * The write side of the same move. "What it covers" shows the items of the occasion the payment is tagged to now, so
 * that is the only scope it may unpick: saving on the new occasion must not reach back and pull the tick off the old
 * one's item, which is invisible on that screen and can therefore never be in the list being saved. Unscoped, the
 * sweep set that row to (null, null) and tagging the payment back no longer brought the share home — a figure the
 * user typed, destroyed by a save they made somewhere else.
 */
describe('a cover saved on the occasion a receipt has moved to', () => {
  const moved = async () => {
    const h = await mothercare();
    const cot = await h.item('Cot', 1, 2_000_000, h.gear.id);
    const receipt = await h.buy(h.gear.id, 3_000_000, 'Toko Bayi');
    await linkEventItem(h.database, h.ws, cot, receipt, 1_000_000);

    const shower = await saveEvent(h.database, h.ws, { name: 'Baby shower', startsOn: '2026-09-01', endsOn: '2026-09-30' });
    const hampers = await saveEventItem(h.database, h.ws, shower, { name: 'Hampers', unitPriceMinor: 2_000_000, categoryAccountId: h.gear.id });
    const cake = await saveEventItem(h.database, h.ws, shower, { name: 'Cake', unitPriceMinor: 500_000, categoryAccountId: h.gear.id });
    await tagTransaction(h.database, h.ws, receipt, shower);
    return { ...h, cot, receipt, shower, hampers, cake };
  };

  it('leaves the occasion it came from holding exactly the share that was typed there', async () => {
    const h = await moved();
    await setPurchaseCover(h.database, h.ws, h.receipt, [{ itemId: h.hampers, shareMinor: 3_000_000 }]);

    // Untouched in the table, not merely unread: the cot still names the receipt and still holds its Rp10.000.
    expect(await coverOfItem(h.database, h.cot)).toEqual([h.receipt, 1_000_000]);
    expect(await coverOfItem(h.database, h.hampers)).toEqual([h.receipt, 3_000_000]);

    // And tagging the payment back brings the tick home, which is the whole reason the link is left standing.
    await tagTransaction(h.database, h.ws, h.receipt, h.eventId);
    expect(await purchaseCover(h.database, h.ws, h.receipt)).toMatchObject({ givenMinor: 1_000_000, leftMinor: 2_000_000 });
    expect(await eventPlanFor(h.database, h.ws, h.eventId)).toMatchObject({
      boughtCount: 1,
      boughtActualMinor: 1_000_000,
      notPlannedMinor: 2_000_000,
    });
  });

  it('still unpicks the ticks on its own occasion that the save leaves out', async () => {
    const h = await moved();
    await setPurchaseCover(h.database, h.ws, h.receipt, [
      { itemId: h.hampers, shareMinor: 2_000_000 },
      { itemId: h.cake, shareMinor: 500_000 },
    ]);

    await setPurchaseCover(h.database, h.ws, h.receipt, [{ itemId: h.hampers, shareMinor: 2_000_000 }]);
    expect(await coverOfItem(h.database, h.cake)).toEqual([null, null]);
    expect(await coverOfItem(h.database, h.hampers)).toEqual([h.receipt, 2_000_000]);
    expect(await purchaseCover(h.database, h.ws, h.receipt)).toMatchObject({ givenMinor: 2_000_000, leftMinor: 1_000_000 });
  });

  it('saves an empty cover against an untagged payment without reaching any occasion at all', async () => {
    const h = await moved();
    await setPurchaseCover(h.database, h.ws, h.receipt, [{ itemId: h.hampers, shareMinor: 2_000_000 }]);
    await tagTransaction(h.database, h.ws, h.receipt, null);

    // Nothing is on screen to untick, so nothing is unticked — on either occasion.
    await setPurchaseCover(h.database, h.ws, h.receipt, []);
    expect(await coverOfItem(h.database, h.cot)).toEqual([h.receipt, 1_000_000]);
    expect(await coverOfItem(h.database, h.hampers)).toEqual([h.receipt, 2_000_000]);
  });
});
