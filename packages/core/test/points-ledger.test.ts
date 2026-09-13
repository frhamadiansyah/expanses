import { describe, expect, it } from 'vitest';
import { balanceOf, type PointEntry } from '../src/index';

const TODAY = '2026-09-13';

const earn = (id: string, quantity: number, occurredOn: string, extra: Partial<PointEntry> = {}): PointEntry => ({
  id,
  kind: 'earn',
  quantity,
  occurredOn,
  status: 'posted',
  batchId: null,
  expiresOn: null,
  ...extra,
});

const spend = (id: string, quantity: number, batchId: string, occurredOn = TODAY): PointEntry => ({
  id,
  kind: 'redeem',
  quantity: -Math.abs(quantity),
  occurredOn,
  status: 'posted',
  batchId,
  expiresOn: null,
});

describe('the balance', () => {
  it('keeps what the issuer confirmed apart from what was only worked out', () => {
    const balance = balanceOf([earn('a', 4_200, '2026-08-01'), earn('b', 800, '2026-09-01', { status: 'projected', source: 'projected' })], TODAY);

    expect(balance).toMatchObject({ total: 5_000, postedTotal: 4_200, projectedTotal: 800 });
  });

  it('falls when points are spent', () => {
    const balance = balanceOf([earn('a', 4_200, '2026-08-01'), spend('r1', 1_200, 'a')], TODAY);

    expect(balance.total).toBe(3_000);
    expect(balance.postedTotal).toBe(3_000);
  });

  it('is nothing at all when there is nothing to count', () => {
    expect(balanceOf([], TODAY)).toMatchObject({ total: 0, postedTotal: 0, projectedTotal: 0, expiringSoon: 0, nextExpiryOn: null });
  });
});

describe('what is about to expire', () => {
  it('counts only what is still held in a batch that is running out', () => {
    const entries = [earn('a', 1_000, '2024-10-01', { expiresOn: '2026-10-01' }), earn('b', 5_000, '2026-01-01', { expiresOn: '2028-01-01' })];

    const balance = balanceOf(entries, TODAY, 60);

    expect(balance.expiringSoon).toBe(1_000);
    expect(balance.nextExpiryOn).toBe('2026-10-01');
  });

  it('leaves out what has already been spent from that batch', () => {
    const entries = [earn('a', 1_000, '2024-10-01', { expiresOn: '2026-10-01' }), spend('r1', 900, 'a')];

    expect(balanceOf(entries, TODAY, 60).expiringSoon).toBe(100);
  });

  it('says nothing is near when the date is further off than the window', () => {
    const entries = [earn('a', 1_000, '2026-01-01', { expiresOn: '2027-06-01' })];

    const balance = balanceOf(entries, TODAY, 60);

    expect(balance.expiringSoon).toBe(0);
    expect(balance.nextExpiryOn).toBe('2027-06-01');
  });

  it('ignores a batch with no expiry at all, which is the default', () => {
    const balance = balanceOf([earn('a', 1_000, '2026-01-01')], TODAY, 60);

    expect(balance.expiringSoon).toBe(0);
    expect(balance.nextExpiryOn).toBeNull();
  });

  it('does not count a batch that already expired and was written off', () => {
    const entries = [
      earn('a', 1_000, '2024-01-01', { expiresOn: '2026-01-01' }),
      { id: 'x1', kind: 'expire' as const, quantity: -1_000, occurredOn: '2026-01-01', status: 'posted' as const, batchId: 'a', expiresOn: null },
    ];

    const balance = balanceOf(entries, TODAY, 60);

    expect(balance.total).toBe(0);
    expect(balance.expiringSoon).toBe(0);
  });
});
