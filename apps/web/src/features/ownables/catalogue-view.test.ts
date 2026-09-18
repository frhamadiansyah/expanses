import { describe, expect, it } from 'vitest';
import { fieldsFor, pickerRows } from './catalogue-view';

describe('the rows a picker draws', () => {
  it('shows the seven money accounts under one kicker, and never a code', () => {
    const rows = pickerRows({ flow: 'account', query: '' });
    expect(rows.map((row) => row.label)).toEqual([
      'Cash',
      'Bank account',
      'Saving account',
      'Time deposit',
      'Electronic money',
      'Fund account',
      'Other cash equivalents',
    ]);
    expect(rows.map((row) => row.sub)).toContain('locked until it matures');
    // A row carries no code at all, so no screen built on one can leak it into the picker.
    for (const row of rows) expect(Object.keys(row)).not.toContain('code');
    expect(JSON.stringify(rows)).not.toMatch(/\b0\d{3}\b/);
  });

  it('shows the five families first, then the things in one of them, then what is left of its table', () => {
    expect(pickerRows({ flow: 'asset', query: '' }).map((row) => row.id)).toEqual(['receivable', 'invest', 'movable', 'immovable', 'other']);
    const invest = pickerRows({ flow: 'asset', query: '', family: 'invest' });
    expect(invest.map((row) => row.label)).toContain('Mutual fund (reksadana)');
    expect(invest.at(-1)).toMatchObject({ id: 'more', label: 'Something else', sub: '4 more kinds the form knows' });
    expect(pickerRows({ flow: 'asset', query: '', family: 'invest', more: true }).map((row) => row.label)).toEqual([
      'Shares bought to resell',
      'Other debt securities',
      'Equity not in share form',
      'Other investments',
    ]);
  });

  it('searches across families, so a thing is found without knowing its family', () => {
    expect(pickerRows({ flow: 'asset', query: 'apartment' }).map((row) => row.id)).toEqual(['apartment']);
    expect(pickerRows({ flow: 'asset', query: 'emas' }).length).toBe(0);
    expect(pickerRows({ flow: 'debt', query: 'kartu' }).length).toBe(0);
    expect(pickerRows({ flow: 'debt', query: 'card' }).map((row) => row.id)).toEqual(['credit_card']);
  });
});

describe('what a form asks for', () => {
  it('asks a deposit when it matures and at what rate, and asks a wallet nothing extra', () => {
    expect(fieldsFor('account', 'time_deposit')).toEqual(['balance', 'bank', 'matures', 'rate']);
    expect(fieldsFor('account', 'ewallet')).toEqual(['balance']);
    expect(fieldsFor('account', 'bank')).toEqual(['balance', 'bank', 'currency']);
  });

  it('asks a holding for units and a price, and anything else for a value', () => {
    expect(fieldsFor('asset', 'stock')).toEqual(['units', 'price']);
    expect(fieldsFor('asset', 'bond')).toEqual(['face', 'price']);
    expect(fieldsFor('asset', 'gold')).toEqual(['grams']);
    expect(fieldsFor('asset', 'apartment')).toEqual(['value']);
    expect(fieldsFor('asset', 'trade_receivable')).toEqual(['person', 'owed']);
  });

  it('asks a mortgage for terms, a paylater for no rate, and a person for a name', () => {
    expect(fieldsFor('debt', 'home_mortgage')).toEqual(['owed', 'lender', 'rate', 'term']);
    expect(fieldsFor('debt', 'online_loan')).toEqual(['owed', 'lender', 'term']);
    expect(fieldsFor('debt', 'credit_card')).toEqual(['card']);
    expect(fieldsFor('debt', 'affiliate_debt')).toEqual(['owed', 'person']);
  });
});
