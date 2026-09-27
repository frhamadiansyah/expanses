import { ownerScope, type PreviewedInvite } from '@expanses/db';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SubmitRow, TextRow } from '../../ui/native';
import { currencyRefusal, replaceConfirm, sayError } from './sharing-copy';
import { thisDeviceName } from './SharingSection';

/*
 * Join a workspace (household sharing spec §8.2, §11): a code pasted or arrived by a `cicis://join/…` link, then the
 * preview — the workspace, who invited you, and the currency check — and only then Join, which claims the invite. A
 * workspace in another currency is refused with §8.2's sentence before anything is claimed, so the invite stays good
 * for someone else. A join that would move this device's copy of the workspace onto another share asks first
 * (recovery review, N1).
 */

const NAME_KEY = 'cicis.sharing.name';

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function JoinWorkspace({ initialCode = '', onJoined }: { initialCode?: string; onJoined: (bookId: string) => void }) {
  const { ws, sync } = useApp();
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<PreviewedInvite | null>(null);
  const [name, setName] = useState(rememberedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const asked = useRef(false);

  async function look(text: string) {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await sync.preview(text));
    } catch (failure) {
      setError(sayError(failure));
    } finally {
      setBusy(false);
    }
  }

  // Arriving by a link: the code is already here, so the preview is asked for at once.
  useEffect(() => {
    if (initialCode && !asked.current) {
      asked.current = true;
      void look(initialCode);
    }
    // Once, for the code this screen arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function join(event?: FormEvent, confirmed = false) {
    event?.preventDefault();
    if (!preview || busy) return;
    // Moving this copy onto another share replaces the one it was on (N1): said, and asked, before anything is claimed.
    if (preview.replaces && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    const linking = preview.terms.sameMember;
    const memberName = linking ? (preview.memberName ?? preview.inviterName) : name.trim();
    if (!memberName) return;
    setBusy(true);
    setError(null);
    try {
      if (!linking) {
        try {
          localStorage.setItem(NAME_KEY, memberName);
        } catch {
          // Remembered only as a convenience.
        }
      }
      const { bookId } = await sync.join(code, { ws: ownerScope(ws), memberName, deviceName: thisDeviceName() });
      onJoined(bookId);
    } catch (failure) {
      setError(sayError(failure));
    } finally {
      setBusy(false);
    }
  }

  const refusal = preview && preview.baseCurrency !== ws.baseCurrency ? currencyRefusal(preview.baseCurrency, ws.baseCurrency) : null;
  const unusable = preview?.claimed ? 'Someone has already used this invite. Ask for a new one.' : preview?.expired ? 'This invite has expired. Ask for a new one.' : null;

  return (
    <div data-testid="join-workspace">
      <ErrorBox error={error} />
      <form
        aria-label="Find an invite"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) void look(code);
        }}
      >
        <InsetGroup wide header="Invite" footer="Paste the code or the link you were sent. Nothing is joined until you choose Join.">
          <TextRow
            label="Code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setPreview(null);
            }}
            placeholder="XXXX-XXXX-…"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          {preview ? null : <SubmitRow label={busy ? 'Looking…' : 'Continue'} disabled={busy || !code.trim()} />}
        </InsetGroup>
      </form>

      {preview ? (
        <form aria-label="Join a workspace" onSubmit={(event) => void join(event)}>
          <InsetGroup
            wide
            header="You are invited to"
            footer={
              refusal ? (
                <span data-testid="currency-refusal" className="text-[var(--ph-warn)]">
                  {refusal}
                </span>
              ) : (
                (unusable ?? (preview.terms.sameMember ? `This device joins as ${preview.memberName ?? preview.inviterName}.` : 'You will see and record into it together.'))
              )
            }
          >
            <ReadOnlyRow label="Workspace" value={preview.bookName} />
            <ReadOnlyRow label="Invited by" value={preview.inviterName} />
          </InsetGroup>
          {refusal || unusable ? null : (
            <InsetGroup wide>
              {preview.terms.sameMember ? null : (
                <TextRow label="Your name" value={name} onChange={(event) => setName(event.target.value)} placeholder="As the others will see it" required autoComplete="name" />
              )}
              <SubmitRow label={busy ? 'Joining…' : 'Join'} disabled={busy || (!preview.terms.sameMember && !name.trim())} />
            </InsetGroup>
          )}
          {refusal || unusable ? (
            <InsetGroup wide>
              <InsetRow title="Try another code" chevron={false} onClick={() => setPreview(null)} />
            </InsetGroup>
          ) : null}
        </form>
      ) : null}
      {confirming && preview?.replaces ? (
        <Sheet
          title="Replace this workspace’s sharing?"
          onClose={() => setConfirming(false)}
          confirm={{ label: 'Replace and join', disabled: busy, run: () => void join(undefined, true) }}
        >
          <p className="text-[15px] leading-[20px]">{replaceConfirm(preview.replaces.bookName, preview.inviterName)}</p>
        </Sheet>
      ) : null}
    </div>
  );
}
