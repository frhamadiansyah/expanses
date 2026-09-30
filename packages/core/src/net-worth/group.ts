/**
 * The net-worth group and its filing mode (spec §6). State is derived, never stored: every device
 * replays the same `Proposal` and `Answer` log and arrives at the same `GroupState`.
 */
export type FilingMode = 'joint' | 'separate';

export interface Proposal {
  proposalId: string;
  mode: FilingMode;
  members: string[];
  proposedBy: string;
  createdHlc: string;
  cancelled: boolean;
}

export interface Answer {
  proposalId: string;
  memberId: string;
  answer: 'confirm' | 'decline' | 'left';
}

export interface GroupState {
  active: { proposalId: string; mode: FilingMode; members: string[] } | null;
  pending: Proposal | null;
  waitingFor: string[];
}

/** `joint` needs exactly two distinct members; any mode needs at least two distinct members. */
export function canPropose(mode: FilingMode, members: readonly string[]): boolean {
  const distinct = new Set(members).size;
  if (distinct !== members.length) return false;
  if (distinct < 2) return false;
  if (mode === 'joint' && distinct !== 2) return false;
  return true;
}

/** The final answer recorded for each (proposalId, memberId) pair — last writer wins. */
function finalAnswers(answers: readonly Answer[]): Map<string, Answer> {
  const byKey = new Map<string, Answer>();
  for (const ans of answers) byKey.set(`${ans.proposalId}\u0000${ans.memberId}`, ans);
  return byKey;
}

function answerFor(final: Map<string, Answer>, proposalId: string, memberId: string): Answer['answer'] | undefined {
  return final.get(`${proposalId}\u0000${memberId}`)?.answer;
}

/** Proposals in creation order: HLC, then id, so equal clocks still order alike on every device. */
function inOrder(proposals: readonly Proposal[]): Proposal[] {
  return [...proposals].sort((a, b) =>
    a.createdHlc < b.createdHlc ? -1 : a.createdHlc > b.createdHlc ? 1 : a.proposalId < b.proposalId ? -1 : a.proposalId > b.proposalId ? 1 : 0,
  );
}

/** The active proposal's current members: its listed members who have not left it. */
function currentMembers(active: Proposal | null, final: Map<string, Answer>): string[] {
  return active ? active.members.filter((member) => answerFor(final, active.proposalId, member) !== 'left') : [];
}

/**
 * Who must say yes to a proposal while `active` is the group (D6, task 5 review round 2): its listed members, and every
 * current member of the active group it leaves out — a change can never drop someone without them.
 */
function requiredOf(proposal: Proposal, current: readonly string[]): { listed: string[]; unlisted: string[] } {
  return { listed: proposal.members, unlisted: current.filter((member) => !proposal.members.includes(member)) };
}

/**
 * Whether a change lists someone outside the active group (wave 3 round 2). Such a change never activates and is never
 * pending: the group log holds every summary ever sent and hands a new member every epoch key, so adding someone would
 * show them the group's history. Adding someone is a fresh setup — the group ends and is set up again, in a new log.
 */
export function addsMembers(proposal: Pick<Proposal, 'members'>, current: readonly string[]): boolean {
  return proposal.members.some((member) => !current.includes(member));
}

/**
 * Whether `proposal` activates while `current` are the active group's members (null: no group has been active in this
 * log): it lists nobody outside the group, not cancelled, `canPropose`, every listed
 * member confirmed or left, and every current member it leaves out confirmed.
 */
function activatesWith(proposal: Proposal, final: Map<string, Answer>, current: readonly string[] | null): boolean {
  if (proposal.cancelled) return false;
  if (!canPropose(proposal.mode, proposal.members)) return false;
  if (current !== null && addsMembers(proposal, current)) return false;
  current ??= [];
  const { listed, unlisted } = requiredOf(proposal, current);
  return (
    listed.every((member) => {
      const ans = answerFor(final, proposal.proposalId, member);
      return ans === 'confirm' || ans === 'left';
    }) && unlisted.every((member) => answerFor(final, proposal.proposalId, member) === 'confirm')
  );
}

/**
 * The replay every device makes: in creation order, each proposal that activates against the group active before it
 * becomes the group. Returns every proposal that ever became the group, and the last.
 */
function replay(proposals: readonly Proposal[], final: Map<string, Answer>): { activated: Set<string>; active: Proposal | null } {
  const activated = new Set<string>();
  let active: Proposal | null = null;
  for (const proposal of inOrder(proposals)) {
    if (activatesWith(proposal, final, active ? currentMembers(active, final) : null)) {
      active = proposal;
      activated.add(proposal.proposalId);
    }
  }
  return { activated, active };
}

/**
 * Whether a proposal ever became the group, replaying all of them (the last answer per member wins). Once so, only
 * `left` may follow it (task 2 review).
 */
export function isActivated(proposal: Proposal, proposals: readonly Proposal[], answers: readonly Answer[]): boolean {
  const all = proposals.some((p) => p.proposalId === proposal.proposalId) ? proposals : [...proposals, proposal];
  return replay(all, finalAnswers(answers)).activated.has(proposal.proposalId);
}

export function deriveGroup(proposals: readonly Proposal[], answers: readonly Answer[]): GroupState {
  const final = finalAnswers(answers);
  const { activated, active } = replay(proposals, final);
  const current = currentMembers(active, final);

  let activeState: GroupState['active'] = null;
  if (active && current.length >= 2) activeState = { proposalId: active.proposalId, mode: active.mode, members: current };

  const activeHlc = active?.createdHlc ?? null;
  let pending: Proposal | null = null;
  for (const proposal of inOrder(proposals)) {
    if (proposal.cancelled) continue;
    if (activeHlc !== null && !(proposal.createdHlc > activeHlc)) continue;
    if (activated.has(proposal.proposalId)) continue;
    if (active && addsMembers(proposal, current)) continue; // it can never activate (wave 3 round 2)
    const { listed, unlisted } = requiredOf(proposal, current);
    const declined = [...listed, ...unlisted].some((member) => answerFor(final, proposal.proposalId, member) === 'decline');
    if (declined) continue;
    pending = proposal; // in creation order: the last one standing is the newest
  }

  const waitingFor = pending
    ? (() => {
        const { listed, unlisted } = requiredOf(pending, current);
        return [...listed, ...unlisted].filter((member) => answerFor(final, pending!.proposalId, member) === undefined);
      })()
    : [];

  return { active: activeState, pending, waitingFor };
}
