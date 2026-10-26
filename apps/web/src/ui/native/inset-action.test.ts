import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InsetRow } from './InsetList';

const CHEVRON = '›';

describe('InsetRow action', () => {
  it('centres the title in ink with no chevron and no icon', () => {
    const html = renderToStaticMarkup(h(InsetRow, { action: true, title: 'Save', icon: h('i'), chevron: true, onClick: () => {}, testId: 'save', label: 'Save it' }));
    expect(html).toContain('text-center');
    expect(html).toContain('text-[var(--ph-ink)]');
    expect(html).not.toContain(CHEVRON);
    expect(html).not.toContain('rounded-full');
    expect(html).not.toContain('--ph-tint');
    expect(html).not.toContain('--ph-alarm');
    expect(html).toContain('data-testid="save"');
    expect(html).toContain('aria-label="Save it"');
  });

  it('keeps the disabled behaviour', () => {
    const html = renderToStaticMarkup(h(InsetRow, { action: true, title: 'Save', disabled: true, onClick: () => {} }));
    expect(html).toContain('disabled=""');
    expect(html).toContain('opacity-40');
  });

  it('leaves an ordinary row left-aligned with its chevron', () => {
    const html = renderToStaticMarkup(h(InsetRow, { title: 'Currency', onClick: () => {} }));
    expect(html).toContain(CHEVRON);
    expect(html).not.toContain('text-center');
  });
});
