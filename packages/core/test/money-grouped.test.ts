import { describe, expect, it } from 'vitest';
import { groupedMajorString, groupTypedAmount, minorToMajorString, parseGroupedMajor } from '../src';

describe('groupedMajorString', () => {
  it('groups a currency without cents', () => {
    expect(groupedMajorString(25000000, 'IDR')).toBe('25.000.000');
    expect(groupedMajorString(0, 'IDR')).toBe('0');
    expect(groupedMajorString(950, 'JPY')).toBe('950');
  });
  it('groups a currency with cents, comma before the cents', () => {
    expect(groupedMajorString(123456, 'USD')).toBe('1.234,56');
    expect(groupedMajorString(100, 'USD')).toBe('1,00');
    expect(groupedMajorString(5, 'USD')).toBe('0,05');
  });
  it('groups a three-decimal currency', () => {
    expect(groupedMajorString(1234567, 'KWD')).toBe('1.234,567');
  });
});

describe('parseGroupedMajor', () => {
  it('reads dots as thousands for a currency without cents', () => {
    expect(parseGroupedMajor('25.000.000', 'IDR')).toBe(25000000);
    expect(parseGroupedMajor('1.000', 'IDR')).toBe(1000);
    expect(parseGroupedMajor('500', 'IDR')).toBe(500);
  });
  it('reads a comma as the decimal mark for a currency with cents', () => {
    expect(parseGroupedMajor('1.234,56', 'USD')).toBe(123456);
    expect(parseGroupedMajor('12,5', 'USD')).toBe(1250);
    expect(parseGroupedMajor('1.234', 'USD')).toBe(123400);
    expect(parseGroupedMajor('0,05', 'EUR')).toBe(5);
  });
  it('does not read a thousands group as the decimals of a three-decimal currency', () => {
    expect(parseGroupedMajor('1.234', 'KWD')).toBe(1234000);
    expect(parseGroupedMajor('1.234,567', 'KWD')).toBe(1234567);
    expect(parseGroupedMajor('12,5', 'KWD')).toBe(12500);
  });
  it('round-trips every stored figure through the field text', () => {
    for (const [minor, currency] of [[0, 'IDR'], [1, 'IDR'], [999999999999, 'IDR'], [1, 'USD'], [100, 'USD'], [123456789, 'USD'], [1234, 'KWD'], [1000, 'KWD'], [7, 'KWD'], [250000, 'JPY']] as const) {
      expect(parseGroupedMajor(groupedMajorString(minor, currency), currency)).toBe(minor);
    }
  });
  it('reads whatever groupTypedAmount makes of a typed figure', () => {
    expect(parseGroupedMajor(groupTypedAmount('25000000', 'IDR'), 'IDR')).toBe(25000000);
    expect(parseGroupedMajor(groupTypedAmount('1234,5', 'USD'), 'USD')).toBe(123450);
    expect(parseGroupedMajor(groupTypedAmount('1234', 'KWD'), 'KWD')).toBe(1234000);
  });
  it('keeps a minus sign for the caller to refuse', () => {
    expect(parseGroupedMajor('-1.500', 'IDR')).toBe(-1500);
    expect(parseGroupedMajor('-12,5', 'USD')).toBe(-1250);
  });
  it('rejects text that is not an amount', () => {
    expect(() => parseGroupedMajor('', 'IDR')).toThrow();
    expect(() => parseGroupedMajor('abc', 'IDR')).toThrow();
    expect(() => parseGroupedMajor('1,2,3', 'USD')).toThrow();
    expect(() => parseGroupedMajor('10,5', 'IDR')).toThrow();
  });
  it('agrees with the plain stored string', () => {
    expect(minorToMajorString(123456, 'USD')).toBe('1234.56');
  });
});
