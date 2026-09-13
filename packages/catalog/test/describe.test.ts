import { describe, expect, it } from 'vitest';
import { describeEntry } from '../src/describe';
import { findEntry } from '../src/index';

const text = (id: string, today: string) => describeEntry(findEntry(id)!, today).lines.join('\n');

describe('describeEntry', () => {
  it('describes Infinite with both tiers, exclusions with dates, and the current fee', () => {
    const entry = findEntry('bca-sq-krisflyer-visa-infinite')!;
    expect(describeEntry(entry, '2026-09-11').heading).toBe(entry.name);
    const lines = text('bca-sq-krisflyer-visa-infinite', '2026-09-11');
    expect(lines).toMatch(/Terms 2024-08-12 to 2025-09-22:/);
    expect(lines).toMatch(/Terms from 2025-09-23 \(in force today\):/);
    expect(lines).toMatch(/Base: 1 mile per Rp 10\.800, rounded down per purchase\./);
    expect(lines).toMatch(/1\.000 miles from Rp 20\.000\.000 spent, 2\.000 miles from Rp 50\.000\.000 spent/);
    expect(lines).toMatch(/Earns nothing on Electricity, Water & sanitation, Gas & energy, Government & taxes, Charity, Obligation, Fees & charges; merchants matching prudential; MCC 4900 Electric/);
    expect(lines).toMatch(/Annual fee: Rp 1\.000\.000, supplementary Rp 500\.000\./);
    expect(lines).not.toMatch(/750\.000/);
  });

  it('shows a scheduled fee change', () => {
    const lines = text('bca-sq-krisflyer-visa-infinite', '2026-01-01');
    expect(lines).toMatch(/Annual fee: Rp 750\.000, supplementary Rp 450\.000\./);
    expect(lines).toMatch(/From 2026-06-03, annual fee: Rp 1\.000\.000, supplementary Rp 500\.000\./);
  });

  it('describes CIMB half points, statement day, precedence, and the unpublished fee', () => {
    const lines = text('cimb-niaga-world-all-accor', '2026-09-11');
    expect(lines).toMatch(/Overseas transactions: 7,5 points per full Rp 50\.000; spent in a currency other than IDR\./);
    expect(lines).toMatch(/Other domestic transactions: 2,5 points per full Rp 50\.000; spent in IDR\./);
    expect(lines).toMatch(/statement cycle ends on day 22/);
    expect(lines).toMatch(/Each purchase earns at the first rule above that matches\./);
    expect(lines).toMatch(/Annual fee: not published\./);
  });

  it('shows the Mandiri fee condition', () => {
    expect(text('mandiri-world-prioritas', '2026-09-11')).toMatch(/Annual fee: Rp 0, supplementary Rp 0 \(while a Bank Mandiri Prioritas customer\)\./);
  });

  it('describes UnionPay partners, cash value, and stacking', () => {
    const lines = text('bca-unionpay', '2026-09-11');
    expect(lines).toMatch(/spent in SGD, HKD, CNY, TWD; on top of other rules\./);
    expect(lines).toMatch(/Transfers to .+: 200 points = 100 .+, in steps of 20\./);
    expect(lines).toMatch(/Cash value: Rp 20 per 1 point\./);
  });

  it('warns when the entry is stale', () => {
    expect(text('bca-unionpay', '2026-09-11')).not.toMatch(/may be out of date/);
    expect(text('bca-unionpay', '2027-06-01')).toMatch(/may be out of date/);
  });
});
