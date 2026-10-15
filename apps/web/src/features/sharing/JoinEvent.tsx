import { ownerScope, type PreviewedInvite } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SubmitRow, TextRow } from '../../ui/native';
import { eventDates } from '../events/EventsPage';
import { joinChoices } from './join-event';
import { thisDeviceName } from './SharingSection';

/**
 * "Join Coast week" (shared events §6): the event, who invited, and who is joining — a name nobody has claimed ("I'm
 * Budi") or a new one. A same-person invite (a new phone) joins as that person, with nothing to choose.
 */
export function JoinEvent({ code, preview }: { code: string; preview: PreviewedInvite }) {
  const event = preview.event!;
  const { ws, sync } = useApp();
  const navigate = useNavigate();
  const choices = joinChoices(event);
  const same = preview.terms.sameMember;
  const [choice, setChoice] = useState(choices[0]!.key);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const picked = choices.find((c) => c.key === choice)!;
  const unusable = preview.claimed ? 'Someone has already used this invite. Ask for a new one.' : preview.expired ? 'This invite has expired. Ask for a new one.' : null;

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const joiningAs = same ? (preview.memberName ?? '') : picked.personId ? picked.name : name.trim();
      const { eventId } = await sync.joinEvent(code, { ws: ownerScope(ws), personId: same ? null : picked.personId, name: joiningAs, deviceName: thisDeviceName() });
      await navigate({ to: '/events/$eventId', params: { eventId } });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label={`Join ${event.name}`} onSubmit={(e) => void join(e)} data-testid="join-event">
      <ErrorBox error={error} />
      <InsetGroup wide header={`Join ${event.name}`} footer={unusable ?? 'Everyone in it sees every expense, who paid and how it is split.'}>
        <ReadOnlyRow label="Dates" value={eventDates(event)} />
        <ReadOnlyRow label="Currency" value={event.currency} />
        <ReadOnlyRow label="Invited by" value={preview.inviterName} />
      </InsetGroup>
      {unusable ? null : (
        <InsetGroup wide header={same ? undefined : 'Joining as'}>
          {same ? (
            <ReadOnlyRow label="Joining as" value={preview.memberName ?? ''} />
          ) : (
            choices.map((c) => <InsetRow key={c.key} title={c.label} value={choice === c.key ? '✓' : undefined} onClick={() => setChoice(c.key)} label={c.label} testId="join-choice" />)
          )}
          {!same && picked.personId === null ? <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As the others will see it" /> : null}
          <SubmitRow label={busy ? 'Joining…' : 'Join'} disabled={busy || (!same && picked.personId === null && !name.trim())} />
        </InsetGroup>
      )}
    </form>
  );
}
