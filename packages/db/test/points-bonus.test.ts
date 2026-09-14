import { expenseLines, transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  archiveCycleBonus,
  archiveEarnRule,
  archiveTransferPartner,
  cardSpendLines,
  createAccount,
  createProgram,
  type CycleBonusInput,
  type Database,
  deleteRedemptionOption,
  type EarnRuleInput,
  listAccounts,
  listCycleBonuses,
  listEarnRules,
  listPrograms,
  listTransferPartners,
  PointsError,
  type PointsWriteOptions,
  postTransaction,
  saveCycleBonus,
  saveEarnRule,
  saveRedemptionOption,
  saveTransferPartner,
  type TransferPartnerInput,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const RULE: EarnRuleInput = {
  name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 10_000,
  rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
};
const BONUS: CycleBonusInput = { key: 'monthly-spend', name: 'Monthly spend bonus', tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }], match: {}, validFrom: null, validTo: null };
const PARTNER: TransferPartnerInput = { key: 'krisflyer', program: 'KrisFlyer', points: 200, partnerUnits: 100, incrementPoints: 20, validFrom: null, validTo: null };

async function cardWithProgram() {
  const t = await setupDb();
  const { database, ws } = t;
  const checking = await createAccount(database, ws, { name: 'Checking', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const card = await createAccount(database, ws, { name: 'BCA UnionPay', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'UnionPay Points', unit: 'points', cycleAnchor: 'statement' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  return { ...t, checking, card, program, category };
}

const statusOf = async (database: Database, ws: WorkspaceContext, programId: string) =>
  (await listPrograms(database, ws)).find((p) => p.id === programId)!.catalogStatus;
const setStatus = (database: Database, programId: string, status: 'linked' | null) =>
  database.execScript(`UPDATE reward_programs SET catalog_status = ${status ? `'${status}'` : 'NULL'} WHERE id = '${programId}'`);

/** Every mutation of a program's rules, bonuses, partners, and redemption options, in an order that archives what it saved. */
function mutations(database: Database, ws: WorkspaceContext, programId: string, options?: PointsWriteOptions): [string, () => Promise<unknown>][] {
  let ruleId = '';
  let bonusId = '';
  let partnerId = '';
  let redemptionId = '';
  return [
    ['saveEarnRule', async () => (ruleId = await saveEarnRule(database, ws, programId, RULE, options))],
    ['archiveEarnRule', () => archiveEarnRule(database, ws, ruleId, options)],
    ['saveCycleBonus', async () => (bonusId = await saveCycleBonus(database, ws, programId, BONUS, options))],
    ['archiveCycleBonus', () => archiveCycleBonus(database, ws, bonusId, options)],
    ['saveTransferPartner', async () => (partnerId = await saveTransferPartner(database, ws, programId, PARTNER, options))],
    ['archiveTransferPartner', () => archiveTransferPartner(database, ws, partnerId, options)],
    [
      'saveRedemptionOption',
      async () =>
        (redemptionId = await saveRedemptionOption(database, ws, { programId, name: 'Cash', type: 'cashback', valueMinor: 20, perPoints: 1, currency: 'IDR' }, options)),
    ],
    ['deleteRedemptionOption', () => deleteRedemptionOption(database, ws, redemptionId, options)],
  ];
}

describe('card spend lines', () => {
  it('returns a card refund as a negative line with its original currency, and never a statement payment', async () => {
    const { database, ws, checking, card, category } = await cardWithProgram();
    const dining = category('food_beverage.restaurants');
    await postTransaction(database, ws, {
      occurredOn: '2026-09-02', description: 'Din Tai Fung', originalCurrency: 'SGD', originalAmountMinor: 4500,
      lines: expenseLines({ categoryAccountId: dining, paymentAccountId: card.id, amountMinor: 540_000, currency: 'IDR' }),
    });
    await postTransaction(database, ws, {
      occurredOn: '2026-09-05', description: 'Din Tai Fung refund',
      lines: expenseLines({ categoryAccountId: dining, paymentAccountId: card.id, amountMinor: -120_000, currency: 'IDR' }),
    });
    await postTransaction(database, ws, {
      occurredOn: '2026-09-06', description: 'Refund to checking',
      lines: expenseLines({ categoryAccountId: dining, paymentAccountId: checking.id, amountMinor: -50_000, currency: 'IDR' }),
    });
    await postTransaction(database, ws, {
      occurredOn: '2026-09-10', description: 'Pay card',
      lines: transferLines({ fromAccountId: checking.id, toAccountId: card.id, amountMinor: 420_000, currency: 'IDR' }),
    });
    const lines = await cardSpendLines(database, ws, card.id, '2026-09-01', '2026-09-30');
    expect(lines.map((l) => [l.description, l.amountMinor, l.originalCurrency])).toEqual([
      ['Din Tai Fung', 540_000, 'SGD'],
      ['Din Tai Fung refund', -120_000, null],
    ]);
  });
});

describe('cycle bonuses and transfer partners', () => {
  it('round-trips bonuses with JSON tiers and match, and rejects invalid tiers', async () => {
    const { database, ws, program, category } = await cardWithProgram();
    const match = { excludeCategoryIds: [category('miscellaneous.fees_charges')], excludeMerchantPatterns: ['prudential'] };
    const id = await saveCycleBonus(database, ws, program.id, { ...BONUS, match });
    expect(await listCycleBonuses(database, ws, program.id)).toEqual([{ id, ...BONUS, match }]);

    const tiers = [{ minSpendMinor: 20_000_000, bonus: 1000 }, { minSpendMinor: 50_000_000, bonus: 2000 }];
    await saveCycleBonus(database, ws, program.id, { ...BONUS, id, tiers, validTo: '2026-12-31' });
    expect(await listCycleBonuses(database, ws, program.id)).toEqual([{ id, ...BONUS, tiers, validTo: '2026-12-31' }]);

    await archiveCycleBonus(database, ws, id);
    expect(await listCycleBonuses(database, ws, program.id)).toEqual([]);

    for (const bad of [[], [...tiers].reverse(), [{ minSpendMinor: 20_000_000, bonus: 0.5 }], [{ minSpendMinor: 0, bonus: 1000 }]]) {
      await expect(saveCycleBonus(database, ws, program.id, { ...BONUS, tiers: bad })).rejects.toThrow(PointsError);
    }
  });

  it('round-trips transfer partners and rejects non-positive ratios', async () => {
    const { database, ws, program } = await cardWithProgram();
    const id = await saveTransferPartner(database, ws, program.id, PARTNER);
    // A partner with no published ceiling reads back uncapped.
    expect(await listTransferPartners(database, ws, program.id)).toEqual([{ id, ...PARTNER, cap: null }]);
    await saveTransferPartner(database, ws, program.id, { ...PARTNER, id, points: 150, incrementPoints: 15, validFrom: '2025-11-01' });
    expect(await listTransferPartners(database, ws, program.id)).toEqual([{ id, ...PARTNER, cap: null, points: 150, incrementPoints: 15, validFrom: '2025-11-01' }]);
    await archiveTransferPartner(database, ws, id);
    expect(await listTransferPartners(database, ws, program.id)).toEqual([]);
    await expect(saveTransferPartner(database, ws, program.id, { ...PARTNER, points: 0 })).rejects.toThrow(PointsError);
    await expect(saveTransferPartner(database, ws, program.id, { ...PARTNER, program: ' ' })).rejects.toThrow(PointsError);
  });

  it('stores a redemption cap and refuses one with no ceiling in it', async () => {
    const { database, ws, program } = await cardWithProgram();
    const cap = { window: 'month' as const, capPoints: 25_000, capPartnerUnits: null, shared: true, beyond: { points: 3000, partnerUnits: 1000 } };
    const id = await saveTransferPartner(database, ws, program.id, { ...PARTNER, cap });
    expect((await listTransferPartners(database, ws, program.id)).find((p) => p.id === id)?.cap).toEqual(cap);
    await expect(
      saveTransferPartner(database, ws, program.id, { ...PARTNER, cap: { ...cap, capPoints: null } }),
    ).rejects.toThrow(PointsError);
    await expect(
      saveTransferPartner(database, ws, program.id, { ...PARTNER, cap: { ...cap, capPoints: -1 } }),
    ).rejects.toThrow(PointsError);
  });
});

describe('earn rule rates', () => {
  it('stores a one-decimal rate and rejects finer ones', async () => {
    const { database, ws, program } = await cardWithProgram();
    const id = await saveEarnRule(database, ws, program.id, { ...RULE, rateNum: 7.5, rateDen: 50_000, rounding: 'per_increment' });
    expect(await listEarnRules(database, ws, program.id)).toMatchObject([{ id, rateNum: 7.5, rateDen: 50_000 }]);
    await expect(saveEarnRule(database, ws, program.id, { ...RULE, rateNum: 7.25 })).rejects.toThrow(PointsError);
    await expect(saveEarnRule(database, ws, program.id, { ...RULE, rateNum: -1 })).rejects.toThrow(PointsError);
  });
});

describe('catalogue status', () => {
  it('marks a linked program customised on every rule, bonus, partner, and redemption change', async () => {
    const { database, ws, program } = await cardWithProgram();
    for (const [name, mutate] of mutations(database, ws, program.id)) {
      await setStatus(database, program.id, 'linked');
      await mutate();
      expect(await statusOf(database, ws, program.id), name).toBe('customised');
    }
  });

  it('keeps a linked program linked for catalogue-internal writes', async () => {
    const { database, ws, program } = await cardWithProgram();
    await setStatus(database, program.id, 'linked');
    for (const [name, mutate] of mutations(database, ws, program.id, { fromCatalog: true })) {
      await mutate();
      expect(await statusOf(database, ws, program.id), name).toBe('linked');
    }
  });

  it('leaves a program without a catalogue link unlinked', async () => {
    const { database, ws, program } = await cardWithProgram();
    for (const [, mutate] of mutations(database, ws, program.id)) await mutate();
    expect(await statusOf(database, ws, program.id)).toBeNull();
  });
});
