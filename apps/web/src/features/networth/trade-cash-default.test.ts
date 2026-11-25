import type { TradeKind } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { tradeCashDefault } from './trade-cash-default';

const trade = (kind: TradeKind, cashAccountId: string | null, occurredOn: string, createdAt = `${occurredOn}T09:00:00.000Z`) => ({
  kind,
  cashAccountId,
  occurredOn,
  createdAt,
});

const choices = [{ id: 'bank' }, { id: 'broker' }, { id: 'wallet' }];

describe('tradeCashDefault', () => {
  it('starts on the account the holding is linked to, ahead of the last trade', () => {
    expect(tradeCashDefault({ choices, linkedId: 'broker', trades: [trade('buy', 'bank', '2026-03-01')] })).toBe('broker');
  });

  it('passes over a linked account the sheet does not offer', () => {
    expect(tradeCashDefault({ choices, linkedId: 'archived', trades: [trade('buy', 'wallet', '2026-03-01')] })).toBe('wallet');
  });

  it('with no link, starts on the account the most recent buy or sell used', () => {
    const trades = [trade('buy', 'bank', '2026-01-10'), trade('sell', 'wallet', '2026-02-20'), trade('buy', 'bank', '2026-02-01')];
    expect(tradeCashDefault({ choices, linkedId: null, trades })).toBe('wallet');
    // The same day: the one recorded last.
    const sameDay = [trade('buy', 'wallet', '2026-04-01', '2026-04-01T10:00:00.000Z'), trade('buy', 'bank', '2026-04-01', '2026-04-01T08:00:00.000Z')];
    expect(tradeCashDefault({ choices, trades: sameDay })).toBe('wallet');
  });

  it('passes over a past purchase, income, a changed count, and an account no longer offered', () => {
    const trades = [trade('buy', 'bank', '2026-01-10'), trade('buy', null, '2026-02-01'), trade('income', 'wallet', '2026-03-01'), trade('unit_change', null, '2026-03-02'), trade('sell', 'gone', '2026-03-05')];
    expect(tradeCashDefault({ choices, trades })).toBe('bank');
  });

  it('leaves the account to be picked when nothing names one: never the first account', () => {
    expect(tradeCashDefault({ choices, trades: [] })).toBeNull();
    expect(tradeCashDefault({ choices, linkedId: null, trades: [trade('buy', null, '2026-01-01')] })).toBeNull();
    expect(tradeCashDefault({ choices: [], linkedId: 'broker', trades: [] })).toBeNull();
  });
});
