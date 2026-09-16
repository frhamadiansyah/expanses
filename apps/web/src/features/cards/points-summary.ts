import { formatPoints } from './useCardPoints';

/**
 * The line under a points balance. What is estimated is usually just this cycle's points, so it is said once,
 * as this cycle's; only when older points are still waiting to post does the estimated total need its own mention.
 */
export function pointsSummary(posted: number, estimated: number, thisCycle: number | null): string {
  const parts = [`${formatPoints(posted)} posted`];
  if (thisCycle === null) {
    parts.push(`${formatPoints(estimated)} estimated`);
    return parts.join(' · ');
  }
  if (estimated !== thisCycle) parts.push(`${formatPoints(estimated)} estimated`);
  parts.push(`+${formatPoints(thisCycle)} this cycle`);
  return parts.join(' · ');
}
