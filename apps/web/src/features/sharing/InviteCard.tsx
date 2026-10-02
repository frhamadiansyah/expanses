import type { CreatedInvite } from '@expanses/db';
import { Share2 } from 'lucide-react';
import { useState } from 'react';
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

/**
 * An invite, once made: the code, the `cicis://join/…` link, and Share — the share sheet in the shell, the browser's
 * own where it has one, the clipboard elsewhere. The code and the link are the same invite written two ways.
 */
export function InviteCard({
  invite,
  bookName,
  inviterName,
  header,
  footer,
}: {
  invite: CreatedInvite;
  bookName: string;
  inviterName: string;
  header: string;
  footer: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function share() {
    setError(null);
    setNote(null);
    try {
      const done = await shareText({
        title: `Join ${bookName}`,
        text: `${inviterName} sent an invite to ${bookName}. Open ${invite.link} — or choose Join a workspace in the app and enter ${invite.code}`,
      });
      if (done === 'copied') setNote('Copied. Paste it to the person being invited.');
    } catch (failure) {
      setError(failure);
    }
  }

  const expires = new Date(invite.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return (
    <div data-testid="invite-card">
      <ErrorBox error={error} />
      <InsetGroup wide header={header} footer={`${footer} Works once, until ${expires}.${note ? ` ${note}` : ''}`}>
        <CodeRow code={invite.code} />
        <InsetRow title="Link" subtitle={<span data-testid="invite-link">{invite.link}</span>} chevron={false} />
        <InsetRow title="Share invite" icon={<Share2 size={15} aria-hidden />} chevron={false} onClick={() => void share()} />
      </InsetGroup>
    </div>
  );
}
