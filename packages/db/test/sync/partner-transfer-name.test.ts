import { transferLines, transferName, transferSideOf } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  confirmReview,
  createAccount,
  createCardAccount,
  inBook,
  listSharedTransfers,
  listTransactions,
  postTransaction,
  recordMemberTransfer,
  saveCardTerms,
  setJointAccount,
} from '../../src/index';
import { itemIdOf } from '../../src/sync/net-worth/summaries';
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

  it('a shared loan called like the bank does not hide which item the bank is', async () => {
    const { home, rina, andi, bookId } = await household();
    const loan = await createAccount(rina.database, rina.ws, { name: 'Rina Bank', kind: 'liability', subtype: 'loan', currency: 'IDR' });
    await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total', [rina.usd]: 'hidden', [loan.id]: 'total' });
    await settle(home);
    await move(rina, bookId, rina.bank, rina.cash, 'ATM');
    await settle(home);
    expect((await listSharedTransfers(andi.database, bookId))[0]?.name).toBe('Cash withdrawal');
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

/** What a phone's own list names the row by, worked out from its two money lines as the list does (`transferSideOf`). */
async function ownName(d: Device, description: string) {
  const tx = (await listTransactions(d.database, d.ws)).find((t) => t.description === description);
  const money = (tx?.entries ?? []).filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability').sort((a, b) => a.amountMinor - b.amountMinor);
  return money.length === 2 ? transferName(transferSideOf(money[0]!), transferSideOf(money[1]!)) : undefined;
}

describe('a card payment and a bank transfer, named alike on both phones', () => {
  it('a bank into a shared card reads Credit card payment, a bank into a shared saving account Bank transfer', async () => {
    const { home, rina, andi, bookId } = await household();
    const card = await createCardAccount(rina.database, rina.ws, { name: 'Rina Kartu', subtype: 'credit_card', currency: 'IDR', last4: '7731' });
    await saveCardTerms(rina.database, rina.ws, { accountId: card.id, statementDay: 20, dueDay: 5, creditLimitMinor: 30_000_000, annualFeeMinor: null });
    const savings = await createAccount(rina.database, rina.ws, { name: 'Rina Tabungan', kind: 'asset', subtype: 'savings', currency: 'IDR' });
    await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total', [rina.usd]: 'hidden', [card.id]: 'total', [savings.id]: 'total' });
    await settle(home);

    await move(rina, bookId, rina.bank, card.id, 'Credit card payment');
    await move(rina, bookId, rina.bank, savings.id, 'Put away');
    await settle(home);
    expect(await ownName(rina, 'Credit card payment')).toBe('Credit card payment');
    expect(await ownName(rina, 'Put away')).toBe('Bank transfer');
    expect((await listSharedTransfers(andi.database, bookId)).map((t) => [t.description, t.name]).sort()).toEqual([
      ['Credit card payment', 'Credit card payment'],
      ['Put away', 'Bank transfer'],
    ]);
  });
});

describe('a transfer between partners, named by the partner’s item', () => {
  it('Rina’s bank to Andi’s bank reads Bank transfer on both phones, never Cash withdrawal from the placeholder', async () => {
    const { home, rina, andi, bookId } = await household();
    await confirmReview(andi.database, andi.ws, { [andi.bank]: 'total' });
    await settle(home);
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    await recordMemberTransfer(rina.database, bookId, {
      occurredOn: '2026-10-31',
      amountMinor: 1_250_000_00,
      currency: 'IDR',
      from: { owner: rina.memberId, itemId: await itemIdOf(groupBookId, rina.bank) },
      to: { owner: andi.memberId, itemId: await itemIdOf(groupBookId, andi.bank) },
      description: 'Sekolah Contoh',
    });
    await settle(home);

    for (const d of [rina, andi]) {
      const tx = (await listTransactions(d.database, d.ws)).find((t) => t.description === 'Sekolah Contoh');
      // The placeholder line says whose money it is and what that is, never by its own 'cash'.
      expect(tx?.entries.find((e) => e.placeholder)).toMatchObject({ accountSubtype: 'cash', placeholder: true, partnerSubtype: 'bank' });
      expect(await ownName(d, 'Sekolah Contoh')).toBe('Bank transfer');
    }
  });

  it('a partner’s item unknown here reads plain Transfer', async () => {
    const { home, rina, andi, bookId } = await household();
    await confirmReview(andi.database, andi.ws, { [andi.bank]: 'total' });
    await settle(home);
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    await recordMemberTransfer(rina.database, bookId, {
      occurredOn: '2026-10-31',
      amountMinor: 400_000_00,
      currency: 'IDR',
      from: { owner: rina.memberId, itemId: await itemIdOf(groupBookId, rina.cash) },
      to: { owner: andi.memberId, itemId: await itemIdOf(groupBookId, andi.bank) },
      description: 'Uang saku',
    });
    await settle(home);
    // Andi stops sharing his bank: Rina's phone no longer knows what it is.
    await confirmReview(andi.database, andi.ws, { [andi.bank]: 'hidden' });
    await settle(home);
    const tx = (await listTransactions(rina.database, rina.ws)).find((t) => t.description === 'Uang saku');
    expect(tx?.entries.find((e) => e.placeholder)?.partnerSubtype).toBeUndefined();
    expect(await ownName(rina, 'Uang saku')).toBeNull();
  });
});
