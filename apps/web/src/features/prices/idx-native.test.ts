import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { IDX_SUMMARY_PAGE } from './idx-file';
import { catchIdxSummary, type IdxDownloadPlugin } from './idx-native';
import { type BoardRow, idxPreview } from './price-board';

/** IDX's Ringkasan Saham for 29 Sep 2026 (ASII, BBCA 6.150, BBRI, BMRI, TLKM), shared with core's parser tests. */
const FIXTURE = readFileSync(new URL('../../../../../packages/core/test/fixtures/ringkasan-saham-20260929.xlsx', import.meta.url));

const plugin = (open: IdxDownloadPlugin['open']): IdxDownloadPlugin => ({
  open: vi.fn(open),
});

describe('IDX file caught in the iOS sheet', () => {
  it('opens IDX’s own page and reads the caught bytes through the same parser, into the same preview', async () => {
    const sheet = plugin(async () => ({
      fileName: 'Ringkasan Saham-20260929.xlsx',
      mimeType: 'application/octet-stream',
      base64: FIXTURE.toString('base64'),
    }));
    const summary = await catchIdxSummary(sheet);
    expect(sheet.open).toHaveBeenCalledWith({ url: IDX_SUMMARY_PAGE });
    expect(summary!.tradeDate).toBe('2026-09-29');
    expect(summary!.closes.get('BBCA')).toBe(6_150);

    const held: BoardRow = {
      key: 's1',
      securityId: 's1',
      accountId: null,
      title: 'BBCA',
      currency: 'IDR',
      idxTicker: 'BBCA',
      latest: {
        onDate: '2026-09-28',
        priceMicro: 6_250_000_000,
        source: 'manual',
      },
    };
    const preview = idxPreview(summary!, [held]);
    expect(preview.rows).toEqual([
      {
        securityId: 's1',
        ticker: 'BBCA',
        oldMicro: 6_250_000_000,
        newMicro: 6_150_000_000,
        keptMicro: null,
      },
    ]);
    expect(preview.skipped).toBe(4);
  });

  it('base64 wrapped over lines reads the same', async () => {
    const wrapped = FIXTURE.toString('base64').replace(/.{76}/g, '$&\n');
    const summary = await catchIdxSummary(
      plugin(async () => ({
        fileName: 'a.xlsx',
        mimeType: '',
        base64: wrapped,
      })),
    );
    expect(summary!.closes.get('BBCA')).toBe(6_150);
  });

  it('Cancel is quiet: nothing read, nothing thrown', async () => {
    await expect(catchIdxSummary(plugin(() => Promise.reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' }))))).resolves.toBeNull();
  });

  it('a failed download, or a file that is not IDX’s, is said', async () => {
    await expect(
      catchIdxSummary(
        plugin(() =>
          Promise.reject(
            Object.assign(new Error('The downloaded file could not be read.'), {
              code: 'download_failed',
            }),
          ),
        ),
      ),
    ).rejects.toThrow('could not be read');
    const notIdx = Buffer.from('not a spreadsheet').toString('base64');
    await expect(
      catchIdxSummary(
        plugin(async () => ({
          fileName: 'x.xlsx',
          mimeType: '',
          base64: notIdx,
        })),
      ),
    ).rejects.toThrow();
  });
});
