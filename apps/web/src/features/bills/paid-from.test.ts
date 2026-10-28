import { describe, expect, it } from 'vitest';
import { paidFromCaptions, paidFromName, type PaidFromRow } from './paid-from';

const row = (over: Partial<PaidFromRow> & { id: string }): PaidFromRow => ({ name: over.id, digits: null, balanceText: null, workspaceName: null, ...over });

describe('paidFromCaptions', () => {
  it('leads with the digits, then the balance', () => {
    const out = paidFromCaptions([row({ id: 'a', name: 'BCA', digits: '7788', balanceText: 'Rp 12.500.000' })]);
    expect(out.a).toBe('···· 7788 · Rp 12.500.000');
  });
  it('reads the balance alone without digits, and nothing with neither', () => {
    const out = paidFromCaptions([row({ id: 'a', name: 'Cash', balanceText: 'Rp 932.500' }), row({ id: 'b', name: 'Other' })]);
    expect(out).toEqual({ a: 'Rp 932.500', b: '' });
  });
  it('adds the workspace to twins only', () => {
    const out = paidFromCaptions([
      row({ id: 'a', name: 'GoPay', balanceText: 'Rp 1.200.000', workspaceName: 'Personal' }),
      row({ id: 'b', name: 'GoPay', balanceText: 'Rp 85.000', workspaceName: 'Family' }),
      row({ id: 'c', name: 'Cash', balanceText: 'Rp 5.000', workspaceName: 'Personal' }),
    ]);
    expect(out).toEqual({ a: 'Rp 1.200.000 · Personal', b: 'Rp 85.000 · Family', c: 'Rp 5.000' });
  });
  it('does not add the workspace when the digits already differ', () => {
    const out = paidFromCaptions([
      row({ id: 'a', name: 'GoPay', digits: '1111', balanceText: 'Rp 1', workspaceName: 'Personal' }),
      row({ id: 'b', name: 'GoPay', digits: '2222', balanceText: 'Rp 2', workspaceName: 'Family' }),
    ]);
    expect(out).toEqual({ a: '···· 1111 · Rp 1', b: '···· 2222 · Rp 2' });
  });
  it('falls back to the day added only for twins that still read alike', () => {
    const out = paidFromCaptions([
      row({ id: 'a', name: 'GoPay', balanceText: 'Rp 0', addedText: 'Added 3 Mar' }),
      row({ id: 'b', name: 'GoPay', balanceText: 'Rp 0', addedText: 'Added 19 Aug' }),
      row({ id: 'c', name: 'Cash', balanceText: 'Rp 0', addedText: 'Added 1 Jan' }),
    ]);
    expect(out).toEqual({ a: 'Rp 0 · Added 3 Mar', b: 'Rp 0 · Added 19 Aug', c: 'Rp 0' });
  });
  it('leaves twins with different balances without a day added', () => {
    const out = paidFromCaptions([
      row({ id: 'a', name: 'GoPay', balanceText: 'Rp 1', addedText: 'Added 3 Mar' }),
      row({ id: 'b', name: 'GoPay', balanceText: 'Rp 2', addedText: 'Added 19 Aug' }),
    ]);
    expect(out).toEqual({ a: 'Rp 1', b: 'Rp 2' });
  });
});

describe('paidFromName', () => {
  const rows = [row({ id: 'a', name: 'GoPay', digits: '1111' }), row({ id: 'b', name: 'GoPay' }), row({ id: 'c', name: 'Cash', digits: '9999' })];
  it('adds digits only against a namesake', () => {
    expect(paidFromName(rows[0]!, rows)).toBe('GoPay ···· 1111');
    expect(paidFromName(rows[1]!, rows)).toBe('GoPay');
    expect(paidFromName(rows[2]!, rows)).toBe('Cash');
  });
});
