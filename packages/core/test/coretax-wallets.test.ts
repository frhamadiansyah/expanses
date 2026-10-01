import { describe, expect, it } from 'vitest';
import { INDONESIAN_WALLETS, walletMatches } from '../src/index';

describe('the digital wallets offered while one is named', () => {
  it('finds a wallet by its name or the app people know it from', () => {
    expect(walletMatches('go').map((w) => w.name)).toContain('GoPay');
    expect(walletMatches('shopee').map((w) => w.name)).toEqual(['ShopeePay']);
    expect(walletMatches('ov').map((w) => w.name)).toEqual(['OVO']);
  });

  it('offers nothing before a letter, and nothing once the field holds a wallet’s name', () => {
    expect(walletMatches('')).toEqual([]);
    expect(walletMatches('GoPay')).toEqual([]);
  });

  it('stores each wallet once', () => {
    const names = INDONESIAN_WALLETS.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
