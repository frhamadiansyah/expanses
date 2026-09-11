import { describe, expect, it } from 'vitest';
import { compareTargets } from './recommend-targets';

describe('compareTargets', () => {
  it('lists each card program and every transfer partner program once, sorted', () => {
    expect(
      compareTargets([
        { programName: 'UnionPay Points', transferPartners: [{ program: 'KrisFlyer' }, { program: 'GarudaMiles' }] },
        { programName: 'KrisFlyer', transferPartners: [] },
        { programName: null, transferPartners: [] },
      ]),
    ).toEqual(['GarudaMiles', 'KrisFlyer', 'UnionPay Points']);
    expect(compareTargets([])).toEqual([]);
  });
});
