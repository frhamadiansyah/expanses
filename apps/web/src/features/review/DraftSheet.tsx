import type { CaptureSource, DraftRow, SetAsideChoice } from '@expanses/db';
import { useEffect, useState } from 'react';
import { useAccounts } from '../../lib/queries';
import { Chevron, FormRows, ROW_BODY, RowGlyph, RowLead } from '../transactions/FormRow';
import { TransactionCard } from '../transactions/TransactionCard';
import type { FormDraft } from '../transactions/tx-form';
import { CAPTURE_TYPES } from './capture-type';
import { asksForSourceAccount, captureRowView, sourceSide } from './capture-view';
import { canRecord, formFromDraft } from './draft-form';

/**
 * One draft, reviewed on the Add transaction screen itself.
 *
 * A captured draft used to open in a sheet of its own — its own order, its own words, a plain number for the amount
 * and a date box — so finishing a capture was a second form to learn. It now opens on the very card that adds a
 * transaction, filled in from what was read: the same tabs, the same Paid with, Amount, Category, Note and ‹ day ›,
 * and ✓ in the corner records it. What is particular to a capture stands around that card: what it came from above
 * (one tap from the plain view of it), the one question only the owner can answer on the account row itself, and
 * Discard at the foot. Whether the picture stays with the purchase is not asked: the camera's is kept, any other is
 * not (`keepsPicture`).
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
  /** Opens the plain view: the picture, or a message's own words. */
  onView: () => void;
  /** Writes the form back onto the draft and confirms it. A throw is shown on the card. */
  onRecord: (form: FormDraft, opts: { setAside: SetAsideChoice | null }) => Promise<void>;
  onDiscard: () => void;
  onClose: () => void;
}) {
  // The form is filled once, from the draft as it opened: later writes to the row (an answered source) are the
  // form's own choices already, and refilling it would throw away what has been typed since.
  const [prefill] = useState(() => formFromDraft(draft));
  const ask = asksForSourceAccount(draft, source);
  // What the form's figure is read against: the paying account's currency decides whether a charge is asked too.
  const accounts = useAccounts().data ?? [];
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
        canSubmit: (form) => canRecord(form, draft, accounts),
        onSubmit: (form, setAside) => onRecord(form, { setAside }),
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
        header: <CaptureStrip draft={draft} source={source} onView={onView} />,
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
 * Where the draft came from, above the form: one row that names what it was — an SMS, a screenshot, a photo — in the
 * glyph circle the form's own rows use, and opens the plain view of it. The words and the picture are that view's to
 * show, not this row's. A draft folded from several sightings of one payment is still the one row: the app's match is
 * taken as it stands.
 */
function CaptureStrip({ draft, source, onView }: { draft: DraftRow; source: CaptureSource | null; onView: () => void }) {
  const view = captureRowView(draft, source);
  // Only a capture has a strip: a statement row has no picture and no words of its own to show.
  if (!view.type) return null;
  const { word, Icon } = CAPTURE_TYPES[view.type];
  // A message whose words were cleared after their keeping time, with no picture, has nothing left to open.
  const viewable = Boolean(draft.imageFile || draft.rawPayload);
  const face = (
    <>
      <RowLead>
        <RowGlyph>
          <Icon size={15} data-capture-type={view.type} />
        </RowGlyph>
      </RowLead>
      <span className={ROW_BODY}>
        <span className="min-w-0 flex-1 truncate text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-5">{word}</span>
        {viewable && <Chevron />}
      </span>
    </>
  );

  return (
    <FormRows>
      {viewable ? (
        <button
          type="button"
          onClick={onView}
          aria-label={`${word} · what was read from ${draft.description}`}
          className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
        >
          {face}
        </button>
      ) : (
        <div className="flex w-full items-center gap-[10px] pl-[10px]">{face}</div>
      )}
    </FormRows>
  );
}
