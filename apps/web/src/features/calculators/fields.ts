import { parseGroupedMajor } from '@expanses/core';

/**
 * What one box on the Calculators page says: a figure, or the sentence its row shows instead. Nothing here throws, so
 * no half-typed box ("-", ",", "20,5") can take the page down while it renders.
 */
export type Field<T> = { ok: true; value: T } | { ok: false; problem: string };

const refuse = (problem: string): Field<never> => ({ ok: false, problem });

/** "3,5" or "3.5" as whole basis points. A rate that takes away everything (−100% or less) is no rate. */
export function readPercent(typed: string): Field<number> {
  const text = typed.trim().replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return refuse('Type a percentage, like 3,5');
  const bps = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(bps)) return refuse('Type a percentage, like 3,5');
  if (bps <= -10_000) return refuse('A rate cannot take away everything');
  return { ok: true, value: bps };
}

/**
 * Whole years, not below nothing. Given its unit, a box says so in words alone ("Whole months only"); without one it keeps
 * the older calculators' sentence.
 */
export function readWhole(typed: string, unit?: 'years' | 'months'): Field<number> {
  const text = typed.trim();
  const notWhole = unit ? `Whole ${unit} only` : 'Whole years, like 10';
  if (!/^-?\d+$/.test(text)) return refuse(notWhole);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return refuse(notWhole);
  if (value < 0) return refuse('Not below nothing');
  return { ok: true, value };
}

/** An amount in the workspace's money, by `parseGroupedMajor` (the text of an amount box grouped as it is typed); an empty box is nothing. */
export function readMoney(typed: string, currency: string): Field<number> {
  if (typed.trim() === '') return { ok: true, value: 0 };
  let value: number;
  try {
    value = parseGroupedMajor(typed, currency);
  } catch {
    return refuse(`Not an amount in ${currency}`);
  }
  if (!Number.isSafeInteger(value)) return refuse('Too large to work out');
  if (value < 0) return refuse('Not below nothing');
  return { ok: true, value };
}
