import { addEventPerson, type CreatedInvite, ownerScope, type SharedPersonView } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from '../sharing/InviteCard';
import { useSharedEventView } from './shared-queries';
import { balanceLine } from './shared-view';

/**
 * Who is in a shared event (shared events §6): those with the app and the names without it. An invite link for someone
 * new, a name added for someone without the app, a person's new phone, and removing a person at zero and in no record.
 */
export function PeoplePage() {
  const { eventId } = useParams({ from: '/events/$eventId/people' });
  const { database, ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const view = useSharedEventView(eventId).data;
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ invite: CreatedInvite; header: string } | null>(null);
  const [chosen, setChosen] = useState<SharedPersonView | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!view) return null;
  const live = view.people.filter((p) => !p.removed);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (failure) {
      setError(failure);
    }
  }

  async function addName(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await addEventPerson(database, ownerScope(ws), eventId, name);
      setName('');
    });
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="People" back={view.name} backTo="/events/$eventId" backParams={{ eventId }} />
      <ErrorBox error={error} />
      <InsetGroup header="With the app">
        {live.filter((p) => p.hasApp).map((p) => (
          <InsetRow key={p.personId} title={p.isMe ? `${p.name} (this phone)` : p.name} subtitle={balanceLine(p, view.currency)} onClick={p.isMe ? undefined : () => setChosen(p)} testId="event-person" />
        ))}
      </InsetGroup>
      <InsetGroup header="Without the app">
        {live.filter((p) => !p.hasApp).map((p) => (
          <InsetRow key={p.personId} title={p.name} subtitle={balanceLine(p, view.currency)} onClick={() => setChosen(p)} testId="event-person" />
        ))}
      </InsetGroup>
      <form aria-label="Add a name" onSubmit={(event) => void addName(event)}>
        <InsetGroup footer="For someone without the app: anyone can record what they pay. They can claim the name when they join.">
          <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <SubmitRow label="Add a name" disabled={!name.trim()} />
        </InsetGroup>
      </form>
      <InsetGroup>
        <InsetRow title="Invite someone" onClick={() => void run(async () => setInvite({ invite: await sync.eventInvite(view.bookId, view.myName), header: `Invite to ${view.name}` }))} testId="event-invite" />
      </InsetGroup>
      {invite ? <InviteCard invite={invite.invite} bookName={view.name} inviterName={view.myName} header={invite.header} footer="Send it to the person joining." /> : null}
      {chosen ? (
        <Sheet grouped title={chosen.name} onClose={() => setChosen(null)}>
          <InsetGroup footer={chosen.hasApp ? `Removing ${chosen.name} also signs ${chosen.name}'s phones out of ${view.name}. Only at a zero balance and in no expense.` : 'Only at a zero balance and in no expense.'}>
            {chosen.hasApp ? (
              <InsetRow
                title={`A new phone for ${chosen.name}`}
                onClick={() =>
                  void run(async () => {
                    setInvite({ invite: await sync.eventInvite(view.bookId, view.myName, chosen.personId), header: `${chosen.name}'s new phone` });
                    setChosen(null);
                  })
                }
              />
            ) : null}
            <InsetRow
              title={`Remove ${chosen.name}`}
              destructive
              onClick={() =>
                void run(async () => {
                  await sync.removeEventMember(ownerScope(ws), eventId, view.bookId, chosen.personId);
                  setChosen(null);
                })
              }
            />
          </InsetGroup>
        </Sheet>
      ) : null}
    </div>
  );
}
