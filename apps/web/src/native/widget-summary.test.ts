import { formatMinor } from '@expanses/core';
import { describe, expect, it, vi } from 'vitest';
import { eraseWidgetSummary, onWidgetSummaryErased, summaryKey, summaryOf, WidgetSummary } from './widget-summary';

const sheet = { spendingActualMinor: 3_450_000, capsTotalMinor: 5_000_000, currency: 'IDR' };
const at = { bookId: 'b1', month: '2026-11', now: new Date('2026-11-10T08:00:00Z') };

describe('widget summary', () => {
  it("summaryOf gives the month's spending and its share of the budget", () => {
    expect(summaryOf(sheet, at)).toEqual({
      bookId: 'b1',
      month: '2026-11',
      amountMinor: 3_450_000,
      currency: 'IDR',
      amountText: formatMinor(3_450_000, 'IDR'),
      sharePercent: 69,
      writtenAt: '2026-11-10T08:00:00.000Z',
    });
  });

  it('has no share without a budget', () => {
    expect(summaryOf({ ...sheet, capsTotalMinor: 0 }, at).sharePercent).toBeNull();
  });

  it('never shows less than nothing', () => {
    expect(summaryOf({ ...sheet, spendingActualMinor: -20_000 }, at).amountMinor).toBe(0);
  });

  it('rewrites for a new month or workspace, not for a new time', () => {
    const key = summaryKey(summaryOf(sheet, at));
    expect(summaryKey(summaryOf(sheet, { ...at, now: new Date('2026-11-10T09:30:00Z') }))).toBe(key);
    expect(summaryKey(summaryOf(sheet, { ...at, month: '2026-12' }))).not.toBe(key);
    expect(summaryKey(summaryOf(sheet, { ...at, bookId: 'b2' }))).not.toBe(key);
  });

  it('the web has no widget', async () => {
    expect(await WidgetSummary.getEnabled()).toEqual({ enabled: false });
  });

  it('erasing clears the widget, then tells the writer to write afresh', async () => {
    const order: string[] = [];
    const plugin = {
      erase: async () => {
        order.push('erase');
      },
    };
    const stop = onWidgetSummaryErased(() => order.push('writer'));
    await eraseWidgetSummary(plugin);
    expect(order).toEqual(['erase', 'writer']);
    stop();
    await eraseWidgetSummary(plugin);
    expect(order).toEqual(['erase', 'writer', 'erase']);
  });

  it('a failed erase never throws, and the writer is still told', async () => {
    const plugin = { erase: () => Promise.reject(new Error('no App Group')) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const told = vi.fn();
    const stop = onWidgetSummaryErased(told);
    await expect(eraseWidgetSummary(plugin)).resolves.toBeUndefined();
    expect(told).toHaveBeenCalledTimes(1);
    stop();
    warn.mockRestore();
  });
});
