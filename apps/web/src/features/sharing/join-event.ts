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

export const JOIN_TITLE = 'Join with a code';

/** The join screen's title: "Join Coast week" for an event's invite, else "Join with a code" until a workspace code is previewed. */
export function joinTitle(preview: Pick<PreviewedInvite, 'event' | 'bookName'> | null): string {
  if (preview?.event) return `Join ${preview.event.name}`;
  return preview?.bookName ? `Join ${preview.bookName}` : JOIN_TITLE;
}
