import { GraduationCap, ShieldCheck, Sunset, Umbrella, type LucideIcon } from 'lucide-react';

/**
 * The four calculators, and the one sentence that says what each answers.
 *
 * The list is read twice: the catalogue draws a row from an entry, and the calculator's own page takes its title
 * and subtitle from the same entry — so the line a person chose it by is the line they land on, and the two can
 * never drift apart. The blurbs are the sentences the calculators already carried as group footers.
 */
export interface CalculatorEntry {
  to: string;
  icon: LucideIcon;
  label: string;
  blurb: string;
}

export const EMERGENCY_FUND: CalculatorEntry = {
  to: '/calculators/emergency',
  icon: Umbrella,
  label: 'Emergency fund',
  blurb: 'Months of outgoings, loan principal included.',
};

export const EDUCATION_FUND: CalculatorEntry = {
  to: '/calculators/education',
  icon: GraduationCap,
  label: 'Education fund',
  blurb: "Each year at today's prices, raised to the year it is paid.",
};

export const RETIREMENT_FUND: CalculatorEntry = {
  to: '/calculators/retirement',
  icon: Sunset,
  label: 'Retirement fund',
  blurb: 'What the pot must hold the day you stop, drawn down while it earns.',
};

export const LIFE_COVER: CalculatorEntry = {
  to: '/calculators/life-cover',
  icon: ShieldCheck,
  label: 'Life cover',
  blurb: 'What your family would need, minus what is already there.',
};

export const CATALOGUE: readonly CalculatorEntry[] = [EMERGENCY_FUND, EDUCATION_FUND, RETIREMENT_FUND, LIFE_COVER];
