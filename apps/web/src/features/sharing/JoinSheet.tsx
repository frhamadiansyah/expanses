import type { PreviewedInvite } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { joinTitle } from './join-event';
import { JoinWorkspace } from './JoinWorkspace';

/**
 * Join a workspace, from the switcher's + (spec §11): the same screen the link opens, as a sheet over the switcher. An
 * event's invite joins the event: the sheet closes, then the event's page opens (I7) — the switcher's sheet lives in the
 * layout, above every page, and would otherwise stay up over it.
 */
export function JoinSheet({ onClose }: { onClose: () => void }) {
  const { switchBook } = useApp();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<PreviewedInvite | null>(null);
  return (
    <Sheet grouped title={joinTitle(preview)} onClose={onClose}>
      <JoinWorkspace
        onPreview={setPreview}
        onJoined={async (bookId) => {
          await switchBook(bookId);
          onClose();
        }}
        onJoinedEvent={async (eventId) => {
          onClose();
          await navigate({ to: '/events/$eventId', params: { eventId } });
        }}
      />
    </Sheet>
  );
}
