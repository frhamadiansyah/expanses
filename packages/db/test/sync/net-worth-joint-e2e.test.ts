import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { expenseLines, isoDate } from '@expanses/core';
import { activeNetWorthGroup, confirmReview, createAccount, pendingHidden, postTransaction, reviewedFor, setShareSetting } from '../../src/index';
import { receivedItems } from '../../src/sync/net-worth/summaries';
import { categoryOf, Household, type Device } from './household';

/*
 * Joint net worth end to end (wave 3: task 5's proposals and share settings wired to task 6's summaries). Rina and Andi
 * set up one tax ID through the engine; Sari is in the workspace and never in the group. Nothing is sent before a
 * member's own Share; after it, each receives the other's items; an item Rina had hidden arrives only with her Share;
 * a new item added in joint mode is shared as the add form writes it (D9); Sari never holds a summary.
 */

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

const spend = (d: Device, categoryId: string, amountMinor: number) =>
  postTransaction(d.database, d.ws, {
    occurredOn: isoDate(),
    description: 'Household groceries',
    lines: expenseLines({ categoryAccountId: categoryId, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });

const bankOf = async (d: Device, groupBookId: string, owner: Device) =>
  (await receivedItems(d.database, groupBookId)).find((item) => item.owner === owner.memberId && item.name === `${owner.name} Bank`) ?? null;

/** Rina, Andi and Sari; Rina and Andi active in `mode` and both past their review (Share). */
async function sharing(mode: 'joint' | 'separate') {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode, members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, {});
  await confirmReview(andi.database, andi.ws, {});
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  const groceries = await categoryOf(rina.database, bookId, 'Groceries');
  return { home, rina, andi, sari, bookId, groupBookId, groceries };
}

const namesFrom = async (d: Device, groupBookId: string, owner: string) =>
  (await receivedItems(d.database, groupBookId))
    .filter((item) => item.owner === owner)
    .map((item) => item.name)
    .sort();

describe('joint net worth, end to end', () => {
  it('propose one tax ID, confirm, each Share: both receive the other’s items, a hidden item only after Share, and Sari nothing', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const sari = await home.device('Sari');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.join(sari, rina);
    await home.settle();

    // Before any group, Rina keeps her wallet to herself.
    await setShareSetting(rina.database, rina.cash, 'hidden');

    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    await settle(home);
    const group = await rina.engine.netWorthGroup(bookId);
    expect(group.active).toEqual({ proposalId, mode: 'joint', members: [rina.memberId, andi.memberId] });
    const groupBookId = group.groupBookId!;
    expect((await andi.engine.netWorthGroup(bookId)).active?.proposalId).toBe(proposalId);

    // Active, but nobody has reviewed: nothing is sent (§6 Review).
    expect(await receivedItems(andi.database, groupBookId)).toEqual([]);
    expect(await receivedItems(rina.database, groupBookId)).toEqual([]);
    expect(await pendingHidden(rina.database, rina.ws)).toEqual([rina.cash]);

    // A setting Andi makes before his review (an item page's row) sends nothing yet: the review comes first (§6 Review).
    await setShareSetting(andi.database, andi.bank, 'total');
    await settle(home);
    expect(await receivedItems(rina.database, groupBookId)).toEqual([]);

    // Andi's Share: his items reach Rina; Rina's still reach nobody.
    await confirmReview(andi.database, andi.ws, {});
    await settle(home);
    expect(await namesFrom(rina, groupBookId, andi.memberId)).toEqual(['Andi Bank', 'Andi Dollars', 'Andi Wallet']);
    expect(await receivedItems(andi.database, groupBookId)).toEqual([]);

    // Rina's Share (one tax ID: every item total, D7): her hidden wallet arrives with the rest, and only now.
    await confirmReview(rina.database, rina.ws, {});
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Wallet']);
    expect(await pendingHidden(rina.database, rina.ws)).toEqual([]);

    // D9: an item added in joint mode is written `total` by the add form, and so it is sent.
    const savings = await createAccount(rina.database, rina.ws, { name: 'Rina Savings', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000 });
    await setShareSetting(rina.database, savings.id, 'total');
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Savings', 'Rina Wallet']);
    expect((await receivedItems(andi.database, groupBookId)).find((item) => item.name === 'Rina Savings')).toMatchObject({ balanceMinor: 10_000_000 });

    // Sari is in the workspace, not in the group: she holds no summary, and no group log.
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
    expect(await sari.engine.groupLogOf(bookId)).toBeNull();
  });

  it('a Change that adds Sari sends nothing of Rina’s — not even a refresh — until her Share on the new group; then Sari receives it (review round 1, finding 1)', async () => {
    const { home, rina, andi, sari, bookId, groupBookId, groceries } = await sharing('separate');
    expect(await bankOf(andi, groupBookId, rina)).toMatchObject({ balanceMinor: 0 });

    const change = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, change, 'confirm');
    await sari.engine.answerNetWorth(bookId, change, 'confirm');
    await settle(home);
    expect((await rina.engine.netWorthGroup(bookId)).active?.proposalId).toBe(change);
    expect((await activeNetWorthGroup(rina.database))?.proposalId).toBe(change);
    expect(await reviewedFor(rina.database, groupBookId, change)).toBe(false);

    // A write on a live item: the group grew, so not even its refresh goes out before Rina's Share.
    await spend(rina, groceries, 1_000_000);
    await settle(home);
    expect(await bankOf(andi, groupBookId, rina)).toMatchObject({ balanceMinor: 0 });
    expect(await bankOf(sari, groupBookId, rina)).not.toMatchObject({ balanceMinor: -1_000_000 });

    await confirmReview(rina.database, rina.ws, {});
    await settle(home);
    expect(await reviewedFor(rina.database, groupBookId, change)).toBe(true);
    expect(await namesFrom(sari, groupBookId, rina.memberId)).toEqual(['Rina Bank', 'Rina Dollars', 'Rina Wallet']);
    expect(await bankOf(sari, groupBookId, rina)).toMatchObject({ balanceMinor: -1_000_000 });
    expect(await bankOf(andi, groupBookId, rina)).toMatchObject({ balanceMinor: -1_000_000 });
  });

  it('a mode change with the same members asks for the review again; live items keep refreshing, a new item waits for Share', async () => {
    const { home, rina, andi, bookId, groupBookId, groceries } = await sharing('separate');
    const change = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, change, 'confirm');
    await settle(home);
    expect((await activeNetWorthGroup(rina.database))?.mode).toBe('joint');
    expect(await reviewedFor(rina.database, groupBookId, change)).toBe(false);

    // Nobody was added: a live item's refresh still goes out.
    await spend(rina, groceries, 2_000_000);
    await settle(home);
    expect(await bankOf(andi, groupBookId, rina)).toMatchObject({ balanceMinor: -2_000_000 });

    // A new item is not live yet: it waits for Share.
    const savings = await createAccount(rina.database, rina.ws, { name: 'Rina Savings', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000 });
    await setShareSetting(rina.database, savings.id, 'total');
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).not.toContain('Rina Savings');

    await confirmReview(rina.database, rina.ws, {});
    await settle(home);
    expect(await namesFrom(andi, groupBookId, rina.memberId)).toContain('Rina Savings');
  });
});
