import { describe, expect, it } from 'vitest';
import { readMoney, readPercent, readWhole } from './fields';

describe('the calculator fields', () => {
  it('reads a percentage either way, and refuses what is half typed, never NaN', () => {
    expect(readPercent('3,5')).toEqual({ ok: true, value: 350 });
    expect(readPercent(' 10 ')).toEqual({ ok: true, value: 1000 });
    expect(readPercent('4.55')).toEqual({ ok: true, value: 455 });
    for (const half of ['', '-', ',', '.', '3,5,', 'abc', '1e', 'Infinity']) expect(readPercent(half).ok, half).toBe(false);
    // Taking away everything, or more, is no rate.
    expect(readPercent('-100')).toMatchObject({ ok: false, problem: expect.stringMatching(/everything/) });
    expect(readPercent('-99,99')).toEqual({ ok: true, value: -9999 });
  });

  it('reads whole years only', () => {
    expect(readWhole('20')).toEqual({ ok: true, value: 20 });
    for (const bad of ['', '20,5', '2.5', '-', 'x']) expect(readWhole(bad).ok, bad).toBe(false);
    expect(readWhole('-1')).toMatchObject({ ok: false });
  });

  it('reads an amount in the workspace money, empty as nothing, and refuses one below nothing', () => {
    expect(readMoney('120.000.000', 'IDR')).toEqual({ ok: true, value: 120_000_000 });
    expect(readMoney('1.200,50', 'USD')).toEqual({ ok: true, value: 120_050 });
    expect(readMoney('', 'IDR')).toEqual({ ok: true, value: 0 });
    expect(readMoney('12,5', 'IDR').ok).toBe(false);
    expect(readMoney('-5', 'IDR')).toMatchObject({ ok: false, problem: expect.stringMatching(/below nothing/) });
    expect(readMoney('abc', 'IDR').ok).toBe(false);
  });
});
