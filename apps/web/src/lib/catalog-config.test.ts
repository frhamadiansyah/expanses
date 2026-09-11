import { findEntry } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { CATALOG_REPORT_EMAIL, reportMailto, shouldShowReport } from './catalog-config';

describe('catalogue reports', () => {
  it('encodes subject and body with the entry identity and blanks, and no transaction data', () => {
    const entry = findEntry('bca-unionpay')!;
    const href = reportMailto('catalogue@example.com', entry);
    expect(href.startsWith('mailto:catalogue@example.com?subject=')).toBe(true);
    expect(href).not.toMatch(/\s/);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('subject')).toBe(`Catalogue change: ${entry.name} (${entry.id} v${entry.entryVersion})`);
    const body = params.get('body')!;
    for (const text of [entry.name, entry.id, `Entry version: ${entry.entryVersion}`, `Verified on: ${entry.verifiedOn}`, 'What changed:', 'Source link']) {
      expect(body).toContain(text);
    }
    expect(body).not.toMatch(/amount|balance|transaction|account|spend/i);
  });

  it('hides the report button until an address is configured', () => {
    expect(shouldShowReport(CATALOG_REPORT_EMAIL)).toBe(false);
    expect(shouldShowReport('')).toBe(false);
    expect(shouldShowReport('   ')).toBe(false);
    expect(shouldShowReport('catalogue@example.com')).toBe(true);
  });
});
