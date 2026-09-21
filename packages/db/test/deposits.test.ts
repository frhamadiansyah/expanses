import { beforeEach, describe, expect, it } from 'vitest';
import type { MoneyAccountSubtype } from '@expanses/core';
import {
  assetValuesAt,
  createWorkspace,
  type Database,
  getAssetProfile,
  getDebtProfile,
  getDepositTerms,
  nativeBalances,
  netWorthAt,
  openCashAccount,
  openDebtBalance,
  postTransaction,
  SPENDABLE_SUBTYPES,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('opening an account from the catalogue', () => {
  it('writes the account, its tax code and its group in one go', async () => {
    const gopay = await openCashAccount(database, ws, { item: 'ewallet', name: 'GoPay', currency: 'IDR', openingBalanceMinor: 500_000, openedOn: '2026-09-01' });

    const profile = await getAssetProfile(database, ws, gopay.id);
    expect(profile).toMatchObject({ assetKind: 'cash', planGroup: 'liquid', coretaxSection: 'kas', coretaxCode: '0105' });
    expect((await assetValuesAt(database, ws, '2026-09-18')).find((row) => row.accountId === gopay.id)).toMatchObject({
      valueMinor: 500_000,
      mode: 'derived',
      planGroup: 'liquid',
    });
  });

  it('gives each kind of money account the code the form expects', async () => {
    const codes: [MoneyAccountSubtype, string][] = [
      ['cash', '0101'],
      ['bank', '0102'],
      ['savings', '0102'],
      ['time_deposit', '0104'],
      ['ewallet', '0105'],
      ['fund', '0109'],
      ['other_cash', '0109'],
    ];
    for (const [item, code] of codes) {
      // Only the deposit reads maturesOn; the others ignore it, which is what lets one loop cover all seven.
      const account = await openCashAccount(database, ws, { item, name: `A ${item}`, currency: 'IDR', maturesOn: '2027-03-01' });
      expect((await getAssetProfile(database, ws, account.id))?.coretaxCode).toBe(code);
    }
  });
});

describe('a time deposit', () => {
  it('holds money it cannot be paid from', async () => {
    expect(SPENDABLE_SUBTYPES).not.toContain('time_deposit');
    expect(SPENDABLE_SUBTYPES).toContain('other_cash');
  });

  it('keeps its maturity and its rate beside it', async () => {
    const deposito = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'Deposito BCA 6 bulan',
      currency: 'IDR',
      openingBalanceMinor: 100_000_000,
      openedOn: '2026-09-01',
      maturesOn: '2027-03-01',
      rateBps: 625,
    });
    expect(await getDepositTerms(database, ws, deposito.id)).toMatchObject({ maturesOn: '2027-03-01', rateBps: 625 });
  });

  it('is never read across a workspace boundary', async () => {
    const deposito = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'Deposito BCA 6 bulan',
      currency: 'IDR',
      maturesOn: '2027-03-01',
      rateBps: 625,
    });
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    expect(await getDepositTerms(database, other, deposito.id)).toBeUndefined();
  });

  it('counts as cash you hold, and the money leaves by a transfer when it matures', async () => {
    const bca = await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-09-01' });
    const deposito = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'Deposito BCA 6 bulan',
      currency: 'IDR',
      openingBalanceMinor: 100_000_000,
      openedOn: '2026-09-01',
      maturesOn: '2027-03-01',
      rateBps: 625,
    });

    expect((await netWorthAt(database, ws, '2026-09-18', {})).assetsMinor).toBe(120_000_000);
    const values = await assetValuesAt(database, ws, '2026-09-18');
    expect(values.find((row) => row.accountId === deposito.id)).toMatchObject({ planGroup: 'liquid', valueMinor: 100_000_000 });

    await postTransaction(database, ws, {
      occurredOn: '2027-03-01',
      description: 'Deposito matured',
      lines: [
        { accountId: deposito.id, amountMinor: -100_000_000, currency: 'IDR' },
        { accountId: bca.id, amountMinor: 100_000_000, currency: 'IDR' },
      ],
    });
    const after = await assetValuesAt(database, ws, '2027-03-01');
    expect(after.find((row) => row.accountId === deposito.id)?.valueMinor).toBe(0);
    expect(after.find((row) => row.accountId === bca.id)?.valueMinor).toBe(120_000_000);
  });
});

describe('a debt or a receivable opened at a balance', () => {
  it('opens a person account with what is owed and the code that was chosen', async () => {
    const owed = await openDebtBalance(database, ws, {
      direction: 'lent',
      personName: 'PT Sejahtera',
      currency: 'IDR',
      balanceMinor: 25_000_000,
      openedOn: '2026-09-01',
      coretaxCode: '0202',
    });
    expect(await getDebtProfile(database, ws, owed.id)).toMatchObject({ direction: 'lent', personName: 'PT Sejahtera', coretaxCode: '0202' });
    expect((await nativeBalances(database, ws))[owed.id]).toBe(25_000_000);

    const oweThem = await openDebtBalance(database, ws, {
      direction: 'borrowed',
      personName: 'Ibu',
      currency: 'IDR',
      balanceMinor: 10_000_000,
      openedOn: '2026-09-01',
      coretaxCode: '103',
    });
    expect(await getDebtProfile(database, ws, oweThem.id)).toMatchObject({ direction: 'borrowed', coretaxCode: '103' });
    expect((await nativeBalances(database, ws))[oweThem.id]).toBe(-10_000_000);
  });
});
