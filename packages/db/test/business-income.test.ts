import { incomeLines, transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  archiveIncomeSource,
  businessInputsFor,
  createAccount,
  listAccounts,
  listIncomeSources,
  postTransaction,
  saveIncomeSource,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = 2026;

/** A business wallet kept apart from the family one, which is how the owner actually works. */
async function wallets() {
  const { database, ws } = await setupDb();
  const business = await createAccount(database, ws, { name: 'Business wallet', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const family = await createAccount(database, ws, { name: 'Family wallet', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const categoryId = (name: string) => all.find((account) => account.name === name)!.id;
  return { database, ws, business, family, categoryId };
}

type Wallets = Awaited<ReturnType<typeof wallets>>;

/** A sale: money into a wallet against an income category. */
const sale = ({ database, ws, categoryId }: Wallets, into: string, occurredOn: string, amountMinor: number, category = 'Other Income') =>
  postTransaction(database, ws, {
    occurredOn,
    description: 'Sale',
    lines: incomeLines({ incomeAccountId: categoryId(category), depositAccountId: into, amountMinor, currency: 'IDR' }),
  });

describe('saveIncomeSource', () => {
  it('keeps a norma percentage off a UMKM source, which is charged on turnover', async () => {
    const context = await wallets();
    const id = await saveIncomeSource(context.database, context.ws, {
      name: 'Warung',
      scheme: 'umkm_final',
      accountId: context.business.id,
      normaRateBps: 5_000,
    });

    const [source] = await listIncomeSources(context.database, context.ws);
    expect(source!.id).toBe(id);
    expect(source!.normaRateBps).toBeNull();
  });

  it('refuses a norma percentage above 100%', async () => {
    const context = await wallets();
    await expect(
      saveIncomeSource(context.database, context.ws, {
        name: 'Affiliate',
        scheme: 'nppn',
        accountId: context.business.id,
        normaRateBps: 12_000,
      }),
    ).rejects.toThrow(/no more than 100%/);
  });

  it('refuses a wallet from another workspace', async () => {
    const context = await wallets();
    const other = await setupDb();
    const stranger = await createAccount(other.database, other.ws, { name: 'Someone else', kind: 'asset', subtype: 'bank', currency: 'IDR' });

    await expect(
      saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: stranger.id }),
    ).rejects.toThrow();
  });

  it('edits in place rather than making a second business', async () => {
    const context = await wallets();
    const id = await saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: context.business.id });
    await saveIncomeSource(context.database, context.ws, { id, name: 'Warung Bu Sri', scheme: 'umkm_final', accountId: context.business.id });

    const sources = await listIncomeSources(context.database, context.ws);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.name).toBe('Warung Bu Sri');
  });

  it('drops an archived business off the list', async () => {
    const context = await wallets();
    const id = await saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: context.business.id });
    await archiveIncomeSource(context.database, context.ws, id);

    expect(await listIncomeSources(context.database, context.ws)).toEqual([]);
  });
});

describe('businessInputsFor', () => {
  it('reads a month of turnover off the sales recorded in the wallet', async () => {
    const context = await wallets();
    await saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: context.business.id });
    await sale(context, context.business.id, `${YEAR}-03-04`, 4_000_000);
    await sale(context, context.business.id, `${YEAR}-03-19`, 6_000_000);

    const report = await businessInputsFor(context.database, context.ws, YEAR);

    expect(report.umkm[0]!.months[2]!.turnoverMinor).toBe(10_000_000);
    expect(report.umkm[0]!.grossMinor).toBe(10_000_000);
  });

  it('leaves the family wallet out of the business turnover', async () => {
    const context = await wallets();
    await saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: context.business.id });
    await sale(context, context.business.id, `${YEAR}-05-02`, 3_000_000);
    // A salary paid into the family wallet is income, but it is not this business's omzet.
    await sale(context, context.family.id, `${YEAR}-05-02`, 25_000_000, 'Salary');

    const report = await businessInputsFor(context.database, context.ws, YEAR);

    expect(report.umkm[0]!.grossMinor).toBe(3_000_000);
  });

  it('does not count your own money moved into the business wallet', async () => {
    const context = await wallets();
    await saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: context.business.id });
    await sale(context, context.business.id, `${YEAR}-04-08`, 2_000_000);
    // Topping the business up from the family wallet is not a sale, however much lands in the account.
    await postTransaction(context.database, context.ws, {
      occurredOn: `${YEAR}-04-09`,
      description: 'Float for the business',
      lines: transferLines({ fromAccountId: context.family.id, toAccountId: context.business.id, amountMinor: 50_000_000, currency: 'IDR' }),
    });

    expect((await businessInputsFor(context.database, context.ws, YEAR)).umkm[0]!.grossMinor).toBe(2_000_000);
  });

  it('counts nothing from another year', async () => {
    const context = await wallets();
    await saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: context.business.id });
    await sale(context, context.business.id, `${YEAR - 1}-12-31`, 9_000_000);

    expect((await businessInputsFor(context.database, context.ws, YEAR)).umkm[0]!.grossMinor).toBe(0);
  });

  it('charges nothing until the exempt slice is spent, then 0,5%', async () => {
    const context = await wallets();
    await saveIncomeSource(context.database, context.ws, { name: 'Warung', scheme: 'umkm_final', accountId: context.business.id });
    for (let month = 1; month <= 6; month += 1) {
      await sale(context, context.business.id, `${YEAR}-${String(month).padStart(2, '0')}-10`, 100_000_000);
    }

    const umkm = (await businessInputsFor(context.database, context.ws, YEAR)).umkm[0]!;

    expect(umkm.crossedInMonth).toBe(6);
    expect(umkm.taxMinor).toBe(500_000);
  });

  it('turns an affiliate wallet into net income at the norma percentage', async () => {
    const context = await wallets();
    await saveIncomeSource(context.database, context.ws, {
      name: 'Shopee affiliate',
      scheme: 'nppn',
      accountId: context.business.id,
      normaRateBps: 5_000,
      kluCode: '73100',
    });
    await sale(context, context.business.id, `${YEAR}-02-11`, 20_000_000);

    const report = await businessInputsFor(context.database, context.ws, YEAR);

    expect(report.nppn[0]!.grossMinor).toBe(20_000_000);
    expect(report.nppn[0]!.netMinor).toBe(10_000_000);
    expect(report.umkm).toEqual([]);
  });

  it('says what is missing when the norma percentage was never given', async () => {
    const context = await wallets();
    await saveIncomeSource(context.database, context.ws, { name: 'Freelance', scheme: 'nppn', accountId: context.business.id });
    await sale(context, context.business.id, `${YEAR}-02-11`, 20_000_000);

    const report = await businessInputsFor(context.database, context.ws, YEAR);

    expect(report.nppn[0]!.netMinor).toBe(0);
    expect(report.problems.some((problem) => problem.level === 'blocking')).toBe(true);
  });
});
