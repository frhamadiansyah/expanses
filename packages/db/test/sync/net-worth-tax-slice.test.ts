import { expenseLines, isoDate, type ItemSummary } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmReview, createAccount, postTransaction, saveAssetProfile, setShareSetting, taxRowFor } from '../../src/index';
import { itemIdOf, sendSummariesTx } from '../../src/sync/net-worth/summaries';
import { categoryOf, Household } from './household';

/*
 * Final review item 7 (phone performance): a joint group's summaries carry each item's slice of the owner's tax inputs
 * for the latest finished year. The whole workspace's inputs are built once per send (per tax year) and sliced per item
 * — never once per item — and a write dated after that year's 31 December reuses the slice already sent.
 *
 * `coretaxInputsFor` reads every asset's value at the year's end (`assetValuesAt(…, 'YYYY-12-31')`) exactly once, so the
 * calls on that date count how many times the inputs were built.
 */

const yearEnds: string[] = [];
vi.mock('../../src/repos/asset-values', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/repos/asset-values')>();
  return {
    ...original,
    assetValuesAt: (...args: Parameters<typeof original.assetValuesAt>) => {
      if (args[2].endsWith('-12-31')) yearEnds.push(args[2]);
      return original.assetValuesAt(...args);
    },
  };
});

const today = isoDate();
const YEAR = Number(today.slice(0, 4)) - 1;

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina and Andi on one tax ID, both past their review; Rina shares a bank, a house and a second bank. */
async function joint() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, {});
  await confirmReview(andi.database, andi.ws, {});
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  const bca = await createAccount(rina.database, rina.ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: `${YEAR}-03-01` });
  await saveAssetProfile(rina.database, rina.ws, { accountId: bca.id, assetKind: 'cash', coretaxFields: { owner: 'Rina', inst: 'BCA', loc: 'IDN' } });
  const house = await createAccount(rina.database, rina.ws, { name: 'House', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 900_000_000, openedOn: '2021-03-25' });
  await saveAssetProfile(rina.database, rina.ws, { accountId: house.id, assetKind: 'property' });
  const mandiri = await createAccount(rina.database, rina.ws, { name: 'Mandiri', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: `${YEAR}-05-01` });
  for (const id of [bca.id, house.id, mandiri.id]) await setShareSetting(rina.database, id, 'total');
  await settle(home);
  return { home, rina, andi, bookId, groupBookId, items: [bca.id, house.id, mandiri.id, rina.bank, rina.cash], bca: bca.id };
}

type Rina = Awaited<ReturnType<typeof joint>>['rina'];

async function sentTax(rina: Rina, groupBookId: string, accountId: string): Promise<ItemSummary['tax']> {
  const [row] = await rina.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE book_id = ${groupBookId} AND item_id = ${await itemIdOf(groupBookId, accountId)}`);
  return (JSON.parse(row![0]) as ItemSummary).tax;
}

beforeEach(() => {
  yearEnds.length = 0;
});

describe('the tax slice is built once per send (final review item 7)', () => {
  it("a send of every item builds the year's inputs once, and each slice is exactly that item's own rows", async () => {
    const { rina, groupBookId, items } = await joint();
    await rina.database.db.run(sql`DELETE FROM nw_sent`);
    yearEnds.length = 0;
    const written = await rina.database.transaction((tx) => sendSummariesTx(tx, 'all', today));
    expect(written).toBeGreaterThanOrEqual(items.length);
    expect(yearEnds).toEqual([`${YEAR}-12-31`]);

    for (const accountId of items) {
      const itemId = await itemIdOf(groupBookId, accountId);
      const own = await taxRowFor(rina.database, rina.ws, accountId, YEAR);
      const rename = <T extends { accountId: string }>(rows: T[] | undefined) => (rows ?? []).map((row) => ({ ...row, accountId: itemId }));
      expect(await sentTax(rina, groupBookId, accountId)).toEqual({
        taxYear: YEAR,
        part: {
          cash: rename(own?.cash),
          holdings: rename(own?.holdings).map(({ purchases: _p, ...row }) => row),
          estimated: rename(own?.estimated),
          receivables: rename(own?.receivables),
          debts: rename(own?.debts),
        },
      });
    }
  });

  it("a purchase dated this year reuses the slice already sent; one dated in the tax year builds it again", async () => {
    const { rina, bookId, groupBookId, bca } = await joint();
    const before = await sentTax(rina, groupBookId, bca);
    expect(before?.part.cash).toHaveLength(1);
    const groceries = await categoryOf(rina.database, bookId, 'Groceries');
    const spend = (occurredOn: string) =>
      postTransaction(rina.database, rina.ws, { occurredOn, description: 'Groceries', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bca, amountMinor: 1_000_000, currency: 'IDR' }) });

    yearEnds.length = 0;
    await spend(today);
    expect(yearEnds).toEqual([]);
    expect(await sentTax(rina, groupBookId, bca)).toEqual(before);

    await spend(`${YEAR}-12-15`);
    expect(yearEnds).toEqual([`${YEAR}-12-31`]);
    const after = await sentTax(rina, groupBookId, bca);
    expect(after?.part.cash[0]?.balanceMinor).toBe(before!.part.cash[0]!.balanceMinor - 1_000_000);
  });
});
