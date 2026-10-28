import { CATALOG } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { canonicalBank, catalogueOffers, entryOnRow, sameBank } from './card-row';

const credit = CATALOG.filter((entry) => entry.cardType !== 'debit');
const entryFor = (id: string) => {
  const entry = CATALOG.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`The catalogue no longer carries "${id}"`);
  return entry;
};
const names = (bank: string, typed: string) => catalogueOffers(credit, bank, typed).map((entry) => entry.name);

describe('one bank, however it is written', () => {
  it('reads a short name, a full name and a "Bank" in front as the same bank', () => {
    expect(sameBank('BCA', 'Bank Central Asia')).toBe(true);
    expect(sameBank('bca', 'BCA')).toBe(true);
    expect(sameBank('Bank BNI', 'BNI')).toBe(true);
    expect(sameBank('Mandiri', 'Bank Mandiri')).toBe(true);
    expect(sameBank('BCA', 'BCA Digital')).toBe(false);
    // A bank the list does not know is its own name, compared as written.
    expect(canonicalBank('  Bank  Kita ')).toBe('bank kita');
  });
});

describe('the catalogue cards offered while a card name is typed', () => {
  it('offers the chosen bank’s cards, narrowed by every word typed', () => {
    const bca = names('BCA', '');
    expect(bca.length).toBeGreaterThan(0);
    expect(bca.length).toBeLessThanOrEqual(3);
    expect(catalogueOffers(credit, 'Bank Central Asia', '').every((entry) => sameBank(entry.bank, 'BCA'))).toBe(true);
    expect(names('BCA', 'union')).toEqual(['BCA UnionPay']);
    expect(names('Mandiri', 'union')).toEqual([]);
  });

  it('looks across every bank while none is chosen, by the bank and name together', () => {
    expect(names('', 'bca union')).toEqual(['BCA UnionPay']);
    expect(names('', 'accor')).toEqual(['CIMB Niaga World All Accor']);
  });

  it('offers nothing before either half of the row says something, or for a name no card has', () => {
    expect(names('', '')).toEqual([]);
    expect(names('  ', ' ')).toEqual([]);
    expect(names('', 'Kartu Setengah')).toEqual([]);
  });
});

describe('a catalogue card on the bank-and-name row', () => {
  it('puts its bank in the bank’s place and its name without the bank’s words', () => {
    expect(entryOnRow(entryFor('bca-unionpay'))).toEqual({ bank: 'BCA', name: 'UnionPay' });
    expect(entryOnRow(entryFor('cimb-niaga-world-all-accor'))).toEqual({ bank: 'CIMB Niaga', name: 'World All Accor' });
    // A product name that does not lead with its bank stays whole.
    const jenius = entryFor('jenius-platinum');
    expect(entryOnRow(jenius)).toEqual({ bank: jenius.bank, name: 'Jenius Platinum' });
  });
});
