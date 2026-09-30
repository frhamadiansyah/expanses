import type { SharedMemberDetail } from '@expanses/db';
import { Check } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SubmitRow } from '../../ui/native';
import { ADD_SOMEONE_LINE, canInvite, FILING_CHOICES, FILING_QUESTION, type FilingMode, inviteesFor, sayNetWorthError, toggleInvitee } from './net-worth-state';
import { sayError } from './sharing-copy';

/*
 * Share net worth (joint-net-worth spec §6 Setup, §8.1): how the household files tax, then who to invite — one other for
 * one tax ID, one or more when each has their own. Also the way to change the mode or the members of an active group,
 * which is a new proposal (§6 Change). A member whose device runs an old app blocks it: "Update the app on Andi's iPad".
 */

const MODES: FilingMode[] = ['joint', 'separate'];

export function NetWorthSetup({
  bookId,
  members,
  initial,
  activeMembers = null,
  onDone,
}: {
  bookId: string;
  members: readonly SharedMemberDetail[];
  /** Where a change of filing starts from: the active mode and its other members. */
  initial?: { mode: FilingMode; members: string[] };
  /** A Change of an active group: only its members may be picked (a Change never adds anyone). Null for a first setup. */
  activeMembers?: readonly string[] | null;
  onDone: () => void;
}) {
  const { sync } = useApp();
  const [mode, setMode] = useState<FilingMode | null>(initial?.mode ?? null);
  const [chosen, setChosen] = useState<string[]>(initial?.members ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const others = inviteesFor(members.filter((member) => !member.me), activeMembers);
  const whoFooter =
    activeMembers === null
      ? 'They confirm on their own phone. Nothing is shared until they do and each of you has reviewed your items.'
      : `They confirm on their own phone. ${ADD_SOMEONE_LINE}`;

  function pickMode(next: FilingMode) {
    setMode(next);
    // One tax ID is for two: a longer list from "each their own" keeps only its first.
    if (next === 'joint' && chosen.length > 1) setChosen(chosen.slice(0, 1));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode || !canInvite(chosen, mode) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sync.proposeNetWorth(bookId, { mode, members: chosen });
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
      <InsetGroup wide header={FILING_QUESTION} footer="One tax ID: the yearly return lists both of you, so Net worth and the tax report are the household's. Separate: each keeps their own; what the other shares is visible but not counted.">
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
      {mode ? (
        <InsetGroup wide header={mode === 'joint' ? 'Who files with you' : 'Who to invite'} footer={whoFooter}>
          {others.map((member) => (
            <InsetRow
              key={member.memberId}
              testId="net-worth-invitee"
              title={member.name}
              value={chosen.includes(member.memberId) ? <Check size={17} aria-label="Chosen" className="text-[var(--ph-tint)]" /> : null}
              chevron={false}
              onClick={() => setChosen((was) => toggleInvitee(was, member.memberId, mode))}
            />
          ))}
          <SubmitRow label={busy ? 'Sending…' : 'Invite'} disabled={busy || !canInvite(chosen, mode)} />
        </InsetGroup>
      ) : null}
      <InsetGroup wide>
        <InsetRow title="Not now" chevron={false} onClick={onDone} />
      </InsetGroup>
    </form>
  );
}
