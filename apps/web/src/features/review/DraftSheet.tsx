import type { CaptureSource, DraftRow, SetAsideChoice } from '@expanses/db';
import { Camera } from 'lucide-react';
import { useEffect, useState } from 'react';
import { captureBytes, native } from '../../capture/native';
import { Chevron, FormRows, RowGlyph, SwitchRow } from '../transactions/FormRow';
import { TransactionCard } from '../transactions/TransactionCard';
import type { FormDraft } from '../transactions/tx-form';
import { asksForSourceAccount, captureRowView, SURE, sourceSide } from './capture-view';
import { canRecord, formFromDraft } from './draft-form';

const KIND_WORDS: Partial<Record<DraftRow['source'], string>> = { notification: 'Notification', screen: 'Screenshot', photo: 'Photo' };

/**
 * One draft, reviewed on the Add transaction screen itself.
 *
 * A captured draft used to open in a sheet of its own — its own order, its own words, a plain number for the amount
 * and a date box — so finishing a capture was a second form to learn. It now opens on the very card that adds a
 * transaction, filled in from what was read: the same tabs, the same Paid with, Amount, Category, Note and ‹ day ›,
 * and ✓ in the corner records it. What is particular to a capture stands around that card: the picture it came
 * from above (one tap from the full-screen view, with Keep photo under it), the one question only the owner can
 * answer on the account row itself, and Discard at the foot.
 *
 * The draft is the caller's to write: `onRecord` gets the form as it stands, and the caller writes it back onto the
 * draft and confirms it, teaching the source from whatever was corrected on the way.
 */
export function DraftSheet({
  draft,
  source,
  onAnswerSource,
  onUnmerge,
  onView,
  onRecord,
  onDiscard,
  onClose,
}: {
  draft: DraftRow;
  /** The source this capture was recognised as, when there is one — what "remembered for" names. */
  source: CaptureSource | null;
  /** The answer to "Which account is this?": remembered for the source, and applied to this draft. */
  onAnswerSource: (accountId: string) => void;
  /** Splits the last folded-in capture back out into a draft of its own. */
  onUnmerge: () => void;
  /** Opens the full-screen picture, or a notification's own words. */
  onView: () => void;
  /** Writes the form back onto the draft and confirms it. A throw is shown on the card. */
  onRecord: (form: FormDraft, opts: { setAside: SetAsideChoice | null; keepPhoto: boolean }) => Promise<void>;
  onDiscard: () => void;
  onClose: () => void;
}) {
  // The form is filled once, from the draft as it opened: later writes to the row (an answered source) are the
  // form's own choices already, and refilling it would throw away what has been typed since.
  const [prefill] = useState(() => formFromDraft(draft));
  // A photographed receipt is kept with the purchase unless the owner says no; a screenshot is not kept unless asked.
  const [keepPhoto, setKeepPhoto] = useState(draft.source === 'photo');
  const ask = asksForSourceAccount(draft, source);
  // Opened from partway down the queue: the form starts at its top, as a screen of its own does.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <TransactionCard
      full
      title="Review"
      label={`Review ${draft.description}`}
      onBack={onClose}
      onDone={onClose}
      finish={{
        prefill,
        saveLabel: 'Record',
        canSubmit: (form) => canRecord(form, draft),
        onSubmit: (form, setAside) => onRecord(form, { setAside, keepPhoto }),
        amountUnsure: draft.confidence !== null && draft.confidence < SURE,
        accountAsk:
          ask && source
            ? {
                // A top-up's source is the wallet it landed in, so for one the question is about where the money went.
                side: sourceSide(draft) === 'toAccountId' ? 'to' : 'money',
                label: 'Which account is this?',
                note: `Remembered for every capture from ${source.label}`,
                onAnswer: onAnswerSource,
              }
            : undefined,
        header: <CaptureStrip draft={draft} source={source} keepPhoto={keepPhoto} onKeepPhoto={setKeepPhoto} onView={onView} onUnmerge={onUnmerge} />,
        footer: (
          <button
            type="button"
            onClick={onDiscard}
            className="ph-focus min-h-11 w-full rounded-full text-[15px] font-semibold text-[var(--ph-alarm)] active:bg-[var(--ph-fill)]"
          >
            Discard
          </button>
        ),
      }}
    />
  );
}

/**
 * Where the draft came from, above the form: the picture (or a notification's words), how it arrived and from
 * which app, and whether more than one sighting was folded into it. The whole strip opens the full-screen view;
 * Unmerge sits above that, a button of its own.
 */
function CaptureStrip({
  draft,
  source,
  keepPhoto,
  onKeepPhoto,
  onView,
  onUnmerge,
}: {
  draft: DraftRow;
  source: CaptureSource | null;
  keepPhoto: boolean;
  onKeepPhoto: (keep: boolean) => void;
  onView: () => void;
  onUnmerge: () => void;
}) {
  const view = captureRowView(draft, source);
  const kind = KIND_WORDS[draft.source];
  // Only a capture has a strip: a statement row has no picture and no words of its own to show.
  if (!view.icon || !kind) return null;
  const where = source?.label ?? 'Captured on this phone';
  const said = draft.imageFile ? null : (draft.rawPayload?.split('\n').find((line) => line.trim() !== '') ?? null);
  const viewable = Boolean(draft.imageFile || draft.rawPayload);

  return (
    <FormRows>
      <div className="relative flex items-center gap-3 py-[10px] pr-[13px] pl-[10px]">
        {draft.imageFile && <Thumbnail file={draft.imageFile} />}
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          {/* The stretched button: the strip's whole area is its target, and Unmerge is raised above it. */}
          <button
            type="button"
            onClick={onView}
            disabled={!viewable}
            aria-label={`See what was read from ${draft.description}`}
            className="ph-focus-inset truncate text-left text-[15px] leading-5 font-semibold text-[var(--ph-ink)] after:absolute after:inset-0 after:content-['']"
          >
            <span aria-hidden>{view.icon} </span>
            {kind} · {where}
          </button>
          {said && <span className="line-clamp-2 text-[12.5px] leading-4 text-[var(--ph-ink-2)]">{said}</span>}
          {view.merged ? (
            <span className="text-[12.5px] leading-4 text-[var(--ph-ink-3)]">
              {view.merged} ·{' '}
              <button type="button" onClick={onUnmerge} className="ph-focus relative z-10 font-semibold text-[var(--ph-tint)]">
                Unmerge
              </button>
            </span>
          ) : (
            viewable && <span className="text-[12.5px] leading-4 text-[var(--ph-ink-3)]">Tap to see what was read</span>
          )}
        </span>
        {viewable && <Chevron />}
      </div>
      {draft.imageFile && (
        <SwitchRow
          icon={
            <RowGlyph>
              <Camera size={15} />
            </RowGlyph>
          }
          label="Keep photo"
          checked={keepPhoto}
          onChange={onKeepPhoto}
        />
      )}
    </FormRows>
  );
}

/** The capture's picture, small: read from the phone's own capture folder, as the full-screen view reads it. */
function Thumbnail({ file }: { file: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void native
      .readCaptureImage({ file })
      .then(({ base64, mime }) => {
        url = URL.createObjectURL(new Blob([captureBytes(base64)], { type: mime }));
        if (cancelled) URL.revokeObjectURL(url);
        else setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  return (
    <span aria-hidden className="h-[74px] w-[54px] shrink-0 overflow-hidden rounded-[8px] bg-[var(--ph-fill)] shadow-[inset_0_0_0_0.5px_var(--ph-hair)]">
      {src && <img src={src} alt="" className="h-full w-full object-cover object-top" />}
    </span>
  );
}
