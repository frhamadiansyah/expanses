/*
 * Who may write a shared event's rows (shared events spec §3, D8; rulings R1–R3, R11). One pure predicate, read from
 * the row as it stood, the row as it would be, the key and the writing member — never another row — so this phone's
 * own write (judged at capture, against its pre-image) and a peer's op (judged on apply, against the stored row and the
 * authority view's member) are decided alike on every phone.
 *
 * - An expense's money (`event_expense`) is its payer's member's alone when the payer paid from an account in the app
 *   (`payerMemberId` set); anyone's when it was paid outside the app. Its details (`event_expense_detail`: split,
 *   category, note) are anyone's — which is why the two are separate entities under one key, and why no money travels
 *   in the detail (Review Focus 5).
 * - A settlement is either side's member's; anyone's when neither side has the app.
 * - `memberId` on a person, `payerMemberId` on an expense and `fromMemberId`/`toMemberId` on a settlement are set once,
 *   from null, by the member they name, who must be that row's person (a claim, a takeover); never moved after. Who
 *   paid an expense is fixed once its payer's member is; who paid whom in a settlement is always fixed.
 * - A void stays a void; records are voided or removed, never deleted; categories and plan items may be deleted.
 */

export const EVENT_ENTITIES: ReadonlySet<string> = new Set(['shared_event', 'event_person', 'event_category', 'event_expense', 'event_expense_detail', 'event_settlement', 'event_item']);

const NEVER_DELETED: ReadonlySet<string> = new Set(['shared_event', 'event_person', 'event_expense', 'event_expense_detail', 'event_settlement']);

interface ClaimedField {
  field: string;
  /** The person the field may only ever name. */
  person: (key: Record<string, string>, row: Record<string, unknown>) => unknown;
}

const CLAIMED: Readonly<Record<string, readonly ClaimedField[]>> = {
  event_person: [{ field: 'memberId', person: (key) => key.id }],
  event_expense: [{ field: 'payerMemberId', person: (_key, row) => row.payerPersonId }],
  event_settlement: [
    { field: 'fromMemberId', person: (_key, row) => row.fromPersonId },
    { field: 'toMemberId', person: (_key, row) => row.toPersonId },
  ],
};

const named = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The members a record's money belongs to; empty when it is anyone's. */
function writersOf(entity: string, row: Record<string, unknown>): string[] {
  if (entity === 'event_expense') return named(row.payerMemberId) ? [row.payerMemberId] : [];
  if (entity === 'event_settlement') return [row.fromMemberId, row.toMemberId].filter(named);
  return [];
}

const changedFields = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  Object.keys(after).filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));

/** Why this write is refused (the text after "AUTHORITY: "), or null. */
export function eventWriteRefusal(
  entity: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  key: Record<string, string>,
  member: string | null,
): string | null {
  if (!EVENT_ENTITIES.has(entity)) return null;
  if (after === null) return before !== null && NEVER_DELETED.has(entity) ? 'a record is voided or removed, never deleted' : null;
  const claims = CLAIMED[entity] ?? [];
  // A takeover changes nothing but a claimed field going from null to the member it names (R6): the other side of a
  // settlement already being a member's does not stand in its way.
  const takeover =
    before !== null &&
    changedFields(before, after).length > 0 &&
    changedFields(before, after).every((field) => claims.some((c) => c.field === field && !named(before[field]) && after[field] === member && member === c.person(key, after)));
  const writers = writersOf(entity, before ?? after);
  if (writers.length > 0 && !(member !== null && writers.includes(member)) && !takeover) return 'only the person whose money it is changes it';
  for (const { field, person } of claims) {
    const was = before?.[field] ?? null;
    const now = after[field] ?? null;
    if (named(was)) {
      if (now !== was) return `${field} is set once`;
      continue;
    }
    if (now === null) continue;
    // It names only the row's own person. Set on a row that exists it is a claim or a takeover, made only by the member
    // it names; on a new record the writer rule above already judged who records it (a settlement names both sides'
    // members at once) — except a person, whom only the member it is makes as a member.
    const byItself = before !== null || entity === 'event_person';
    if (!named(now) || now !== person(key, after) || (byItself && now !== member)) return `${field} is set only by the person it names`;
  }
  if (before !== null) {
    if (entity === 'event_expense' && named(before.payerMemberId) && after.payerPersonId !== before.payerPersonId) return 'who paid is fixed';
    if (entity === 'event_settlement' && (after.fromPersonId !== before.fromPersonId || after.toPersonId !== before.toPersonId)) return 'who paid whom is fixed';
    if (named(before.voidedAt) && !named(after.voidedAt)) return 'a void stays a void';
  }
  return null;
}
