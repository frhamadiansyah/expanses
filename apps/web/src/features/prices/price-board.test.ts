import type { AssetValueRow, HoldingLinkRow, SecurityRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { idxPreview, priceBoard, staleLines } from './price-board';

const value = (accountId: string, name: string, o: Partial<AssetValueRow> = {}) =>
  ({ accountId, name, currency: 'IDR', mode: 'market', unitsMicro: 1_000_000, ...o }) as AssetValueRow;
const security = (id: string, ticker: string, market = 'IDX', currency = 'IDR'): SecurityRow => ({ id, ticker, name: ticker, market, currency, lotSize: 100, kind: 'share', source: 'catalogue' });
const link = (accountId: string, securityId: string): HoldingLinkRow => ({ accountId, securityId, brokerAccountId: null });

const board = priceBoard({
  values: [
    value('a1', 'BBCA · Stockbit'),
    value('a2', 'BBCA · Mandiri'),
    value('a3', 'AAPL', { currency: 'USD' }),
    value('a4', 'Reksadana Pasar Uang'),
    value('a5', 'Antam gold bars'),
    value('a6', 'TLKM', { unitsMicro: 0 }),
    value('a7', 'House', { mode: 'snapshot' }),
  ],
  kinds: { a4: 'fund', a5: 'gold', a7: 'property' },
  links: [link('a1', 's1'), link('a2', 's1'), link('a3', 's2'), link('a6', 's3')],
  securities: [security('s1', 'BBCA'), security('s2', 'AAPL', 'NASDAQ', 'USD'), security('s3', 'TLKM')],
  latestBySecurity: { s1: { onDate: '2026-09-21', priceMicro: 6_250_000_000, source: 'manual' } },
  latestOwn: {},
});

describe('Update prices', () => {
  it('lists each security held once, IDX shares apart, then funds; never gold, a sold-out holding or an estimate', () => {
    expect(board.stocks.map((row) => row.title)).toEqual(['BBCA']);
    expect(board.others.map((row) => row.title)).toEqual(['AAPL', 'Reksadana Pasar Uang']);
    expect(staleLines([...board.stocks, ...board.others], '2026-09-30', 7)).toBe(3);
  });

  it('previews an IDX file against the shares held, keeping a price typed for its day', () => {
    const summary = { tradeDate: '2026-09-29', closes: new Map([['BBCA', 6_150], ['BBRI', 3_170], ['TLKM', 2_370]]) };
    expect(idxPreview(summary, board.stocks)).toEqual({
      tradeDate: '2026-09-29',
      rows: [{ securityId: 's1', ticker: 'BBCA', oldMicro: 6_250_000_000, newMicro: 6_150_000_000, keptMicro: null }],
      skipped: 2,
    });
    const typed = [{ ...board.stocks[0]!, latest: { onDate: '2026-09-29', priceMicro: 6_100_000_000, source: 'manual' as const } }];
    expect(idxPreview(summary, typed).rows[0]!.keptMicro).toBe(6_100_000_000);
  });
});
