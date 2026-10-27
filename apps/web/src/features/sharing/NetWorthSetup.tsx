import { setShareSetting, type SharedMemberDetail } from '@expanses/db';
import { Check } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SubmitRow } from '../../ui/native';
import { clearDraft, draftKey, setDraft, useDraft } from './net-worth-draft';
import { hiddenIds, sharedCount, sharedValue } from './net-worth-items';
import { useReview } from './net-worth-queries';
import { ADD_SOMEONE_LINE, canInvite, FILING_CHOICES, FILING_QUESTION, type FilingMode, inviteesFor, sayNetWorthError, toggleInvitee } from './net-worth-state';
import { sayError } from './sharing-copy';

/*
 * Share net worth (joint-net-worth spec §6 Setup, §8.1): how the household files tax, who joins (asked only when there
 * is more than one other member), what is shared, then Invite. Also the way to change the mode or the members of an
 * active group, which is a new proposal (§6 Change). A member whose device runs an old app blocks it: "Update the app on
 * Andi's iPad".
 *
 * The answers live in a draft outside this screen, so the Shared list (a page of its own) and this page agree. What the
 * list switched off is written as the items' `hidden` setting once the proposal is sent; the review that follows an
 * activation starts from it.
 */

const MODES: FilingMode[] = ['joint', 'separate'];

const FILING_INFO =
  "One tax ID: the yearly return lists both members, so Net worth and the tax report are the household's. Separate: each keeps their own; what the other shares is visible but not counted.";

export function NetWorthSetup({
  bookId,
  members,
  change = false,
  activeMembers = null,
  onDone,
}: {
  bookId: string;
  members: readonly SharedMemberDetail[];
  /** A change of an active group: its draft was seeded with the active mode and members, and the Shared list is not part of it. */
  change?: boolean;
  /** A Change of an active group: only its members may be picked (a Change never adds anyone). Null for a first setup. */
  activeMembers?: readonly string[] | null;
  onDone: () => void;
}) {
  const { sync, database } = useApp();
  const key = draftKey(bookId, change ? 'change' : 'new');
  const draft = useDraft(key);
  const review = useReview();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const others = inviteesFor(members.filter((member) => !member.me), activeMembers);
  const mode = draft.mode;
  // With one other member there is nobody to pick.
  const chosen = others.length === 1 ? [others[0]!.memberId] : draft.chosen;
  const items = review.data?.items ?? [];
  const hidden = new Set(draft.hidden ?? hiddenIds(items));
  const whoInfo = activeMembers === null ? 'They confirm on their own phone. Nothing is shared until they do and every member has reviewed their items.' : `They confirm on their own phone. ${ADD_SOMEONE_LINE}`;

  function pickMode(next: FilingMode) {
    // One tax ID is for two: a longer list from "each their own" keeps only its first.
    setDraft(key, { mode: next, chosen: next === 'joint' && draft.chosen.length > 1 ? draft.chosen.slice(0, 1) : draft.chosen });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode || !canInvite(chosen, mode) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sync.proposeNetWorth(bookId, { mode, members: chosen });
      // What the list switched off stays private: with one tax ID every item is shared, so nothing is kept.
      if (!change && mode === 'separate') for (const id of draft.hidden ?? []) await setShareSetting(database, id, 'hidden');
      clearDraft(key);
      onDone();
    } catch (failure) {
      setError(sayError(sayNetWorthError(failure)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Share net worth" data-testid="net-worth-setup">
      <ErrorBox error={error} />
      <InsetGroup wide header={FILING_QUESTION} info={FILING_INFO}>
        {MODES.map((option) => (
          <InsetRow
            key={option}
            testId={`filing-${option}`}
            title={FILING_CHOICES[option]}
            value={mode === option ? <Check size={17} aria-label="Chosen" className="text-[var(--ph-tint)]" /> : null}
            chevron={false}
            onClick={() => pickMode(option)}
          />
        ))}
      </InsetGroup>
      {others.length > 1 ? (
        <InsetGroup wide header="Who joins" info={whoInfo}>
          {others.map((member) => (
            <InsetRow
              key={member.memberId}
              testId="net-worth-invitee"
              title={member.name}
              value={chosen.includes(member.memberId) ? <Check size={17} aria-label="Chosen" className="text-[var(--ph-tint)]" /> : null}
              chevron={false}
              onClick={() => setDraft(key, { chosen: toggleInvitee(chosen, member.memberId, mode ?? 'separate') })}
            />
          ))}
        </InsetGroup>
      ) : null}
      {!change ? (
        <InsetGroup wide>
          <InsetRow
            testId="networth-shared-row"
            title="Shared"
            value={review.data ? sharedValue(mode === 'joint' ? items.length : sharedCount(items, hidden), items.length) : undefined}
            to="/account/workspaces/$bookId/share/net-worth/items"
            params={{ bookId }}
          />
        </InsetGroup>
      ) : null}
      <InsetGroup wide>
        <SubmitRow testId="share-net-worth" label={busy ? 'Sending…' : 'Invite'} disabled={busy || !canInvite(chosen, mode)} />
      </InsetGroup>
      {change ? (
        <InsetGroup wide>
          <InsetRow
            title="Not now"
            action
            onClick={() => {
              clearDraft(key);
              onDone();
            }}
          />
        </InsetGroup>
      ) : null}
    </form>
  );
}
