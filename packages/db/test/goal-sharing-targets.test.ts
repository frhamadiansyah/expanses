import { describe, expect, it } from 'vitest';
import { goalShareTargets, SHARED_GOALS_MIN_APP_VERSION } from '../src/index';
import { Household } from './sync/household';

/* Who a goal can be shared with (shared goals §8.6, C3, D6): a shared workspace, another member, no old build in it. */

async function pair(rinaVersion: string) {
  const h = new Household();
  const bima = await h.device('Bima', 'member-Bima', 'IDR', '0.5.0');
  const rina = await h.device('Rina', 'member-Rina', 'IDR', rinaVersion);
  const bookId = await h.share(bima);
  await h.join(rina, bima);
  await h.settle();
  return { h, bima, rina, bookId };
}

describe('goalShareTargets', () => {
  it('the gate is 0.5.0', () => expect(SHARED_GOALS_MIN_APP_VERSION).toBe('0.5.0'));

  it('no shared workspace, no target', async () => {
    const h = new Household();
    const bima = await h.device('Bima', 'member-Bima', 'IDR', '0.5.0');
    expect(await goalShareTargets(bima.database)).toEqual([]);
  });

  it('a workspace shared with no one else is no target', async () => {
    const h = new Household();
    const bima = await h.device('Bima', 'member-Bima', 'IDR', '0.5.0');
    await h.share(bima);
    expect(await goalShareTargets(bima.database)).toEqual([]);
  });

  it('one other member', async () => {
    const { bima, rina, bookId } = await pair('0.5.0');
    expect(await goalShareTargets(bima.database)).toEqual([{ bookId, bookName: 'Personal', me: 'member-Bima', others: [{ memberId: 'member-Rina', name: 'Rina' }] }]);
    expect(await goalShareTargets(rina.database)).toEqual([{ bookId, bookName: 'Personal', me: 'member-Rina', others: [{ memberId: 'member-Bima', name: 'Bima' }] }]);
  });

  it('an old device hides the switch', async () => {
    const { bima, rina } = await pair('0.4.0');
    expect(await goalShareTargets(bima.database)).toEqual([]);
    expect(await goalShareTargets(rina.database)).toEqual([]);
  });

  it('a removed old device does not', async () => {
    const { h, bima, rina, bookId } = await pair('0.4.0');
    const newer = await h.device('Rina2', 'member-Rina', 'IDR', '0.5.0');
    // Rina's newer phone joins as Rina (S§8.3): once her old one is removed she is still in, on a current build.
    const { code } = await bima.engine.createInvite(bookId, { inviterName: 'Bima', sameMember: true, memberId: rina.memberId });
    await newer.engine.joinBook(code, { ws: newer.ws, memberName: 'Rina', deviceName: "Rina's new phone", memberId: rina.memberId });
    await h.settle();
    await bima.engine.removeDevice(bookId, rina.deviceId);
    await h.settle([bima, newer]);
    expect((await goalShareTargets(bima.database)).length).toBe(1);
  });

  it('a book no longer shared is no target', async () => {
    const { h, bima, rina, bookId } = await pair('0.5.0');
    await bima.engine.stopSharing(bookId);
    await h.settle([rina]);
    expect(await goalShareTargets(rina.database)).toEqual([]);
  });
});
