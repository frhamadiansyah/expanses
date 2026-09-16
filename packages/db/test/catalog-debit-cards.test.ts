import { findEntry } from '@expanses/catalog';
import { computeCycleEarn, expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  applyCatalogEntry,
  cardSpendLines,
  createAccount,
  listAccounts,
  listCycleBonuses,
  listEarnRules,
  postTransaction,
  saveCardTerms,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-15';
const FROM = '2026-09-01';
const TO = '2026-09-30';

async function withDebitCard(entryId: string, memberLevel?: string) {
  const t = await setupDb();
  const account = await createAccount(t.database, t.ws, { name: 'Spending account', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: account.id,
    entry: structuredClone(findEntry(entryId)!),
    today: TODAY,
    replaceManual: false,
    memberLevel,
  });
  return { ...t, account, programId };
}

async function spend(t: Awaited<ReturnType<typeof withDebitCard>>, amountMinor: number, category = 'shopping', description = 'Belanja') {
  const all = await listAccounts(t.database, t.ws);
  const categoryAccountId = all.find((a) => a.systemKey === category)!.id;
  await postTransaction(t.database, t.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId, paymentAccountId: t.account.id, amountMinor, currency: 'IDR' }),
  });
}

async function earned(t: Awaited<ReturnType<typeof withDebitCard>>) {
  const all = await listAccounts(t.database, t.ws);
  const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));
  const lines = await cardSpendLines(t.database, t.ws, t.account.id, FROM, TO);
  const rules = await listEarnRules(t.database, t.ws, t.programId);
  const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
  return computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: TO }).totalPoints;
}

describe('a debit card earns on the account it spends from', () => {
  it('applies to a bank account, which a credit card entry cannot', async () => {
    const t = await withDebitCard('blu-garuda-debit');
    expect(t.programId).toBeTruthy();

    const credit = await createAccount(t.database, t.ws, { name: 'Another bank account', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await expect(
      applyCatalogEntry(t.database, t.ws, { cardAccountId: credit.id, entry: structuredClone(findEntry('uob-zenith')!), today: TODAY, replaceManual: false }),
    ).rejects.toThrow('Account is not a credit card');
  });

  it('refuses to put a debit card on a credit card', async () => {
    const t = await setupDb();
    const card = await createAccount(t.database, t.ws, { name: 'Some credit card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(
      applyCatalogEntry(t.database, t.ws, { cardAccountId: card.id, entry: structuredClone(findEntry('blu-garuda-debit')!), today: TODAY, replaceManual: false }),
    ).rejects.toThrow('spends from');
  });

  it('has no statement, so its cycle is the calendar month', () => {
    for (const id of ['blu-garuda-debit', 'maybank-u-debit']) {
      expect(findEntry(id)!.cardType, id).toBe('debit');
      expect(findEntry(id)!.program.cycleAnchor, id).toBe('calendar');
      // Nothing to pay off yearly: neither card charges a fee for holding it.
      expect(findEntry(id)!.fees, id).toEqual([]);
    }
  });

  it('still refuses a statement day on the bank account behind it', async () => {
    const t = await withDebitCard('blu-garuda-debit');
    await expect(saveCardTerms(t.database, t.ws, { accountId: t.account.id, statementDay: 25, dueDay: 12, creditLimitMinor: null, annualFeeMinor: null })).rejects.toThrow(
      'not a credit card',
    );
  });
});

describe('Garuda x bluDebit earning', () => {
  it('earns one mile per Rp 50.000 of ordinary spending', async () => {
    const t = await withDebitCard('blu-garuda-debit');
    await spend(t, 2_500_000);
    expect(await earned(t)).toBe(50);
  });

  it('earns the better rate at Garuda, one mile per Rp 40.000', async () => {
    const t = await withDebitCard('blu-garuda-debit');
    await spend(t, 2_000_000, 'travel.flights', 'Garuda Indonesia GA 715');
    expect(await earned(t)).toBe(50);
  });

  it('keeps the part of a purchase below one whole increment', async () => {
    const t = await withDebitCard('blu-garuda-debit');
    await spend(t, 49_999);
    expect(await earned(t)).toBe(0);
  });
});

describe('Maybank U cashback, whose ceiling is the balance you keep', () => {
  it('pays a tenth back on card spending, up to the band cap', async () => {
    const t = await withDebitCard('maybank-u-debit', 'avg-10m-plus');
    await spend(t, 1_000_000);
    expect(await earned(t)).toBe(100_000);
  });

  it('stops at Rp 200.000 a month at the top band, and at Rp 25.000 at the bottom', async () => {
    const top = await withDebitCard('maybank-u-debit', 'avg-10m-plus');
    await spend(top, 30_000_000);
    expect(await earned(top)).toBe(200_000);

    const bottom = await withDebitCard('maybank-u-debit', 'avg-500k');
    await spend(bottom, 30_000_000);
    expect(await earned(bottom)).toBe(25_000);
  });

  it('counts bills against their own ceiling, not the card one', async () => {
    const t = await withDebitCard('maybank-u-debit', 'avg-10m-plus');
    await spend(t, 30_000_000);
    await spend(t, 30_000_000, 'utilities.electricity', 'Token listrik PLN');
    // Both ceilings fill: Rp 200.000 on the card, Rp 50.000 on the bills, which is the advertised Rp 250.000.
    expect(await earned(t)).toBe(250_000);
  });

  it('publishes four balance bands, because the rate is fixed and only the cap moves', () => {
    const levels = findEntry('maybank-u-debit')!.program.memberLevels!;
    expect(levels.map((level) => level.key)).toEqual(['avg-10m-plus', 'avg-5m', 'avg-2m', 'avg-500k']);
    for (const rule of findEntry('maybank-u-debit')!.terms[0]!.rules) {
      expect([rule.rateNum, rule.rateDen], rule.key).toEqual([1, 10]);
      expect(rule.memberLevels, rule.key).toHaveLength(1);
    }
  });
});
