import { parseMajor } from '@expanses/core';

/**
 * Whether a write to a sell's amount still means All. Leaving the amount row tidies its text — a desktop field on
 * blur, the phone's keypad on DONE — and "1.234.567" comes back as "1234567": the same figure, written again. That
 * is not a change, so it must not turn All off; All then goes on selling exactly what is held rather than units
 * worked back from the amount (fix round 1). Any other figure, or an empty one, is a real change and ends All.
 */
export function keepsAll(all: boolean, typed: string, allMinor: number | null, currency: string): boolean {
  if (!all || allMinor === null || typed.trim() === '') return false;
  try {
    return parseMajor(typed, currency) === allMinor;
  } catch {
    return false;
  }
}
