import { goalClass, type GoalKind } from '@expanses/core';

/**
 * The goal ids in their new order after one Move up or Move down, or null when the move is refused.
 *
 * `ordered` is the page's order (`fundingOrder`). A move never crosses a section: an emergency fund cannot be
 * ranked below a holiday it is funded before, and a holiday cannot be lifted above it.
 */
export function movedOrder(ordered: readonly { goalId: string; kind: GoalKind }[], goalId: string, by: number): string[] | null {
  const order = ordered.map((item) => item.goalId);
  const from = order.indexOf(goalId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return null;
  if (goalClass(ordered[from]!.kind) !== goalClass(ordered[to]!.kind)) return null;
  order.splice(to, 0, ...order.splice(from, 1));
  return order;
}
