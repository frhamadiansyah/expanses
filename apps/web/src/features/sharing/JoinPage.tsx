import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { PreviewedInvite } from '@expanses/db';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { LargeTitle, SCREEN } from '../../ui/native';
import { joinTitle } from './join-event';
import { JoinWorkspace } from './JoinWorkspace';

/**
 * Where a `cicis://join/…` link lands (spec §11): the shell's URL handler and the web address `/join#<code>` both open
 * this screen with the code filled in, and it asks for the preview at once.
 *
 * The code is read from the fragment once and the address is replaced at once by plain `/join`: half the code is the
 * invite's secret, so it is kept out of the path (servers log paths) and out of the tab's history (fix round 1).
 */
export function JoinPage() {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [code] = useState(() => decodeHash(hash));
  const { switchBook } = useApp();
  const navigate = useNavigate();
  // An event's invite says what it joins: "Join Coast week", not a workspace (spec §6).
  const [preview, setPreview] = useState<PreviewedInvite | null>(null);
  useEffect(() => {
    if (hash) void navigate({ to: '/join', replace: true });
  }, [hash, navigate]);
  return (
    <div className={SCREEN}>
      <LargeTitle title={joinTitle(preview)} back="Cashflow" backTo="/transactions" />
      <JoinWorkspace
        initialCode={code}
        onPreview={setPreview}
        onJoinedEvent={async (eventId) => {
          await navigate({ to: '/events/$eventId', params: { eventId } });
        }}
        onJoined={async (bookId) => {
          await switchBook(bookId);
          await navigate({ to: '/transactions' });
        }}
      />
    </div>
  );
}

function decodeHash(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
