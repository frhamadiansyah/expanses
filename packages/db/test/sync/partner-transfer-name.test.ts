import { transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { confirmReview, inBook, listSharedTransfers, postTransaction, setJointAccount } from '../../src/index';
import { Household, type Device } from './household';

/*
 * A transfer the recorder named by its accounts ("Cash withdrawal", feat/cash-withdrawal-label) reads the same on the
 * partner's phone (fix/sync-card-tier). The redacted row carries account names only, never kinds; the partner's phone
 * reads each side's kind from the recorder's net-worth item of it, which already carries its subtype and currency.
 * A private side is never named, so such a transfer keeps reading "Transfer". Invented names and figures throughout.
 */

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina and Andi in one workspace; with `group`, in one net-worth group too, Rina sharing her bank and wallet. */
async function household(group = true) {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  if (group) {
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    await settle(home);
    await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total', [rina.usd]: 'hidden' });
    await settle(home);
  }
  return { home, rina, andi, bookId };
}

async function move(d: Device, bookId: string, from: string, to: string, description: string, currency = 'IDR') {
  await postTransaction(d.database, inBook(d.ws, bookId), {
    occurredOn: '2026-10-08',
    description,
    fileTransfer: true,
    lines: transferLines({ fromAccountId: from, toAccountId: to, amountMinor: 500_000, currency }),
  });
}

describe('a partner’s transfer named by its accounts', () => {
  it('reads Cash withdrawal and Cash deposit when both sides are shared, the note kept as it was', async () => {
    const { home, rina, andi, bookId } = await household();
    await move(rina, bookId, rina.bank, rina.cash, 'Bank Contoh ATM');
    await settle(home);
    expect(await listSharedTransfers(andi.database, bookId)).toMatchObject([{ description: 'Bank Contoh ATM', name: 'Cash withdrawal', fromName: 'Rina Bank', toName: 'Rina Wallet' }]);

    await move(rina, bookId, rina.cash, rina.bank, 'Back in');
    await settle(home);
    expect((await listSharedTransfers(andi.database, bookId)).map((t) => [t.description, t.name]).sort()).toEqual([
      ['Back in', 'Cash deposit'],
      ['Bank Contoh ATM', 'Cash withdrawal'],
    ]);
  });

  it('a joint account is found by its item, whatever it is called', async () => {
    const { home, rina, andi, bookId } = await household();
    await setJointAccount(rina.database, rina.bank, true);
    await settle(home);
    await move(rina, bookId, rina.bank, rina.cash, 'ATM');
    await settle(home);
    expect((await listSharedTransfers(andi.database, bookId))[0]?.name).toBe('Cash withdrawal');
  });

  it('never names a transfer with a private side, and names nothing without a net-worth group', async () => {
    const { home, rina, andi, bookId } = await household();
    // The wallet hidden from the household now: a withdrawal into it would say what it is.
    await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'hidden', [rina.usd]: 'hidden' });
    await settle(home);
    await move(rina, bookId, rina.bank, rina.cash, 'Bank Contoh ATM');
    await settle(home);
    const [hidden] = await listSharedTransfers(andi.database, bookId);
    expect(hidden).toMatchObject({ description: 'Bank Contoh ATM', fromName: 'Rina Bank', toName: null, name: null });

    const bare = await household(false);
    await move(bare.rina, bare.bookId, bare.rina.bank, bare.rina.cash, 'ATM');
    await settle(bare.home);
    expect((await listSharedTransfers(bare.andi.database, bare.bookId))[0]?.name).toBeNull();
  });
});
