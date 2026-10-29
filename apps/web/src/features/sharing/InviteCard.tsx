import type { CreatedInvite } from '@expanses/db';
import { useState } from 'react';
import { isNative } from '../../lib/pwa';
import { shareText } from '../../native/share';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow } from '../../ui/native';

/** The code itself: 52 characters in groups of four (§8.1 step 6), large enough to read out across a table. */
function CodeRow({ code }: GroupChild & { code: string }) {
  return (
    <div className="px-[13px] py-[12px]">
      <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Code</p>
      <p data-testid="invite-code" className="tabular mt-[4px] font-mono text-[15px] leading-[22px] tracking-[0.04em] break-words text-[var(--ph-ink)] select-all">
        {code}
      </p>
    </div>
  );
}

/** Whether a share sheet exists here: the shell's, or the browser's own. Send is left out where neither does. */
const canSend = () => isNative() || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

/**
 * An invite, once made: the code, the `cicis://join/…` link, Copy and Send — the share sheet in the shell, the
 * browser's own where it has one. The code and the link are the same invite written two ways.
 */
export function InviteCard({
  invite,
  bookName,
  inviterName,
  header,
  footer = '',
}: {
  invite: CreatedInvite;
  bookName: string;
  inviterName: string;
  header: string;
  footer?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const text = `${inviterName} sent an invite to ${bookName}. Open ${invite.link} — or choose Join a workspace in the app and enter ${invite.code}`;

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied');
    } catch (failure) {
      setError(failure);
    }
  }

  async function send() {
    setError(null);
    setNote(null);
    try {
      const done = await shareText({ title: `Join ${bookName}`, text });
      if (done === 'copied') setNote('Copied');
    } catch (failure) {
      setError(failure);
    }
  }

  const expires = new Date(invite.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return (
    <div data-testid="invite-card">
      <ErrorBox error={error} />
      <InsetGroup wide header={header} footer={`${footer ? `${footer} ` : ''}Works once, until ${expires}.${note ? ` ${note}.` : ''}`}>
        <CodeRow code={invite.code} />
        <InsetRow title="Link" subtitle={<span data-testid="invite-link">{invite.link}</span>} chevron={false} />
        <InsetRow testId="share-copy" title="Copy" action onClick={() => void copy()} />
        {canSend() ? <InsetRow testId="share-send" title="Send" action onClick={() => void send()} /> : null}
      </InsetGroup>
    </div>
  );
}
