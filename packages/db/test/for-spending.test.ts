import { beforeEach, describe, expect, it } from 'vitest';
import { addPocket, createAccount, listAccounts, makeMultiCurrency, MIGRATIONS, openCashAccount, openPocketedAccount, setAccountForSpending, spendingSwitchOn, type Database, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

/**
 * "For spending" (0086): which money is paid from, and which is kept as savings. On by default; set on an account and
 * on each of its pockets, and read together, because the lists that ask offer the pockets rather than the account.
 */

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const byId = async (id: string) => (await listAccounts(database, ws, { includeArchived: true })).find((row) => row.id === id)!;

describe('migration 0086', () => {
  it('is version 86 and named account_for_spending', () => {
    expect(MIGRATIONS.find((m) => m.version === 86)).toMatchObject({ name: 'account_for_spending' });
  });
});

describe('for spending', () => {
  it('is on for every account until it is switched off, and comes back when switched on', async () => {
    const savings = await openCashAccount(database, ws, { item: 'savings', name: 'Rainy day', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-09-01' });
    expect((await byId(savings.id)).forSpending).toBe(1);
    await setAccountForSpending(database, ws, savings.id, false);
    expect((await byId(savings.id)).forSpending).toBe(0);
    await setAccountForSpending(database, ws, savings.id, true);
    expect((await byId(savings.id)).forSpending).toBe(1);
  });

  it('reads a pocket off when its account is, and otherwise by its own switch', async () => {
    expect(spendingSwitchOn({ forSpending: 1 }, { forSpending: 1 })).toBe(true);
    expect(spendingSwitchOn({ forSpending: 0 }, { forSpending: 1 })).toBe(false);
    expect(spendingSwitchOn({ forSpending: 1 }, { forSpending: 0 })).toBe(false);
    expect(spendingSwitchOn({ forSpending: 0 }, { forSpending: 0 })).toBe(false);
    // No switch on either side — a row read before 0086, or with no account above it — is on.
    expect(spendingSwitchOn({}, {})).toBe(true);
    expect(spendingSwitchOn({ forSpending: 1 })).toBe(true);
    expect(spendingSwitchOn({ forSpending: 1 }, null)).toBe(true);
  });

  it('is read off the account for every pocket, and a pocket added later follows', async () => {
    const { parent, pockets } = await openPocketedAccount(database, ws, {
      item: 'bank',
      name: 'Wise',
      pockets: [{ currency: 'USD', openingBalanceMinor: 100_00, openingRateToBase: 16_250 }, { currency: 'IDR', openingBalanceMinor: 1_000_000 }],
    });
    await setAccountForSpending(database, ws, parent.id, false);
    for (const pocket of pockets) expect((await byId(pocket.id)).forSpending).toBe(0);
    const sgd = await addPocket(database, ws, { parentId: parent.id, currency: 'SGD', openingBalanceMinor: 50_00, openedOn: '2026-09-21', openingRateToBase: 12_680 });
    expect(sgd.forSpending).toBe(0);
    expect((await byId(sgd.id)).forSpending).toBe(0);
    // Switched back on, the account and every pocket read on again.
    await setAccountForSpending(database, ws, parent.id, true);
    for (const id of [parent.id, ...pockets.map((p) => p.id), sgd.id]) expect((await byId(id)).forSpending).toBe(1);
  });

  it('switches one pocket off and on by itself, leaving the account and the other pockets on', async () => {
    const { parent, pockets } = await openPocketedAccount(database, ws, {
      item: 'cash',
      name: 'Cash',
      pockets: [{ currency: 'IDR', openingBalanceMinor: 500_000 }, { currency: 'TRY', openingBalanceMinor: 1_200_00, openingRateToBase: 480 }],
    });
    const [idr, lira] = pockets;
    await setAccountForSpending(database, ws, lira!.id, false);
    expect((await byId(lira!.id)).forSpending).toBe(0);
    expect((await byId(idr!.id)).forSpending).toBe(1);
    expect((await byId(parent.id)).forSpending).toBe(1);
    await setAccountForSpending(database, ws, lira!.id, true);
    expect((await byId(lira!.id)).forSpending).toBe(1);
  });

  it('keeps a pocket switched off through the account going off and on again', async () => {
    const { parent, pockets } = await openPocketedAccount(database, ws, {
      item: 'cash',
      name: 'Cash',
      pockets: [{ currency: 'IDR', openingBalanceMinor: 500_000 }, { currency: 'TRY', openingBalanceMinor: 1_200_00, openingRateToBase: 480 }],
    });
    const [idr, lira] = pockets;
    await setAccountForSpending(database, ws, lira!.id, false);
    await setAccountForSpending(database, ws, parent.id, false);
    // The account off: every pocket reads off, the rupiah one too.
    expect((await byId(idr!.id)).forSpending).toBe(0);
    expect((await byId(lira!.id)).forSpending).toBe(0);
    // A pocket's own switch can still be written while its account is off; it reads off until the account is on.
    await setAccountForSpending(database, ws, idr!.id, true);
    expect((await byId(idr!.id)).forSpending).toBe(0);
    await setAccountForSpending(database, ws, parent.id, true);
    expect((await byId(idr!.id)).forSpending).toBe(1);
    expect((await byId(lira!.id)).forSpending).toBe(0);
  });

  it('has every pocket on again when the account comes back on with all of them off', async () => {
    const { parent, pockets } = await openPocketedAccount(database, ws, { item: 'bank', name: 'Wise', pockets: [{ currency: 'USD', openingRateToBase: 16_250 }, { currency: 'IDR' }] });
    for (const pocket of pockets) await setAccountForSpending(database, ws, pocket.id, false);
    await setAccountForSpending(database, ws, parent.id, false);
    await setAccountForSpending(database, ws, parent.id, true);
    for (const pocket of pockets) expect((await byId(pocket.id)).forSpending).toBe(1);
  });

  it('stays with the account when a second currency turns it into one with pockets', async () => {
    const plain = await openCashAccount(database, ws, { item: 'bank', name: 'Everyday', currency: 'IDR', openingBalanceMinor: 2_000_000, openedOn: '2026-09-01' });
    await setAccountForSpending(database, ws, plain.id, false);
    const { parent } = await makeMultiCurrency(database, ws, { accountId: plain.id, currency: 'USD', openingBalanceMinor: 100_00, openedOn: '2026-09-02', openingRateToBase: 16_250 });
    expect((await byId(parent.id)).forSpending).toBe(0);
    expect((await byId(plain.id)).forSpending).toBe(0);
    // The switch moved to the account: on again, the old account (now its first pocket) is spent from again.
    await setAccountForSpending(database, ws, parent.id, true);
    expect((await byId(plain.id)).forSpending).toBe(1);
  });

  it('is on for a credit card until switched off, and the account list says so', async () => {
    const card = await createAccount(database, ws, { name: 'Blue Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    expect((await byId(card.id)).forSpending).toBe(1);
    await setAccountForSpending(database, ws, card.id, false);
    const off = await byId(card.id);
    expect(off.forSpending).toBe(0);
    expect(off.archivedAt).toBeNull();
    expect(spendingSwitchOn(off)).toBe(false);
    await setAccountForSpending(database, ws, card.id, true);
    expect((await byId(card.id)).forSpending).toBe(1);
    const loan = await createAccount(database, ws, { name: 'KPR', kind: 'liability', subtype: 'loan', currency: 'IDR' });
    await expect(setAccountForSpending(database, ws, loan.id, false)).rejects.toThrow('not money that can be spent from');
  });

  it('is only a question about money that can be spent from', async () => {
    const deposit = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Locked', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-09-01', maturesOn: '2026-12-01' });
    await expect(setAccountForSpending(database, ws, deposit.id, false)).rejects.toThrow('not money that can be spent from');
    const gold = await createAccount(database, ws, { name: 'Gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await expect(setAccountForSpending(database, ws, gold.id, false)).rejects.toThrow('not money that can be spent from');
  });
});
