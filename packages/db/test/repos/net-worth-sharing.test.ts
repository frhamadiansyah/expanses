import { describe, expect, it } from 'vitest';
import {
  activeNetWorthGroup,
  confirmReview,
  createAccount,
  getShareSetting,
  pendingHidden,
  reviewItems,
  setShareSetting,
} from '../../src/index';
import { Household } from '../sync/household';

/*
 * What each person shares of their own items (joint-net-worth spec §5.4, §8.1, D7–D9). Owner scope, never synced; the
 * one rule that reads the group is D7: `Don't share` only while the household files separately.
 */

async function couple(mode: 'joint' | 'separate' | null) {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  if (mode) {
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode, members: [andi.memberId] });
    for (let i = 0; i < 3; i += 1) await home.settle();
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    for (let i = 0; i < 3; i += 1) await home.settle();
  }
  return { home, rina, andi, bookId };
}

describe('share settings (§5.4)', () => {
  it('with no group: every item is listed unreviewed, and either setting may be chosen', async () => {
    const { rina } = await couple(null);
    const card = await createAccount(rina.database, rina.ws, { name: 'BCA Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const items = await reviewItems(rina.database, rina.ws);
    // The household's own three accounts and the card; no category, no system account.
    expect(items.map((i) => i.name).sort()).toEqual(['BCA Card', 'Rina Bank', 'Rina Dollars', 'Rina Wallet']);
    expect(items.every((i) => i.setting === null)).toBe(true);
    expect(items.find((i) => i.accountId === card.id)).toMatchObject({ kind: 'liability', subtype: 'credit_card' });
    expect(await activeNetWorthGroup(rina.database)).toBeNull();
    await setShareSetting(rina.database, card.id, 'hidden');
    expect(await getShareSetting(rina.database, card.id)).toBe('hidden');
    expect(await pendingHidden(rina.database, rina.ws)).toEqual([]);
  });

  it('separate: the review writes a row for every item, as chosen, `total` where nothing was said', async () => {
    const { rina } = await couple('separate');
    expect((await activeNetWorthGroup(rina.database))?.mode).toBe('separate');
    await confirmReview(rina.database, rina.ws, { [rina.cash]: 'hidden' });
    const items = await reviewItems(rina.database, rina.ws);
    expect(Object.fromEntries(items.map((i) => [i.accountId, i.setting]))).toEqual({ [rina.bank]: 'total', [rina.usd]: 'total', [rina.cash]: 'hidden' });
  });

  it("joint: `Don't share` is refused, and the review shares every item whatever it was asked", async () => {
    const { rina, andi, bookId } = await couple('joint');
    expect(await activeNetWorthGroup(andi.database)).toMatchObject({ workspaceBookId: expect.any(String), mode: 'joint', members: [rina.memberId, andi.memberId] });
    await expect(setShareSetting(rina.database, rina.bank, 'hidden')).rejects.toMatchObject({ code: 'joint-forbids-hidden' });
    expect(await getShareSetting(rina.database, rina.bank)).toBeNull();
    await confirmReview(rina.database, rina.ws, { [rina.cash]: 'hidden' });
    expect((await reviewItems(rina.database, rina.ws)).every((i) => i.setting === 'total')).toBe(true);
    void bookId;
  });
});
