import type { DraftRow } from '@expanses/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ListRow } from './list-model';
import { DraftSubtitle } from './TransactionRow';

const text = (html: string) => html.replace(/<[^>]+>/g, '');

function draftRow(extra: Partial<ListRow>): ListRow {
  return {
    kind: 'draft', id: 'd1', date: '2026-09-12', description: 'Kedai Mawar', amountMinor: 40_000, currency: 'IDR', baseMinor: 0, spentMinor: 0, earnedMinor: 0, type: 'expense',
    categoryId: null, categoryName: null, parentName: null, accountIds: ['octo'], accountLabel: 'Lintas Rewards', cardId: 'c1', last4: '1467', holderName: null, deleted: false,
    excluded: false, needs: [], draft: {} as DraftRow, ...extra,
  };
}

describe('DraftSubtitle', () => {
  it('names the card by its digits alone, as a recorded row does', () => {
    expect(text(renderToStaticMarkup(createElement(DraftSubtitle, { row: draftRow({}) })))).toBe('Kedai Mawar · 1467');
  });

  it('keeps the account name without digits, and says what it still needs', () => {
    expect(text(renderToStaticMarkup(createElement(DraftSubtitle, { row: draftRow({ last4: null, cardId: null }) })))).toBe('Kedai Mawar · Lintas Rewards');
    expect(text(renderToStaticMarkup(createElement(DraftSubtitle, { row: draftRow({ description: '', accountIds: [], accountLabel: '', last4: null, needs: ['paid with'] }) })))).toBe(
      'No description yet · needs an account',
    );
  });
});
