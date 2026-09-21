import type { MaturityChoice } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { categoryIdsByKeyTx, confirmDepositEvent, incomeInputsFor, listAccounts, listDueDeposits, nativeBalances, openCashAccount, saveDepositAutomation } from '../src/index';
import { setupDb } from './helpers';

const FIXTURE = {
  IDR: { opened: '2026-07-15', matures: '2026-10-15', principal: 50_000_000, rateBps: 425, payout: 1_000_000, fx: undefined },
  USD: { opened: '2026-08-01', matures: '2026-11-01', principal: 1_000_000, rateBps: 350, payout: 5_000, fx: 16_350 },
} as const;

type Row = [
  currency: 'IDR' | 'USD',
  choice: MaturityChoice,
  paid: 'monthly' | 'at_maturity',
  exempt: boolean,
  firstByHand: boolean,
  nets: number[],
  deposit: number,
  payout: number,
  postedGross: number,
  postedTax: number,
  reportedGross: number,
  reportedTax: number,
  open: boolean,
];

// prettier-ignore
const ROWS: Row[] = [
  ['IDR', 'principal',          'at_maturity', false, false, [428_493],                   50_000_000, 1_428_493,  535_616, 107_123, 535_616, 107_123, true],
  ['IDR', 'principal',          'at_maturity', true,  false, [535_616],                   50_000_000, 1_535_616,  535_616, 0,       535_616, 0,       true],
  ['IDR', 'principal',          'monthly',     false, false, [144_384, 144_384, 139_726], 50_000_000, 1_428_494,  535_615, 107_121, 535_615, 107_121, true],
  ['IDR', 'principal',          'monthly',     true,  false, [180_479, 180_479, 174_657], 50_000_000, 1_535_615,  535_615, 0,       535_615, 0,       true],
  ['IDR', 'principal_interest', 'at_maturity', false, false, [428_493],                   50_428_493, 1_000_000,  535_616, 107_123, 535_616, 107_123, true],
  ['IDR', 'principal_interest', 'at_maturity', true,  false, [535_616],                   50_535_616, 1_000_000,  535_616, 0,       535_616, 0,       true],
  ['IDR', 'principal_interest', 'monthly',     false, false, [144_384, 144_800, 140_534], 50_429_718, 1_000_000,  537_146, 107_428, 537_146, 107_428, true],
  ['IDR', 'principal_interest', 'monthly',     true,  false, [180_479, 181_130, 175_920], 50_537_529, 1_000_000,  537_529, 0,       537_529, 0,       true],
  ['IDR', 'close',              'at_maturity', false, false, [428_493],                   0,          51_428_493, 535_616, 107_123, 535_616, 107_123, false],
  ['IDR', 'close',              'at_maturity', true,  false, [535_616],                   0,          51_535_616, 535_616, 0,       535_616, 0,       false],
  ['IDR', 'close',              'monthly',     false, false, [144_384, 144_384, 139_726], 0,          51_428_494, 535_615, 107_121, 535_615, 107_121, false],
  ['IDR', 'close',              'monthly',     true,  false, [180_479, 180_479, 174_657], 0,          51_535_615, 535_615, 0,       535_615, 0,       false],
  ['USD', 'principal',          'at_maturity', false, false, [7_057],                     1_000_000,  12_057,     8_821,   1_764,   8_821,   1_764,   true],
  ['USD', 'principal',          'at_maturity', true,  false, [8_821],                     1_000_000,  13_821,     8_821,   0,       8_821,   0,       true],
  ['USD', 'principal',          'monthly',     false, false, [2_378, 2_301, 2_378],       1_000_000,  12_057,     8_820,   1_763,   8_820,   1_763,   true],
  ['USD', 'principal',          'monthly',     true,  false, [2_972, 2_876, 2_972],       1_000_000,  13_820,     8_820,   0,       8_820,   0,       true],
  ['USD', 'principal_interest', 'at_maturity', false, false, [7_057],                     1_007_057,  5_000,      8_821,   1_764,   8_821,   1_764,   true],
  ['USD', 'principal_interest', 'at_maturity', true,  false, [8_821],                     1_008_821,  5_000,      8_821,   0,       8_821,   0,       true],
  ['USD', 'principal_interest', 'monthly',     false, false, [2_378, 2_307, 2_389],       1_007_074,  5_000,      8_841,   1_767,   8_841,   1_767,   true],
  ['USD', 'principal_interest', 'monthly',     true,  false, [2_972, 2_885, 2_990],       1_008_847,  5_000,      8_847,   0,       8_847,   0,       true],
  ['USD', 'close',              'at_maturity', false, false, [7_057],                     0,          1_012_057,  8_821,   1_764,   8_821,   1_764,   false],
  ['USD', 'close',              'at_maturity', true,  false, [8_821],                     0,          1_013_821,  8_821,   0,       8_821,   0,       false],
  ['USD', 'close',              'monthly',     false, false, [2_378, 2_301, 2_378],       0,          1_012_057,  8_820,   1_763,   8_820,   1_763,   false],
  ['USD', 'close',              'monthly',     true,  false, [2_972, 2_876, 2_972],       0,          1_013_820,  8_820,   0,       8_820,   0,       false],
  ['IDR', 'principal',          'at_maturity', false, true,  [428_493],                   50_000_000, 1_000_000,  0,       0,       535_616, 107_123, true],
  ['IDR', 'principal',          'at_maturity', true,  true,  [535_616],                   50_000_000, 1_000_000,  0,       0,       535_616, 0,       true],
  ['IDR', 'principal',          'monthly',     false, true,  [144_384, 144_384, 139_726], 50_000_000, 1_284_110,  355_136, 71_026,  535_615, 107_121, true],
  ['IDR', 'principal',          'monthly',     true,  true,  [180_479, 180_479, 174_657], 50_000_000, 1_355_136,  355_136, 0,       535_615, 0,       true],
  ['IDR', 'principal_interest', 'at_maturity', false, true,  [428_493],                   50_000_000, 1_000_000,  0,       0,       535_616, 107_123, true],
  ['IDR', 'principal_interest', 'at_maturity', true,  true,  [535_616],                   50_000_000, 1_000_000,  0,       0,       535_616, 0,       true],
  ['IDR', 'principal_interest', 'monthly',     false, true,  [144_384, 144_384, 140_129], 50_284_513, 1_000_000,  355_640, 71_127,  536_119, 107_222, true],
  ['IDR', 'principal_interest', 'monthly',     true,  true,  [180_479, 180_479, 175_287], 50_355_766, 1_000_000,  355_766, 0,       536_245, 0,       true],
  ['IDR', 'close',              'at_maturity', false, true,  [428_493],                   50_000_000, 1_000_000,  0,       0,       535_616, 107_123, true],
  ['IDR', 'close',              'at_maturity', true,  true,  [535_616],                   50_000_000, 1_000_000,  0,       0,       535_616, 0,       true],
  ['IDR', 'close',              'monthly',     false, true,  [144_384, 144_384, 139_726], 0,          51_284_110, 355_136, 71_026,  535_615, 107_121, false],
  ['IDR', 'close',              'monthly',     true,  true,  [180_479, 180_479, 174_657], 0,          51_355_136, 355_136, 0,       535_615, 0,       false],
  ['USD', 'principal',          'at_maturity', false, true,  [7_057],                     1_000_000,  5_000,      0,       0,       8_821,   1_764,   true],
  ['USD', 'principal',          'at_maturity', true,  true,  [8_821],                     1_000_000,  5_000,      0,       0,       8_821,   0,       true],
  ['USD', 'principal',          'monthly',     false, true,  [2_378, 2_301, 2_378],       1_000_000,  9_679,      5_848,   1_169,   8_820,   1_763,   true],
  ['USD', 'principal',          'monthly',     true,  true,  [2_972, 2_876, 2_972],       1_000_000,  10_848,     5_848,   0,       8_820,   0,       true],
  ['USD', 'principal_interest', 'at_maturity', false, true,  [7_057],                     1_000_000,  5_000,      0,       0,       8_821,   1_764,   true],
  ['USD', 'principal_interest', 'at_maturity', true,  true,  [8_821],                     1_000_000,  5_000,      0,       0,       8_821,   0,       true],
  ['USD', 'principal_interest', 'monthly',     false, true,  [2_378, 2_301, 2_384],       1_004_685,  5_000,      5_855,   1_170,   8_827,   1_764,   true],
  ['USD', 'principal_interest', 'monthly',     true,  true,  [2_972, 2_876, 2_981],       1_005_857,  5_000,      5_857,   0,       8_829,   0,       true],
  ['USD', 'close',              'at_maturity', false, true,  [7_057],                     1_000_000,  5_000,      0,       0,       8_821,   1_764,   true],
  ['USD', 'close',              'at_maturity', true,  true,  [8_821],                     1_000_000,  5_000,      0,       0,       8_821,   0,       true],
  ['USD', 'close',              'monthly',     false, true,  [2_378, 2_301, 2_378],       0,          1_009_679,  5_848,   1_169,   8_820,   1_763,   false],
  ['USD', 'close',              'monthly',     true,  true,  [2_972, 2_876, 2_972],       0,          1_010_848,  5_848,   0,       8_820,   0,       false],
];

describe('every combination of choice, payout, tax, currency and who recorded it', () => {
  it.each(ROWS)('%s · %s · %s · tax-free %s · first by hand %s', async (currency, choice, paid, exempt, firstByHand, nets, depositEnd, payoutEnd, postedGross, postedTax, reportedGross, reportedTax, open) => {
    const { database, ws, executor } = await setupDb('IDR');
    try {
      const f = FIXTURE[currency];
      const payout = await openCashAccount(database, ws, { item: 'bank', name: 'Payout', currency, openingBalanceMinor: f.payout, openedOn: f.opened, openingRateToBase: f.fx });
      const deposit = await openCashAccount(database, ws, {
        item: 'time_deposit', name: 'Deposito', currency, openingBalanceMinor: f.principal, openedOn: f.opened,
        openingRateToBase: f.fx, maturesOn: f.matures, rateBps: f.rateBps,
      });
      await saveDepositAutomation(database, ws, {
        accountId: deposit.id, enabled: true, atMaturity: choice, interestPaid: paid, payoutAccountId: payout.id,
        termMonths: 3, keepRate: true, taxBps: 2_000, taxExempt: exempt, today: f.opened,
      });

      // The app was not opened all term: everything waits, and is confirmed one at a time in date order.
      const proposed: number[] = [];
      for (let p = (await listDueDeposits(database, ws, f.matures))[0]; p; p = (await listDueDeposits(database, ws, f.matures))[0]) {
        proposed.push(p.netMinor);
        await confirmDepositEvent(database, ws, {
          accountId: p.accountId, kind: p.event.kind, dueOn: p.event.dueOn, today: f.matures,
          principalMinor: p.principalMinor, grossMinor: p.grossMinor, taxMinor: p.taxMinor,
          newRateBps: p.rateBps, newTermMonths: p.settings.termMonths, rateToBase: f.fx,
          byHand: firstByHand && proposed.length === 1,
        });
      }

      expect(proposed).toEqual(nets);
      const balances = await nativeBalances(database, ws);
      expect(balances[deposit.id] ?? 0).toBe(depositEnd);
      expect(balances[payout.id]).toBe(payoutEnd);
      // Posted like an investment payment: gross is the income (a credit), the tax a debit line of its own.
      const keys = await categoryIdsByKeyTx(database.db, ws);
      // 0 − gross, not −gross: nothing posted is +0, and toBe (Object.is) tells +0 from the −0 that −0 would give.
      expect(balances[keys['income.investment']!] ?? 0).toBe(0 - postedGross);
      expect(balances[keys['government_taxes.estimated_tax']!] ?? 0).toBe(postedTax);
      // The tax report reads the log: every event, recorded by hand or not, gross and withheld.
      const reported = (await incomeInputsFor(database, ws, 2026)).filter((row) => row.accountId === deposit.id);
      expect(reported.map((row) => [row.kind, row.grossMinor, row.taxMinor, row.foreign])).toEqual([['interest', reportedGross, reportedTax, currency === 'USD']]);
      const live = (await listAccounts(database, ws)).map((a) => a.id);
      expect(live.includes(deposit.id)).toBe(open);
    } finally {
      executor.close();
    }
  });
});
