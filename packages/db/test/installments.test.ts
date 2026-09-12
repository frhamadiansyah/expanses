import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  cardSpendLines,
  categoryIdsByKey,
  createAccount,
  type Database,
  deleteInstallment,
  installmentTotals,
  listInstallments,
  listTransactions,
  postTransaction,
  saveInstallment,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

let database: Database;
let ws: WorkspaceContext;
let card: AccountRow;
let categories: Record<string, string>;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  categories = await categoryIdsByKey(database, ws);
});

/** A phone bought on the card, which the issuer later turns into instalments. */
const buyPhone = (amountMinor = 12_000_000, occurredOn = '2026-09-05') =>
  postTransaction(database, ws, {
    occurredOn,
    description: 'iBox Grand Indonesia',
    mcc: '5732',
    lines: [
      { accountId: categories['shopping.electronics']!, amountMinor, currency: 'IDR' },
      { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
    ],
  });

describe('saving an installment plan', () => {
  it('works out what is billed each month', async () => {
    const id = await saveInstallment(database, ws, {
      cardAccountId: card.id,
      description: 'iBox Grand Indonesia',
      totalMinor: 12_000_000,
      months: 12,
      firstBilledMonth: '2026-09',
    });

    const plans = await listInstallments(database, ws, card.id);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id, monthlyMinor: 1_000_000, months: 12, earnsPoints: true });
  });

  it('keeps the parts adding back to the total when the months do not divide evenly', async () => {
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'Sofa', totalMinor: 10_000_000, months: 3, firstBilledMonth: '2026-09' });

    const totals = await installmentTotals(database, ws, '2027-01-31');
    expect(totals[card.id]!.billedMinor + totals[card.id]!.unbilledMinor).toBe(10_000_000);
  });

  it('keeps the purchase it was converted from', async () => {
    const transactionId = await buyPhone();
    await saveInstallment(database, ws, {
      cardAccountId: card.id,
      description: 'iBox Grand Indonesia',
      totalMinor: 12_000_000,
      months: 12,
      firstBilledMonth: '2026-09',
      transactionId,
    });

    expect((await listInstallments(database, ws, card.id))[0]!.transactionId).toBe(transactionId);
  });

  it('refuses a plan of no months, or of nothing', async () => {
    await expect(
      saveInstallment(database, ws, { cardAccountId: card.id, description: 'Sofa', totalMinor: 10_000_000, months: 0, firstBilledMonth: '2026-09' }),
    ).rejects.toThrow(/at least one month/);
    await expect(
      saveInstallment(database, ws, { cardAccountId: card.id, description: 'Sofa', totalMinor: 0, months: 6, firstBilledMonth: '2026-09' }),
    ).rejects.toThrow(/greater than zero/);
  });

  it('refuses a plan on an account that is not a credit card', async () => {
    const bank = await createAccount(database, ws, { name: 'Mandiri', kind: 'asset', subtype: 'bank', currency: 'IDR' });

    await expect(
      saveInstallment(database, ws, { cardAccountId: bank.id, description: 'Sofa', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-09' }),
    ).rejects.toThrow(/credit card/);
  });
});

describe('what each card has billed', () => {
  it('splits billed from unbilled on a date', async () => {
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-09' });

    const totals = await installmentTotals(database, ws, '2026-11-20');
    expect(totals[card.id]).toMatchObject({ billedMinor: 3_000_000, unbilledMinor: 9_000_000, monthsLeft: 9 });
  });

  it('adds two plans on the same card together', async () => {
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-09' });
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'Sofa', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-09' });

    const totals = await installmentTotals(database, ws, '2026-09-30');
    expect(totals[card.id]!.billedMinor).toBe(2_000_000);
    expect(totals[card.id]!.unbilledMinor).toBe(16_000_000);
  });

  it('says nothing for a card with no plans', async () => {
    await expect(installmentTotals(database, ws, '2026-11-20')).resolves.toEqual({});
  });
});

describe('deleting a plan', () => {
  it('removes the plan and leaves the purchase alone', async () => {
    const transactionId = await buyPhone();
    const id = await saveInstallment(database, ws, {
      cardAccountId: card.id,
      description: 'iBox Grand Indonesia',
      totalMinor: 12_000_000,
      months: 12,
      firstBilledMonth: '2026-09',
      transactionId,
    });

    await deleteInstallment(database, ws, id);

    await expect(listInstallments(database, ws, card.id)).resolves.toEqual([]);
    const tx = (await listTransactions(database, ws, {})).find((row) => row.id === transactionId);
    expect(tx?.status).toBe('posted');
  });
});

describe('points on a converted purchase', () => {
  it('stop when the issuer pays none', async () => {
    const transactionId = await buyPhone();
    await saveInstallment(database, ws, {
      cardAccountId: card.id,
      description: 'iBox Grand Indonesia',
      totalMinor: 12_000_000,
      months: 12,
      firstBilledMonth: '2026-09',
      transactionId,
      earnsPoints: false,
    });

    const lines = await cardSpendLines(database, ws, card.id, YEAR.from, YEAR.to);
    expect(lines).toHaveLength(1);
    // The same flag the engine already uses to refuse a fee.
    expect(lines[0]!.cardFee).toBe(true);
  });

  it('carry on when the issuer still pays them', async () => {
    const transactionId = await buyPhone();
    await saveInstallment(database, ws, {
      cardAccountId: card.id,
      description: 'iBox Grand Indonesia',
      totalMinor: 12_000_000,
      months: 12,
      firstBilledMonth: '2026-09',
      transactionId,
      earnsPoints: true,
    });

    const lines = await cardSpendLines(database, ws, card.id, YEAR.from, YEAR.to);
    expect(lines[0]!.cardFee).toBe(false);
  });

  it('leave an ordinary purchase alone', async () => {
    await buyPhone();

    const lines = await cardSpendLines(database, ws, card.id, YEAR.from, YEAR.to);
    expect(lines[0]!.cardFee).toBe(false);
  });
});
