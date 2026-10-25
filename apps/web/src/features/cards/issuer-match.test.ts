import { describe, expect, it } from 'vitest';
import { issuerMatches } from './issuer-match';

const ISSUERS = ['BCA', 'Bank BNI', 'Bank Danamon', 'blu by BCA Digital', 'CIMB Niaga', 'Danamon', 'Mandiri'];
const names = (typed: string) => issuerMatches(typed, ISSUERS).map((offer) => offer.name);

describe('the banks a card’s Institution row offers', () => {
  it('offers the names holding every word typed, the ones that start with it first, three at most', () => {
    expect(names('dan')).toEqual(['Danamon', 'Bank Danamon']);
    // "BCA" is typed in full already; the longer name that holds it is still offered.
    expect(names('bca')).toEqual(['blu by BCA Digital']);
    expect(names('bank')).toEqual(['Bank BNI', 'Bank Danamon']);
    expect(names('b')).toHaveLength(3);
  });

  it('offers nothing for nothing typed, or for a name already typed in full', () => {
    expect(names('')).toEqual([]);
    expect(names('  ')).toEqual([]);
    expect(names('mandiri')).toEqual([]);
    expect(names('Mandiri Syariah')).toEqual([]);
  });
});
