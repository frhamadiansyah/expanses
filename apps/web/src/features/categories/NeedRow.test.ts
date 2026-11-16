import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NeedRow } from './NeedRow';

const row = (need: 'essential' | 'lifestyle' | 'debts_savings', source: 'yours' | 'parent' | 'default' | null, caption?: string) =>
  renderToStaticMarkup(createElement(NeedRow, { name: 'Life cover', need: { need, source }, ...(caption ? { caption } : {}), onChoose: () => {} }));

describe('NeedRow', () => {
  it('offers Essential, Lifestyle and Debts & savings, in that order', () => {
    const html = row('essential', null);
    const options = [...html.matchAll(/<option value="([a-z_]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
    expect(options).toEqual([
      ['essential', 'Essential'],
      ['lifestyle', 'Lifestyle'],
      ['debts_savings', 'Debts &amp; savings'],
    ]);
  });

  it('shows the third mark as its answer, built in or chosen, with its caption', () => {
    const html = row('debts_savings', 'default', 'Built in');
    expect(html).toContain('>Debts &amp; savings</span>');
    expect(html).toMatch(/<option value="debts_savings" selected="">/);
    expect(html).toContain('Built in');
  });
});
