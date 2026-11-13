/**
 * Tag a purchase, several at once: which of a holding's buys are ticked, and which of those would leave another goal.
 * Pure, so the decisions are tested apart from the sheet that draws them.
 */

/** Ticks a buy, or unticks it if it was ticked. */
export function toggleOne(ticked: readonly string[], id: string): string[] {
  return ticked.includes(id) ? ticked.filter((row) => row !== id) : [...ticked, id];
}

/** Every buy in `all` ticked? False for an empty list, so "Select all" never reads as on with nothing to select. */
export function allTicked(all: readonly string[], ticked: readonly string[]): boolean {
  return all.length > 0 && all.every((id) => ticked.includes(id));
}

/** "Select all": every buy ticked, or — when all already were — none. */
export function toggleAll(all: readonly string[], ticked: readonly string[]): string[] {
  return allTicked(all, ticked) ? [] : [...all];
}

/** The part of a buy the confirm needs: what goal it serves now. */
export interface Servable {
  id: string;
  goalId?: string | null;
  goalParts?: readonly unknown[] | null;
}

/**
 * The ticked buys that serve some other goal than `goalId`, and the goals they leave (each named once, in the order met).
 * A buy split across goals counts and is named "Several goals". Count 0 means nothing needs asking.
 */
export function askAboutMoves(buys: readonly Servable[], ticked: readonly string[], goalId: string | undefined, nameOf: (goalId: string | null) => string): { count: number; goals: string[] } {
  const goals: string[] = [];
  let count = 0;
  for (const buy of buys) {
    if (!ticked.includes(buy.id)) continue;
    const split = Boolean(buy.goalParts?.length);
    if (!split && (buy.goalId == null || buy.goalId === goalId)) continue;
    count += 1;
    const name = split ? 'Several goals' : nameOf(buy.goalId ?? null);
    if (!goals.includes(name)) goals.push(name);
  }
  return { count, goals };
}
