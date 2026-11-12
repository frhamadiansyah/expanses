import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { categoryIdsByKey, createAccount, getCardTerms, nativeBalances, postTransaction, saveCardTerms, waiveAnnualFee } from '../src/index';
import { setupDb } from './helpers';

async function card() {
  const t = await setupDb();
  const acc = await createAccount(t.database, t.ws, { name: 'Fee card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  return { ...t, id: acc.id };
}
const terms = { statementDay: 25, dueDay: 12, creditLimitMinor: null, annualFeeMinor: 500_000 };

describe('card annual fee date', () => {
  it('saves and loads the date, and clears it', async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2025-03-12' });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeOn).toBe('2025-03-12');
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: null });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeOn).toBeNull();
  });
  it('leaves the date alone when a save does not mention it', async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2025-03-12' });
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, statementDay: 20 });
    const row = await getCardTerms(t.database, t.ws, t.id);
    expect(row?.annualFeeOn).toBe('2025-03-12');
    expect(row?.statementDay).toBe(20);
  });
  it('refuses a date that is not whole', async () => {
    const t = await card();
    await expect(saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2025-03' })).rejects.toThrow();
  });
});

describe('waiving the annual fee', () => {
  const TODAY = '2026-10-26';
  const withDate = async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2020-11-12' });
    return t;
  };

  it('refunds a recorded fee on the card in its own category, and sets the marker', async () => {
    const t = await withDate();
    const category = (await categoryIdsByKey(t.database, t.ws))['miscellaneous.membership_fee']!;
    await postTransaction(t.database, t.ws, {
      occurredOn: '2026-11-12',
      description: 'Annual fee',
      lines: [
        { accountId: category, amountMinor: 500_000, currency: 'IDR' },
        { accountId: t.id, amountMinor: -500_000, currency: 'IDR' },
      ],
    });
    expect((await nativeBalances(t.database, t.ws))[t.id]).toBe(-500_000);
    const result = await waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: '2026-11-20' });
    expect(result.refundedMinor).toBe(500_000);
    expect(result.transactionId).not.toBeNull();
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.id]).toBe(0);
    expect(balances[category]).toBe(0);
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
    // A second answer for the same charge does nothing.
    expect(await waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: '2026-11-21' })).toEqual({ transactionId: null, refundedMinor: 0 });
    expect((await nativeBalances(t.database, t.ws))[t.id]).toBe(0);
  });

  it('records nothing financial when the fee was never recorded, only the marker', async () => {
    const t = await withDate();
    const result = await waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: TODAY });
    expect(result).toEqual({ transactionId: null, refundedMinor: 0 });
    expect((await nativeBalances(t.database, t.ws))[t.id] ?? 0).toBe(0);
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
  });

  it('covers the last charge when the next is over 30 days away', async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2024-03-12' });
    await waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: '2026-11-12' });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
  });

  describe('the reversal date', () => {
    const recorded = async () => {
      const t = await withDate();
      const category = (await categoryIdsByKey(t.database, t.ws))['miscellaneous.membership_fee']!;
      await postTransaction(t.database, t.ws, {
        occurredOn: '2026-11-12',
        description: 'Annual fee',
        lines: [
          { accountId: category, amountMinor: 500_000, currency: 'IDR' },
          { accountId: t.id, amountMinor: -500_000, currency: 'IDR' },
        ],
      });
      return t;
    };
    const refundDate = async (t: Awaited<ReturnType<typeof recorded>>, id: string | null) => {
      const rows = await t.database.db.values<[string]>(sql`SELECT occurred_on FROM transactions WHERE id = ${id}`);
      return rows[0]![0];
    };

    it('posts the refund on the chosen day', async () => {
      const t = await recorded();
      const result = await waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: '2026-12-20', reversedOn: '2026-12-03' });
      expect(await refundDate(t, result.transactionId)).toBe('2026-12-03');
      expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
    });
    it('is today by default', async () => {
      const t = await recorded();
      const result = await waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: '2026-12-20' });
      expect(await refundDate(t, result.transactionId)).toBe('2026-12-20');
    });
    it('is refused before the charge or after today, and nothing is marked', async () => {
      const t = await recorded();
      await expect(waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: '2026-12-20', reversedOn: '2026-11-11' })).rejects.toThrow(/before/);
      await expect(waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: '2026-12-20', reversedOn: '2026-12-21' })).rejects.toThrow(/future/);
      expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBeNull();
    });
  });

  it('keeps the marker through a later save of the terms', async () => {
    const t = await withDate();
    await waiveAnnualFee(t.database, t.ws, { cardId: t.id, today: TODAY });
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2020-11-12' });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
  });
});
