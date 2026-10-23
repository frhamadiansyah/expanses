import { describe, expect, it } from 'vitest';
import { fundPlaceMatches } from '../src/index';

const names = (typed: string, used: string[], local = true) => fundPlaceMatches(typed, used, local).map((place) => place.name);

describe('fundPlaceMatches', () => {
  it('offers names already used first, then fund apps, brokers and banks', () => {
    expect(names('ma', ['Makmur Jaya'])).toEqual(['Makmur Jaya', 'Makmur', 'Mandiri Sekuritas', 'Bank Mandiri']);
    expect(names('bi', [])[0]).toBe('Bibit');
    expect(names('bca', []).slice(0, 2)).toEqual(['BCA Sekuritas', 'Bank Central Asia']);
  });

  it('offers only the names already used outside a rupiah workspace', () => {
    expect(names('bi', ['Bibit Fund'], false)).toEqual(['Bibit Fund']);
    expect(names('bca', [], false)).toEqual([]);
  });

  it('offers each place once, whatever its case', () => {
    // The app Bibit is offered once, as it was used; the broker known also as Bibit is a firm of its own.
    expect(names('bib', ['bibit'])).toEqual(['bibit', 'Stockbit Sekuritas']);
  });

  it('offers nothing for an empty field or a name already typed in full', () => {
    expect(names('', ['Bibit'])).toEqual([]);
    expect(names('Bibit', [])).toEqual([]);
    expect(names('bank mandiri', [])).toEqual([]);
  });
});
