import type { PreviewedInvite } from '@expanses/db';

/** What an event's invite shows (Task 8's `EventInviteDetails`, read off the preview so the package index is not touched). */
export type EventInviteDetails = NonNullable<PreviewedInvite['event']>;

/** "I'm Budi" for each name nobody has claimed yet, then a new name (shared events §6, Joining). */
export function joinChoices(event: EventInviteDetails): { key: string; label: string; personId: string | null; name: string }[] {
  return [
    ...event.people.filter((p) => !p.claimed).map((p) => ({ key: p.personId, label: `I’m ${p.name}`, personId: p.personId, name: p.name })),
    { key: 'new', label: 'Someone new', personId: null, name: '' },
  ];
}

/** The join screen's title: "Join Coast week" for an event's invite, else the workspace join it has always been. */
export function joinTitle(preview: Pick<PreviewedInvite, 'event'> | null): string {
  return preview?.event ? `Join ${preview.event.name}` : 'Join a workspace';
}
