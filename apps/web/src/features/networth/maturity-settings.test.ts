// apps/web/src/features/networth/maturity-settings.test.ts
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { payoutChoices, taxBpsFrom, termLabel } from './maturity-settings';

const account = (id: string, partial: Partial<AccountRow>): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind: 'asset', subtype: 'bank', name: id, icon: null, currency: 'IDR',
  valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-01-01T00:00:00Z', ...partial,
});

describe('where the money may land', () => {
  it('offers only open, spendable accounts in the deposit’s currency, never the deposit', () => {
    const all = [
      account('bca', {}),
      account('jenius-usd', { currency: 'USD' }),
      account('closed', { archivedAt: '2026-02-01T00:00:00Z' }),
      account('visa', { kind: 'liability', subtype: 'credit_card' }),
      account('deposito', { subtype: 'time_deposit' }),
      account('gopay', { subtype: 'ewallet' }),
    ];
    expect(payoutChoices(all, 'IDR', 'deposito').map((a) => a.id)).toEqual(['bca', 'gopay']);
    expect(payoutChoices(all, 'USD', 'deposito').map((a) => a.id)).toEqual(['jenius-usd']);
  });
});

describe('the rest of the group', () => {
  it('says a term in words', () => {
    expect(termLabel(1)).toBe('1 month');
    expect(termLabel(12)).toBe('12 months');
  });

  it('reads a withholding typed either way, takes no tax as an answer, and refuses more than all of it', () => {
    expect(taxBpsFrom('20')).toBe(2000);
    expect(taxBpsFrom('12,5')).toBe(1250);
    expect(taxBpsFrom('12.5')).toBe(1250);
    // parseRate alone throws on these; the box starts at "0" when a deposit was saved with no tax.
    expect(taxBpsFrom('0')).toBe(0);
    expect(taxBpsFrom('0,0')).toBe(0);
    expect(() => taxBpsFrom('101')).toThrow();
    expect(() => taxBpsFrom('')).toThrow();
  });
});
