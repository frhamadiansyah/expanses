import { writeFileSync } from 'node:fs';
import { assetItem, expenseLines, incomeLines, isoDate, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addHolding,
  checkLedgerIntegrity,
  createAccount,
  createCardAccount,
  listAccounts,
  openCashAccount,
  postTransaction,
  recordTrade,
  recordValuation,
  saveAssetProfile,
  saveCardTerms,
  upsertPrice,
  upsertRate,
  upsertSecurityPrice,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';
import { seedSampleData } from './sample/seed';

/**
 * A much larger invented household for timing the screens that add everything up (Net worth above all): the dev
 * sample, then three years of daily spending over two dozen accounts, holdings priced every day, and a property
 * revalued every month. Every name and figure is made up.
 *
 * Skipped unless SAMPLE_LARGE_OUT names where to write the file; `?load-sample` loads it once copied over
 * `apps/web/dev-data/sample.sqlite3`.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!process.env.SAMPLE_LARGE_OUT)('large sample data', () => {
  it('builds three years of a busy household', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const today = process.env.SAMPLE_TODAY ?? isoDate();
    await seedSampleData(database, ws, today);
    const rand = random(7);
    const years = Number(process.env.SAMPLE_YEARS ?? 3);
    const from = addDays(today, -365 * years);
    const opened = addDays(from, -1);

    const categories = (await listAccounts(database, ws)).filter((a) => a.kind === 'expense' && a.systemKey && a.parentId !== null);
    const salary = (await listAccounts(database, ws)).find((a) => a.systemKey === 'income.salary')!;
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: opened, rate: 15_870, source: 'manual', sourceDate: opened });

    // Two dozen more money accounts: banks, e-wallets, a dollar account, and cards.
    const banks = [];
    for (let i = 0; i < 12; i += 1) {
      banks.push(await openCashAccount(database, ws, { item: i % 3 === 0 ? 'savings' : 'bank', name: `Bank Lima ${i + 1}`, bank: 'Bank Lima', currency: 'IDR', openingBalanceMinor: 40_000_000 + i * 3_000_000, openedOn: opened }));
    }
    const wallets = [];
    for (let i = 0; i < 4; i += 1) wallets.push(await openCashAccount(database, ws, { item: 'ewallet', name: `Dompet ${i + 1}`, currency: 'IDR', openingBalanceMinor: 2_000_000, openedOn: opened }));
    const dollars = await openCashAccount(database, ws, { item: 'bank', name: 'Dollar saver', bank: 'Bank Lima', currency: 'USD', openingBalanceMinor: 1_250_000, openingRateToBase: 15_870, openedOn: opened });
    const cards = [];
    for (let i = 0; i < 5; i += 1) {
      const card = await createCardAccount(database, ws, { name: `Kartu Pelangi ${i + 1}`, subtype: 'credit_card', currency: 'IDR', issuer: 'Bank Lima', last4: `5${pad(i)}1` });
      await saveCardTerms(database, ws, { accountId: card.id, statementDay: 10 + i, dueDay: 25, creditLimitMinor: 30_000_000, annualFeeMinor: null });
      cards.push(card);
    }
    const payers = [...banks, ...wallets, ...cards];

    // Holdings priced every day: three funds by units, two listed shares, and a house revalued every month.
    const units = (n: number) => Math.round(n * 1_000_000);
    const funds = [];
    for (let i = 0; i < 3; i += 1) {
      const item = assetItem('fund');
      if (item.behaviour.opens !== 'holding') throw new Error('fund is not a holding');
      const account = await createAccount(database, ws, { name: `Reksa Pelangi ${i + 1}`, kind: 'asset', subtype: 'investment', currency: 'IDR', openingBalanceMinor: 0 });
      const { behaviour } = item;
      await saveAssetProfile(database, ws, {
        accountId: account.id,
        assetKind: behaviour.assetKind,
        planGroup: behaviour.planGroup,
        unitKind: behaviour.unitKind,
        lotSize: behaviour.lotSize,
        coretaxSection: item.section ?? 'lainnya',
        coretaxCode: item.code,
        acquiredYear: Number(from.slice(0, 4)),
      });
      funds.push(account);
    }
    const shares = [];
    for (const [ticker, name] of [['PLGA', 'Pelangi Satu Tbk'], ['PLGB', 'Pelangi Dua Tbk']] as const) {
      shares.push(
        await addHolding(database, ws, {
          security: { ticker, name, market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share', source: 'owner' },
          broker: { name: `Broker ${ticker}`, currency: 'IDR' },
          buy: { occurredOn: from, unitsMicro: units(2_000), grossMinor: 8_400_000, feeMinor: 12_600, taxMinor: 0, cashAccountId: null },
        }),
      );
    }
    const house = await createAccount(database, ws, { name: 'Rumah Pelangi', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 900_000_000, openedOn: opened });

    let navs = funds.map((_, i) => 1_500 + i * 250);
    let closes = shares.map((_, i) => 4_200 + i * 1_100);
    let houseValue = 900_000_000;
    let day = 0;
    for (let date = from; date <= today; date = addDays(date, 1), day += 1) {
      // A salary into one of the banks on the first, and every month's buys into the funds.
      if (date.endsWith('-01')) {
        await postTransaction(database, ws, { occurredOn: date, description: 'Gaji PT Pelangi', lines: incomeLines({ incomeAccountId: salary.id, depositAccountId: banks[0]!.id, amountMinor: 38_000_000, currency: 'IDR' }) });
        for (const [i, fund] of funds.entries()) {
          await recordTrade(database, ws, { accountId: fund.id, kind: 'buy', occurredOn: date, unitsMicro: units(1_000_000 / navs[i]!), grossMinor: 1_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: banks[1 + i]!.id });
        }
        houseValue += Math.round((rand() - 0.3) * 6_000_000);
        await recordValuation(database, ws, { accountId: house.id, asOf: date, valueMinor: Math.round(houseValue / 100_000) * 100_000, basis: 'estimate' });
        for (const card of cards) {
          await postTransaction(database, ws, { occurredOn: addDays(date, 2), description: 'Bayar kartu', lines: transferLines({ fromAccountId: banks[2]!.id, toAccountId: card.id, amountMinor: 1_500_000, currency: 'IDR' }) });
        }
      }
      navs = navs.map((nav) => nav * (1 + (rand() - 0.48) * 0.004));
      closes = closes.map((close) => Math.max(50, Math.round(close * (1 + (rand() - 0.49) * 0.02))));
      for (const [i, fund] of funds.entries()) await upsertPrice(database, ws, { accountId: fund.id, onDate: date, priceMicro: Math.round(navs[i]! * 1_000_000) });
      for (const [i, share] of shares.entries()) await upsertSecurityPrice(database, ws, { securityId: share.securityId, onDate: date, priceMicro: units(closes[i]!) });
      // About a dozen everyday purchases a day, spread over every payer.
      const count = 8 + Math.floor(rand() * 9);
      for (let n = 0; n < count; n += 1) {
        const payer = payers[Math.floor(rand() * payers.length)]!;
        const category = categories[Math.floor(rand() * categories.length)]!;
        await postTransaction(database, ws, {
          occurredOn: date,
          description: `Belanja ${(day * 31 + n) % 997}`,
          lines: expenseLines({ categoryAccountId: category.id, paymentAccountId: payer.id, amountMinor: (5 + Math.floor(rand() * 60)) * 5_000, currency: 'IDR' }),
        });
      }
      if (day % 30 === 0) {
        await postTransaction(database, ws, { occurredOn: date, description: 'Coffee abroad', lines: expenseLines({ categoryAccountId: categories[0]!.id, paymentAccountId: dollars.id, amountMinor: 650, currency: 'USD' }), ratesToBase: { USD: 15_900 } });
      }
    }

    expect(await checkLedgerIntegrity(database, ws)).toEqual([]);
    writeFileSync(process.env.SAMPLE_LARGE_OUT!, await database.exportBytes());
  }, 1_800_000);
});
