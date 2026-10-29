/**
 * The Funding sheet's purchases: which buys the goal's form holds as tagged, what saving changes, and how the changes are
 * applied once the goal exists. Pure, so the decisions are tested apart from the sheet that draws them.
 */

/** What is tagged: the buys the goal already had, plus those added in the sheet, less those taken away. */
export function taggedIds(original: readonly string[], added: readonly string[], removed: readonly string[]): string[] {
  const gone = new Set(removed);
  return [...new Set([...original, ...added])].filter((id) => !gone.has(id));
}

/** What saving writes: the buys newly tagged to the goal, and those the goal let go of. */
export function tagChanges(original: readonly string[], tagged: readonly string[]): { tag: string[]; untag: string[] } {
  const had = new Set(original);
  const has = new Set(tagged);
  return { tag: tagged.filter((id) => !had.has(id)), untag: original.filter((id) => !has.has(id)) };
}

/**
 * Applies the changes to a goal that exists, one buy at a time through `retag` (the app's own `retagTrade`). A buy that
 * is refused does not stop the rest: it is returned with the reason, so the form can say which and keep only those.
 */
export async function applyTagChanges(
  retag: (tradeId: string, goalId: string | null) => Promise<void>,
  goalId: string,
  changes: { tag: readonly string[]; untag: readonly string[] },
): Promise<{ failed: { tradeId: string; message: string }[] }> {
  const failed: { tradeId: string; message: string }[] = [];
  const run = async (tradeId: string, to: string | null) => {
    try {
      await retag(tradeId, to);
    } catch (e) {
      failed.push({ tradeId, message: e instanceof Error ? e.message : String(e) });
    }
  };
  for (const tradeId of changes.untag) await run(tradeId, null);
  for (const tradeId of changes.tag) await run(tradeId, goalId);
  return { failed };
}

/** The Funding row's answer: "None", "Rp 5.000.000", "1 purchase", or "Rp 5.000.000 + 1 purchase". */
export function fundingSummary(setAside: string, purchases: number): string {
  const bought = purchases === 0 ? '' : `${purchases} ${purchases === 1 ? 'purchase' : 'purchases'}`;
  if (bought === '') return setAside;
  return setAside === 'None' ? bought : `${setAside} + ${bought}`;
}
