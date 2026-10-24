import { describe, expect, it } from 'vitest';
import { matchesPaidChoice, type PaidChoice } from './PaidWithSheet';

const choices: PaidChoice[] = [
  { value: 'acct:mandiri', name: 'Mandiri Signature', digits: '4821' },
  { value: 'acct:gopay', name: 'GoPay', digits: '5521' },
  { value: 'acct:cash', name: 'Cash', digits: null },
  { value: 'acct:octo', name: 'CIMB Octo', digits: null, detail: 'all cards' },
  { value: 'card:c2', name: 'Aisyah', digits: '8802', detail: 'CIMB Octo' },
];
const found = (typed: string) => choices.filter((choice) => matchesPaidChoice(choice, typed)).map((choice) => choice.value);

describe('matchesPaidChoice', () => {
  it('finds an account by a few of its digits: "48" leaves 4821 alone', () => {
    expect(found('48')).toEqual(['acct:mandiri']);
    expect(found('21')).toEqual(['acct:mandiri', 'acct:gopay']);
  });

  it('finds it by its name, or a card by the account it is on, whatever the case typed', () => {
    expect(found('gopay')).toEqual(['acct:gopay']);
    expect(found('octo')).toEqual(['acct:octo', 'card:c2']);
    expect(found('CASH')).toEqual(['acct:cash']);
  });

  it('keeps every choice while nothing is typed, and none for what nothing answers', () => {
    expect(found('  ')).toHaveLength(choices.length);
    expect(found('9999')).toEqual([]);
  });
});
