import { groupedMajorString, parseGroupedMajor } from '@expanses/core';

/** The Extra a month field's text as minor units of the base currency: nothing typed is nothing extra. */
export function extraFromTyped(typed: string, currency: string): number {
  if (typed.trim() === '') return 0;
  let minor: number;
  try {
    minor = parseGroupedMajor(typed, currency);
  } catch {
    throw new Error('The amount must be a number');
  }
  if (minor < 0) throw new Error('The amount must be a number');
  return minor;
}

/** A saved extra as the field shows it, grouped: nothing extra is an empty field. */
export function typedFromExtra(minor: number, currency: string): string {
  return minor > 0 ? groupedMajorString(minor, currency) : '';
}
