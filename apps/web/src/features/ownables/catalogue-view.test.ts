import { describe, expect, it } from 'vitest';
import { choiceForCode, codeChoices, fieldsFor, personCodeChoices, pickerRows } from './catalogue-view';

describe('the rows a picker draws', () => {
  it('shows the seven money accounts under one kicker, and never a code', () => {
    const rows = pickerRows({ flow: 'account', query: '' });
    expect(rows.map((row) => row.label)).toEqual([
      'Cash',
      'Current account',
      'Saving account',
      'Time deposit',
      'Digital wallet',
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
  it('asks a deposit when it matures and at what rate, and asks a wallet nothing but its balance', () => {
    expect(fieldsFor('account', 'time_deposit')).toEqual(['balance', 'bank', 'currency', 'matures', 'rate']);
    expect(fieldsFor('account', 'ewallet')).toEqual(['balance', 'currency']);
    expect(fieldsFor('account', 'bank')).toEqual(['balance', 'bank', 'currency']);
  });

  /** A wallet in dollars, cash in euros and a deposit in Singapore are ordinary; none may take the base currency silently. */
  it('asks every kind of money account which currency it holds', () => {
    for (const item of ['cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash']) {
      expect(fieldsFor('account', item), item).toContain('currency');
    }
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

describe('changing the code afterwards', () => {
  it('offers the code’s own table, in the picker’s words, then what is left of it', () => {
    const groups = codeChoices('asset', '0503');
    expect(groups.map((group) => group.label)).toEqual(['Immovable property', 'Something else']);
    expect(groups[0]!.choices.map((choice) => choice.label)).toContain('Apartment');
    expect(groups[1]!.choices.map((choice) => choice.code)).toEqual(['0504', '0505']);
  });

  it('offers a money account the whole cash table, told apart even where two share a code', () => {
    const groups = codeChoices('account', '0109');
    expect(groups[0]!.label).toBe('Cash and cash equivalents');
    expect(groups[0]!.choices.map((choice) => choice.label)).toEqual([
      'Cash',
      'Current account',
      'Saving account',
      'Time deposit',
      'Digital wallet',
      'Fund account',
      'Other cash equivalents',
    ]);
    // Two items are 0102 and two are 0109, so a value of its own is what keeps them apart in a select.
    expect(new Set(groups[0]!.choices.map((choice) => choice.value)).size).toBe(7);
    expect(groups[1]!.choices.map((choice) => choice.code)).toEqual(['0103', '0106', '0107', '0108']);
    expect(choiceForCode(groups, '0102')?.label).toBe('Current account');
    expect(choiceForCode(groups, '0104')?.label).toBe('Time deposit');
  });

  it('opens every table for a code no table names, so nothing becomes unreachable', () => {
    const groups = codeChoices('asset', '');
    expect(groups.map((group) => group.label)).toEqual([
      'Cash and cash equivalents',
      'Receivables',
      'Investments',
      'Movable property',
      'Immovable property',
      'Intangible and other',
    ]);
    expect(choiceForCode(groups, '0503')?.label).toBe('Apartment');
    expect(choiceForCode(groups, '9999')).toBeNull();
  });

  it('offers a debt the four kode utang, and a person only the ones a person can be', () => {
    expect(codeChoices('debt', '101')[0]!.choices.map((choice) => choice.code)).toEqual(['101', '102', '103', '109']);
    expect(personCodeChoices('lent').map((choice) => choice.code)).toEqual(['0201', '0202', '0209']);
    expect(personCodeChoices('borrowed').map((choice) => choice.code)).toEqual(['101', '103', '109']);
  });
});
