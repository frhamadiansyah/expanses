import { addEventPerson, type CreatedInvite, ownerScope, type SharedPersonView } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from '../sharing/InviteCard';
import { sayError } from '../sharing/sharing-copy';
import { useSharedEventView } from './shared-queries';
import { isStillHasPhone, oldPhoneTitle } from './people-phone';
import { balanceLine, pageLocks } from './shared-view';

/**
 * Who is in a shared event (shared events §6): those with the app and the names without it. An invite link for someone
 * new, a name added for someone without the app, a person's new phone, and removing a person at zero and in no record.
 * Once this phone's person is no longer in the event, the list is kept to read and offers nothing (I5).
 */
export function PeoplePage() {
  const { eventId } = useParams({ from: '/events/$eventId/people' });
  const { database, ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const read = useSharedEventView(eventId);
  const view = read.data;
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ invite: CreatedInvite; header: string } | null>(null);
  const [chosen, setChosen] = useState<SharedPersonView | null>(null);
  const [error, setError] = useState<unknown>(null);
  // What an action taken from the sheet says goes in the sheet: the page's own box sits behind its scrim (I8).
  const [sheetError, setSheetError] = useState<unknown>(null);
  // Removing asks twice (it also signs a person's phones out, with no undo): the first tap arms, closing disarms.
  const [armed, setArmed] = useState(false);
  // Lost phone: an invite for a person's new phone was refused because the old phone is still in. The sheet then offers
  // removing just that phone, asked twice like Remove, before the invite is tried again.
  const [oldPhone, setOldPhone] = useState(false);
  const [armedPhone, setArmedPhone] = useState(false);
  if (!view) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="People" back="Events" backTo="/events" />
        <ErrorBox error={read.error} />
        {read.isPending || read.error ? null : <p className="px-[4px] py-[8px] text-[15px] leading-[20px] text-[var(--ph-ink-2)]">This event is not shared on this phone.</p>}
      </div>
    );
  }
  const live = view.people.filter((p) => !p.removed);
  const { readOnly } = pageLocks(view);

  async function run(work: () => Promise<unknown>, onError: (failure: unknown) => void = setError) {
    setError(null);
    setSheetError(null);
    try {
      await work();
      await invalidate();
    } catch (failure) {
      onError(sayError(failure));
    }
  }

  async function addName(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await addEventPerson(database, ownerScope(ws), eventId, name);
      setName('');
    });
  }

  const open = (p: SharedPersonView) => {
    setSheetError(null);
    setArmed(false);
    setOldPhone(false);
    setArmedPhone(false);
    setChosen(p);
  };
  const close = () => {
    setSheetError(null);
    setArmed(false);
    setOldPhone(false);
    setArmedPhone(false);
    setChosen(null);
  };

  return (
    <div className={SCREEN}>
      <LargeTitle title="People" back={view.name} backTo="/events/$eventId" backParams={{ eventId }} />
      <ErrorBox error={error} />
      <InsetGroup header="With the app">
        {live.filter((p) => p.hasApp).map((p) => (
          <InsetRow key={p.personId} title={p.isMe ? `${p.name} (this phone)` : p.name} subtitle={balanceLine(p, view.currency)} onClick={p.isMe || readOnly ? undefined : () => open(p)} testId="event-person" />
        ))}
      </InsetGroup>
      <InsetGroup header="Without the app">
        {live.filter((p) => !p.hasApp).map((p) => (
          <InsetRow key={p.personId} title={p.name} subtitle={balanceLine(p, view.currency)} onClick={readOnly ? undefined : () => open(p)} testId="event-person" />
        ))}
      </InsetGroup>
      {readOnly ? null : (
        <>
          <form aria-label="Add a name" onSubmit={(event) => void addName(event)}>
            <InsetGroup footer="For someone without the app: anyone can record what they pay. They can claim the name when they join.">
              <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <SubmitRow label="Add a name" disabled={!name.trim()} />
            </InsetGroup>
          </form>
          <InsetGroup>
            <InsetRow title="Invite someone" onClick={() => void run(async () => setInvite({ invite: await sync.eventInvite(view.bookId, view.myName), header: `Invite to ${view.name}` }))} testId="event-invite" />
          </InsetGroup>
        </>
      )}
      {invite && !readOnly ? <InviteCard invite={invite.invite} bookName={view.name} inviterName={view.myName} header={invite.header} footer="Send it to the person joining." /> : null}
      {chosen ? (
        <Sheet grouped title={chosen.name} onClose={close}>
          <ErrorBox error={sheetError} />
          <InsetGroup footer={chosen.hasApp ? `Removing ${chosen.name} also signs ${chosen.name}'s phones out of ${view.name}. Only at a zero balance and in no expense.` : 'Only at a zero balance and in no expense.'}>
            {chosen.hasApp ? (
              <InsetRow
                title={`A new phone for ${chosen.name}`}
                onClick={() =>
                  void run(async () => {
                    setInvite({ invite: await sync.eventInvite(view.bookId, view.myName, chosen.personId), header: `${chosen.name}'s new phone` });
                    close();
                  }, (failure) => {
                    setOldPhone(isStillHasPhone(failure));
                    setSheetError(failure);
                  })
                }
              />
            ) : null}
            {chosen.hasApp && oldPhone ? (
              <InsetRow
                title={oldPhoneTitle(chosen.name, armedPhone)}
                destructive
                testId="event-person-remove-phone"
                onClick={() => {
                  if (!armedPhone) return setArmedPhone(true);
                  void run(async () => {
                    await sync.removeEventMemberPhones(ownerScope(ws), eventId, view.bookId, chosen.personId);
                    setOldPhone(false);
                    setArmedPhone(false);
                  }, (failure) => {
                    setArmedPhone(false);
                    setSheetError(failure);
                  });
                }}
              />
            ) : null}
            <InsetRow
              title={armed ? `Tap again to remove ${chosen.name}` : `Remove ${chosen.name}`}
              destructive
              testId="event-person-remove"
              onClick={() => {
                if (!armed) return setArmed(true);
                void run(async () => {
                  await sync.removeEventMember(ownerScope(ws), eventId, view.bookId, chosen.personId);
                  close();
                }, (failure) => {
                  setArmed(false);
                  setSheetError(failure);
                });
              }}
            />
          </InsetGroup>
        </Sheet>
      ) : null}
    </div>
  );
}
