import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { confirmReview, createAccount, pendingHidden, setShareSetting } from '../../src/index';
import { receivedItems } from '../../src/sync/net-worth/summaries';
import { Household, type Device } from './household';

/*
 * Joint net worth end to end (wave 3: task 5's proposals and share settings wired to task 6's summaries). Rina and Andi
 * set up one tax ID through the engine; Sari is in the workspace and never in the group. Nothing is sent before a
 * member's own Share; after it, each receives the other's items; an item Rina had hidden arrives only with her Share;
 * a new item added in joint mode is shared as the add form writes it (D9); Sari never holds a summary.
 */

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
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
});
