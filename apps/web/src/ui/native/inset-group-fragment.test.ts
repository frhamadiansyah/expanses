import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InsetGroup, InsetRow } from './InsetList';

const hairlines = (html: string) => html.split('bg-[var(--ph-hair)]').length - 1;

describe('InsetGroup', () => {
  it('draws a hairline between rows that sit inside a fragment, as between loose rows', () => {
    const loose = renderToStaticMarkup(
      createElement(InsetGroup, null, createElement(InsetRow, { title: 'One' }), createElement(InsetRow, { title: 'Two' }), createElement(InsetRow, { title: 'Three' })),
    );
    const wrapped = renderToStaticMarkup(
      createElement(
        InsetGroup,
        null,
        createElement(InsetRow, { title: 'One' }),
        createElement(Fragment, null, createElement(InsetRow, { title: 'Two' }), createElement(InsetRow, { title: 'Three' })),
      ),
    );
    expect(hairlines(loose)).toBe(2);
    expect(hairlines(wrapped)).toBe(2);
  });
});
