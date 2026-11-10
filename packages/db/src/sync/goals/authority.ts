/*
 * Who may write a shared goal's rows (shared goals §8.4; D6, D10, C3). One pure predicate in the shape of
 * `events/authority.ts`: the row as it stood, the row as it would be, the key, the writing member and the goal's link
 * as applied in log order, so a phone's own write and a peer's op are judged alike on every phone.
 *
 * - `goal_share`: inserted only 'on', round 1, naming its writer. Every later write is the sharer's. The sharer never
 *   changes; the round rises by one, and only on 'off' to 'on'. Nothing leaves 'deleted'. A link is never deleted.
 * - `goal_share_leave`: written by the member it names, never the sharer, for the link's current round only.
 * - `goal.status` is the sharer's alone (D10); a goal is never deleted by op, it ends by its link.
 * - Stages, terms and calculators are anyone's, deletes included.
 */

export interface GoalLinkView {
  sharedBy: string;
  state: 'on' | 'off' | 'deleted';
  round: number;
}

export const GOAL_SHARE_ENTITIES: ReadonlySet<string> = new Set(['goal_share', 'goal_share_leave', 'goal', 'goal_stage', 'goal_stage_term', 'goal_calculator']);

/** Why this write is refused (the text after "AUTHORITY: "), or null. */
export function goalWriteRefusal(
  entity: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  key: Record<string, string>,
  member: string | null,
  link: GoalLinkView | null,
): string | null {
  if (!GOAL_SHARE_ENTITIES.has(entity)) return null;
  if (entity === 'goal_share') {
    if (after === null) return 'a share is turned off, never deleted';
    if (before === null) {
      return member !== null && after.sharedBy === member && after.state === 'on' && after.round === 1 ? null : 'a goal is shared by its sharer';
    }
    if (before.state === 'deleted') return 'a deleted goal stays deleted';
    if (member !== before.sharedBy) return 'only the sharer changes the share';
    if (after.sharedBy !== before.sharedBy) return 'the sharer never changes';
    const again = before.state === 'off' && after.state === 'on';
    const round = Number(before.round);
    if (after.round !== (again ? round + 1 : round)) return 'turning it on again starts a new round';
    return null;
  }
  if (entity === 'goal_share_leave') {
    if (after === null) return 'a leave is never deleted';
    if (member === null || key.member_id !== member) return 'each member leaves only for themselves';
    if (link !== null && key.member_id === link.sharedBy) return 'the sharer turns it off instead';
    if (link === null || after.round !== link.round) return 'a leave names the current round';
    return null;
  }
  if (entity === 'goal') {
    if (after === null) return 'a shared goal ends by its link';
    // Without a link there is nobody to compare with; scope keeps such a row from reaching here.
    if (before !== null && link !== null && before.status !== after.status && member !== link.sharedBy) return 'only the sharer archives';
  }
  return null;
}
