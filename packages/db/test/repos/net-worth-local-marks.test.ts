import { describe, expect, it } from 'vitest';
import {
  activeNetWorthGroup,
  clearJointAccounts,
  confirmReview,
  getJointAccount,
  jointAccountIds,
  netWorthMarks,
  setJointAccount,
  setNetWorthMarks,
  setShareSetting,
  storedJointAccount,
} from '../../src/index';
import { Household } from '../sync/household';

/*
 * Household sharing, simplified (review round 1): what each phone keeps for itself about net worth — the items this
 * person switched on before a group was active, that this person stopped or declined, that a group was seen here — and
 * Owned together read only while a group is active. Local only, never synced. Names invented.
 */

async function couple(withGroup: boolean) {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  if (withGroup) {
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
    for (let i = 0; i < 3; i += 1) await home.settle();
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    for (let i = 0; i < 3; i += 1) await home.settle();
  }
  return { home, rina, andi, bookId };
}

describe('Owned together is read only while a group is active', () => {
  it('a joint flag stored with no active group reads as nothing — on its own, and in the list Cashflow reads', async () => {
    const { rina } = await couple(false);
    expect(await activeNetWorthGroup(rina.database)).toBeNull();
    await setShareSetting(rina.database, rina.bank, 'total');
    await setJointAccount(rina.database, rina.bank, true);
    expect(await storedJointAccount(rina.database, rina.bank)).toBe(true);
    expect(await getJointAccount(rina.database, rina.bank)).toBe(false);
    expect(await jointAccountIds(rina.database)).toEqual([]);
  });

  it('with a group active it reads; cleared, it does not come back when sharing is switched on again', async () => {
    const { rina } = await couple(true);
    await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total' }, { missing: 'hidden' });
    await setJointAccount(rina.database, rina.bank, true);
    expect(await jointAccountIds(rina.database)).toEqual([rina.bank]);
    await clearJointAccounts(rina.database);
    expect(await jointAccountIds(rina.database)).toEqual([]);
    await setShareSetting(rina.database, rina.bank, 'hidden');
    await setShareSetting(rina.database, rina.bank, 'total');
    expect(await getJointAccount(rina.database, rina.bank)).toBe(false);
  });
});

describe('each phone’s own net worth marks', () => {
  it('start empty, are kept per workspace, and change only as written', async () => {
    const { rina, bookId } = await couple(false);
    expect(await netWorthMarks(rina.database, bookId)).toEqual({ intent: [], optedOut: false, seen: false });
    await setNetWorthMarks(rina.database, bookId, { intent: [rina.bank, rina.cash] });
    await setNetWorthMarks(rina.database, bookId, { optedOut: true });
    expect(await netWorthMarks(rina.database, bookId)).toEqual({ intent: [rina.bank, rina.cash], optedOut: true, seen: false });
    await setNetWorthMarks(rina.database, bookId, { intent: [], seen: true, optedOut: false });
    expect(await netWorthMarks(rina.database, bookId)).toEqual({ intent: [], optedOut: false, seen: true });
    expect(await netWorthMarks(rina.database, 'another-book')).toEqual({ intent: [], optedOut: false, seen: false });
  });
});
