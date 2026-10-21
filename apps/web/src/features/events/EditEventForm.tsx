import { type EventRow, saveEvent } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';

/**
 * Edit event: the New event form, opened on the event as it stands — its name, its dates and the categories it draws on.
 *
 * The categories can be changed only while nothing is tagged to the event and nothing is planned on it: what is
 * already there was filed in the set it drew on, and moving the event to another set would leave it filed in
 * categories the event no longer offers. The goal it funds is kept as it is; this form does not touch it.
 */
export function EditEventForm({
  event,
  sets,
  setLocked,
  onDone,
}: {
  event: EventRow;
  sets: readonly { id: string; name: string }[];
  /** Something is tagged or planned on it, so the categories stay as they are. */
  setLocked: boolean;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [name, setName] = useState(event.name);
  const [startsOn, setStartsOn] = useState(event.startsOn);
  const [endsOn, setEndsOn] = useState(event.endsOn);
  const [setId, setSetId] = useState(event.setId ?? '');
  const [error, setError] = useState<unknown>(null);

  async function save(submitted: FormEvent) {
    submitted.preventDefault();
    setError(null);
    try {
      await saveEvent(database, ws, { id: event.id, name, startsOn, endsOn, goalId: event.goalId, setId: setId === '' ? null : setId });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  const setName_ = sets.find((set) => set.id === event.setId)?.name ?? 'The monthly categories';
  return (
    <form onSubmit={save} data-testid="edit-event">
      <ErrorBox error={error} />
      <InsetGroup header="Edit event">
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        {setLocked ? (
          <InsetRow title="Categories" value={setName_} chevron={false} />
        ) : (
          <SelectRow label="Categories" value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="">The monthly categories</option>
            {sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </SelectRow>
        )}
        <TextRow label="Starts on" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        <TextRow label="Ends on" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
      </InsetGroup>
      <InsetGroup footer={setLocked ? 'Categories stay as they are once something is tagged or planned on the event.' : undefined}>
        <SubmitRow label="Save changes" />
        <InsetRow title={<span className="font-normal text-[var(--ph-ink-2)]">Cancel</span>} label="Cancel" onClick={onDone} chevron={false} />
      </InsetGroup>
    </form>
  );
}
