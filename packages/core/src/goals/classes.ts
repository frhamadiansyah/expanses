import type { GoalKind } from './plan';

export type GoalClass = 'compulsory' | 'additional';

/** Every household has these two. Education assumes children and hajj a faith, so both are additional. */
export const COMPULSORY_KINDS: readonly GoalKind[] = ['emergency', 'retirement'];

export function goalClass(kind: GoalKind): GoalClass {
  return COMPULSORY_KINDS.includes(kind) ? 'compulsory' : 'additional';
}

/** The order money reaches goals in: compulsory first, then additional, each in its own rank order. */
export function fundingOrder<T extends { kind: GoalKind; rank: number }>(goals: readonly T[]): T[] {
  const weight = (goal: T) => (goalClass(goal.kind) === 'compulsory' ? 0 : 1);
  return [...goals].sort((a, b) => weight(a) - weight(b) || a.rank - b.rank);
}
