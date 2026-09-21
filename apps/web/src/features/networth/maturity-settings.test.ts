// apps/web/src/features/networth/maturity-settings.test.ts
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { payoutChoices, saveQueue, taxBpsFrom, termLabel } from './maturity-settings';

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

  it('never offers an account with pockets, only its pockets', () => {
    const all = [
      account('valas', {}),
      account('valas-idr', { parentId: 'valas' }),
      account('valas-usd', { parentId: 'valas', currency: 'USD' }),
      account('bca', {}),
    ];
    expect(payoutChoices(all, 'IDR', 'deposito').map((a) => a.id)).toEqual(['valas-idr', 'bca']);
    expect(payoutChoices(all, 'USD', 'deposito').map((a) => a.id)).toEqual(['valas-usd']);
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

describe('settings saves', () => {
  /** A save that finishes only when the test says so, so the database can be made to answer out of order. */
  function deferred() {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const tick = () => new Promise((res) => setTimeout(res, 0));

  it('are applied in the order they were made, even when the first one is slow', async () => {
    const enqueue = saveQueue();
    const log: string[] = [];
    const slow = deferred();
    const first = enqueue(async () => {
      log.push('older starts');
      await slow.promise;
      log.push('older lands');
    });
    const second = enqueue(async () => {
      log.push('newer starts');
      log.push('newer lands');
    });
    await tick();
    // The newer snapshot waits: had it gone first, the older one would land last and undo it.
    expect(log).toEqual(['older starts']);
    slow.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual(['older starts', 'older lands', 'newer starts', 'newer lands']);
  });

  it('keeps going after a save fails, and the failure reaches its own caller', async () => {
    const enqueue = saveQueue();
    const log: string[] = [];
    const failing = deferred();
    const first = enqueue(() => failing.promise);
    const second = enqueue(async () => {
      log.push('newer lands');
    });
    failing.reject(new Error('refused'));
    await expect(first).rejects.toThrow('refused');
    await second;
    expect(log).toEqual(['newer lands']);
  });
});
