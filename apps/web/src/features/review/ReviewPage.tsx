import { dayMonth, formatMinor } from '@expanses/core';
import {
  addPhoto,
  type CaptureSource,
  confirmDraft,
  type DraftRow,
  dismissDraft,
  editDraft,
  learnFromCorrection,
  reopenDraft,
  type SetAsideChoice,
  setSourceAccount,
  unmerge,
  voidTransaction,
} from '@expanses/db';
import { Check, Camera, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { captureBytes, native } from '../../capture/native';
import { useScanReceipt } from '../../capture/use-scan';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { photos } from '../../photos/store';
import { cx, Empty, ErrorBox, Select } from '../../ui';
import { Figure, LargeTitle, RecordTable, SCREEN } from '../../ui/native';
import { UndoToast } from '../../ui/UndoToast';
import { CategoryOptions } from '../cards/options';
import { type Door, spendingDoor } from '../goals/set-aside-question';
import { asksAboutSetAside, SetAsideSheet } from '../goals/SetAsideQuestion';
import { answerPatch, captureRowView, type ReadingWithLines } from './capture-view';
import { CaptureViewer } from './CaptureViewer';
import { DraftSheet } from './DraftSheet';
import { corrections, draftPatch } from './draft-form';
import type { FormDraft } from '../transactions/tx-form';
import { useCaptureSources, useDrafts } from './queries';
import { SkippedList } from './SkippedList';

/**
 * Captured spending, waiting to be confirmed.
 *
 * Nothing a parser produces reaches the ledger on its own. That is what makes it safe for a bank to
 * change its statement layout without warning: a broken parser fills this queue with nonsense, which
 * is a nuisance, rather than the books, which would be a problem.
 *
 * A desktop reads the queue as a table, every column in place, exactly as it did before. A phone reads it as rows
 * — a chevron into the sheet that holds what a row had no width for, and the two answers themselves one gesture
 * away: right to record, left to discard. The gesture is only safe because it asks what the Record button asks —
 * a purchase that takes promised money still gets its question first, and a draft with no account or category has
 * no answer to give, so it opens the sheet — and because either write can be taken back from the toast: a record
 * is voided through the ledger and the draft returns to the queue, which is the one way back for both directions.
 */
export function ReviewPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const phone = usePhone();
  const drafts = useDrafts();
  const accounts = useAccounts().data ?? [];
  const sources = useCaptureSources().data ?? [];
  const scan = useScanReceipt();
  // Confirming a draft records real spending, so the account it names has to be one that can pay.
  const money = moneyHolders(accounts).filter((a) => canPayWith(a));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The draft the phone's sheet is open on, by id — the row that was tapped. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The full-screen picture, and the field it was opened at — null means "the picture as a whole". */
  const [viewing, setViewing] = useState<{ draft: DraftRow; focus: 'amount' | 'name' | 'date' | null } | null>(null);
  /** What the phone just did, and the way back — the bills list's own toast, for the same reason. */
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);

  async function run(id: string, work: () => Promise<unknown>) {
    setError(null);
    setBusy(id);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  /** The name an account or a category goes by on a row, or what the draft is still missing. */
  const nameOf = (id: string | null, missing: string) => accounts.find((account) => account.id === id)?.name ?? missing;

  /** The source a capture was recognised as, when this device still knows it. */
  const sourceOf = (draft: DraftRow): CaptureSource | null => sources.find((source) => source.id === draft.sourceId) ?? null;

  /** Puts a resolved draft back: what a record posted is voided first, then the draft itself returns to the queue. */
  async function undo(draft: DraftRow, transactionId: string | null) {
    if (transactionId) await voidTransaction(database, ws, transactionId);
    await reopenDraft(database, ws, draft.id);
    await invalidate();
  }

  /** Says what the phone just did, with the way back on the toast. */
  function resolved(draft: DraftRow, what: 'recorded' | 'discarded', transactionId: string | null) {
    setEditing(null);
    setToast({
      text: `${what === 'recorded' ? 'Recorded' : 'Discarded'} ${draft.description}`,
      undo: () => undo(draft, transactionId),
    });
  }

  /** A draft whose payment takes promised money: confirmed from the question's sheet once it is answered. */
  const [asking, setAsking] = useState<{ id: string; door: Door; undoable: boolean; keepPhoto: boolean } | null>(null);

  /**
   * Confirms the draft. A purchase that would take promised money gets its question first, in a sheet; money in
   * and transfers do not, because nothing about them is spending. The picture's fate is settled afterwards — see
   * `settlePicture`.
   */
  async function record(draft: DraftRow, opts: { undoable?: boolean; keepPhoto?: boolean } = {}) {
    setError(null);
    const keepPhoto = opts.keepPhoto ?? draft.source === 'photo';
    if (draft.kind === 'expense') {
      const door = spendingDoor(draft.accountId ?? '', Math.max(0, draft.amountMinor));
      let asks = false;
      try {
        asks = await asksAboutSetAside(database, ws, door);
      } catch (e) {
        setError(e);
        return;
      }
      if (asks) {
        setAsking({ id: draft.id, door: door!, undoable: opts.undoable ?? false, keepPhoto });
        return;
      }
    }
    await run(draft.id, async () => {
      const { transactionId, keptImage } = await confirmDraft(database, ws, draft.id, { setAside: null, keepPhoto });
      await settlePicture(draft, transactionId, keptImage);
      if (opts.undoable) resolved(draft, 'recorded', transactionId);
    });
  }

  /**
   * The picture's fate once a draft is dealt with: a kept image is copied into the app's own photo store and
   * attached to the transaction, and the phone's working copy is let go. When the copy cannot be made the capture
   * file stays — a picture is never deleted before something else holds it.
   */
  async function settlePicture(draft: DraftRow, transactionId: string, keptImage: string | null) {
    if (keptImage) {
      try {
        const { base64, mime } = await native.readCaptureImage({ file: keptImage });
        const saved = await photos.savePhotoBytes(captureBytes(base64), mime);
        await addPhoto(database, ws, { transactionId, fileName: saved.fileName, mime, byteSize: saved.byteSize });
      } catch (e) {
        console.warn('The capture\u2019s picture was not kept', e);
        return;
      }
    }
    if (draft.imageFile) await native.deleteCaptureImage({ file: draft.imageFile }).catch(() => undefined);
  }

  /**
   * Records a draft finished on the Add form. The form is written back onto the draft first — `confirmDraft` reads
   * the row — and each field the owner corrected against what was read is shown to the source, so the next capture
   * from it is read right. The set-aside question was the form's own, asked the way Add asks it. Throws, so the form
   * shows what went wrong where Save was pressed.
   */
  async function recordForm(draft: DraftRow, form: FormDraft, opts: { setAside: SetAsideChoice | null; keepPhoto: boolean }) {
    setError(null);
    const patch = draftPatch(form, draft);
    for (const { field, value } of corrections(form, draft)) {
      await learnFromCorrection(database, draft.id, field, value).catch(() => undefined);
    }
    await editDraft(database, ws, draft.id, patch);
    const { transactionId, keptImage } = await confirmDraft(database, ws, draft.id, {
      setAside: opts.setAside,
      keepPhoto: opts.keepPhoto,
      extras: {
        eventId: form.eventId || null,
        channel: form.channel || null,
        excludedFromReport: form.excluded,
        mcc: form.mcc.trim() || null,
        photoIds: form.photoIds,
      },
    });
    await settlePicture(draft, transactionId, keptImage);
    resolved({ ...draft, description: patch.description }, 'recorded', transactionId);
  }

  /** Says a draft is not something to record. It stays, so the same capture is not offered again. */
  async function discard(draft: DraftRow, undoable = false) {
    await run(draft.id, async () => {
      await dismissDraft(database, ws, draft.id);
      // The capture's own copy of the picture goes with the resolution; nothing kept it.
      if (draft.imageFile) await native.deleteCaptureImage({ file: draft.imageFile }).catch(() => undefined);
      if (undoable) resolved(draft, 'discarded', null);
    });
  }

  /**
   * What a swipe right does. A draft the reader could not finish — no account, no destination, no figure — carries
   * a question of its own, and no gesture may answer it: the sheet opens on the row instead.
   */
  function swipeRecord(draft: DraftRow) {
    // A category is a question too: the row no longer prints it, but recording without one is refused all the same.
    const uncategorised = draft.kind !== 'transfer' && !draft.categoryAccountId;
    if (uncategorised || captureRowView(draft, sourceOf(draft)).needs.length > 0) setEditing(draft.id);
    else void record(draft, { undoable: true });
  }

  const list = drafts.data ?? [];
  const editingDraft = list.find((draft) => draft.id === editing) ?? null;

  /*
   * The phone's way into one draft is the Add transaction screen itself, filled in from what was read: it stands in
   * the list's place, ‹ goes back to the list, and the sheets it opens (the picture, the set-aside question) and the
   * toast it leaves are the page's own.
   */
  const overlays = (
    <>
      {viewing && (
        <CaptureViewer
          draft={viewing.draft}
          reading={(viewing.draft.reading as ReadingWithLines | null) ?? null}
          focus={viewing.focus}
          onClose={() => setViewing(null)}
        />
      )}

      {asking && (
        <SetAsideSheet
          door={asking.door}
          onSave={async (choice) => {
            const { transactionId, keptImage } = await confirmDraft(database, ws, asking.id, {
              setAside: choice,
              keepPhoto: asking.keepPhoto,
            });
            const draft = list.find((row) => row.id === asking.id);
            if (draft) await settlePicture(draft, transactionId, keptImage);
            await invalidate();
            if (asking.undoable && draft) resolved(draft, 'recorded', transactionId);
          }}
          onClose={() => setAsking(null)}
        />
      )}

      {toast && (
        <UndoToast
          text={toast.text}
          onUndo={() =>
            void run('undo', async () => {
              const takeBack = toast.undo;
              setToast(null);
              await takeBack();
            })
          }
          onDone={() => setToast(null)}
        />
      )}
    </>
  );

  if (editingDraft) {
    return (
      <div className={SCREEN}>
        <ErrorBox error={error} />
        <DraftSheet
          // A different draft is a different form: nothing typed for one may carry over to the next.
          key={editingDraft.id}
          draft={editingDraft}
          source={sourceOf(editingDraft)}
          onAnswerSource={(accountId) =>
            void run(editingDraft.id, async () => {
              const source = sourceOf(editingDraft);
              if (source) await setSourceAccount(database, source.id, accountId, ws.workspaceId);
              // A top-up's source is the wallet it landed in: the answer is the destination, not where it came from.
              await editDraft(database, ws, editingDraft.id, answerPatch(editingDraft, accountId));
            })
          }
          onUnmerge={() =>
            void run(editingDraft.id, async () => {
              await unmerge(database, ws, editingDraft.id);
              setEditing(null);
            })
          }
          onView={() => setViewing({ draft: editingDraft, focus: null })}
          onRecord={(form, opts) => recordForm(editingDraft, form, opts)}
          onDiscard={() => void discard(editingDraft, true)}
          onClose={() => setEditing(null)}
        />
        {overlays}
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      <LargeTitle
        title="Review"
        subtitle={
          list.length === 0
            ? undefined
            : phone
              ? `${list.length} waiting. Swipe right to record a row, left to discard it, or tap it to check it first.`
              : `${list.length} waiting. Nothing here has been recorded yet — check what was read, then confirm it.`
        }
        actions={[{ key: 'scan', label: 'Scan a receipt', glyph: <Camera size={20} aria-hidden />, run: () => void scan.scan() }]}
      />
      <ErrorBox error={error ?? scan.error ?? drafts.error} />

      {drafts.isSuccess && list.length === 0 && <Empty>Nothing waiting. Captured spending appears here before it reaches the accounts.</Empty>}

      {list.length > 0 && (
        <RecordTable
          records={list}
          rowTestId={() => 'draft-row'}
          /* A row opens the sheet on a phone, and the sheet holds what the row had no width for. A desktop reads
             the very same fields as columns and has nowhere to open. */
          detail={{ kind: 'screen', open: (draft) => setEditing(draft.id) }}
          rowSwipe={(draft) => ({
            onSwipeRight: () => swipeRecord(draft),
            rightHint: 'Record',
            leftAction: (
              <button
                type="button"
                aria-label={`Discard ${draft.description}`}
                onClick={() => void discard(draft, true)}
                className="w-[76px] bg-[var(--ph-ink-3)] text-[15px] font-semibold text-white"
              >
                Discard
              </button>
            ),
          })}
          shape={{
            key: (draft) => draft.id,
            title: (draft) => {
              const view = captureRowView(draft, sourceOf(draft));
              return (
                <>
                  {view.icon && <span aria-hidden>{view.icon} </span>}
                  {draft.description}
                  {draft.confidence !== null && draft.confidence < 80 && <span className="ml-2 text-[12.5px] font-normal text-[var(--ph-warn)]">unsure</span>}
                </>
              );
            },
            // Where it came from, and whether more than one sighting is folded into it — the sheet asks the rest.
            subtitle: (draft) => `${dayMonth(draft.occurredOn)} · ${captureRowView(draft, sourceOf(draft)).subtitle}`,
            value: (draft) => <Figure>{formatMinor(Math.abs(draft.amountMinor), draft.currency)}</Figure>,
            /* Everything a row says out loud; the buttons are the sheet's and the swipe's, and they are all a
               reader can reach than a row cannot print. */
            covers: ['date', 'description', 'amount', 'account', 'category'],
          }}
          columns={[
            { key: 'date', heading: 'Date', cell: (draft) => <span className="whitespace-nowrap">{draft.occurredOn}</span> },
            {
              key: 'description',
              heading: 'Description',
              cell: (draft) => {
                const view = captureRowView(draft, sourceOf(draft));
                return (
                  <span className={cx('block', busy === draft.id && 'opacity-50')}>
                    {view.icon && <span aria-hidden>{view.icon} </span>}
                    {draft.description}
                    {draft.confidence !== null && draft.confidence < 80 && <span className="ml-2 text-[12.5px] text-[var(--ph-warn)]">unsure</span>}
                    {/* Where it came from and how many sightings are folded in: the phone row's subtitle, as a line. */}
                    {view.icon && (
                      <span className="block text-[12.5px] text-[var(--ph-ink-2)]">
                        {draft.kind === 'transfer' ? `Transfer · ${view.subtitle}` : view.subtitle}
                      </span>
                    )}
                  </span>
                );
              },
            },
            {
              key: 'amount',
              heading: 'Amount',
              numeric: true,
              cell: (draft) => <Figure>{formatMinor(Math.abs(draft.amountMinor), draft.currency)}</Figure>,
            },
            {
              key: 'account',
              heading: 'Paid with',
              cell: (draft) => (
                <Select
                  aria-label={`Account for ${draft.description}`}
                  value={draft.accountId ?? ''}
                  onChange={(e) => void run(draft.id, () => editDraft(database, ws, draft.id, { accountId: e.target.value }))}
                  className="py-1"
                >
                  {/* A transfer's paying side is where the money left: its destination stands in the next column. */}
                  <option value="">{draft.kind === 'transfer' ? 'From…' : 'Choose…'}</option>
                  {money.map((account) => (
                    <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                  ))}
                </Select>
              ),
            },
            {
              key: 'category',
              heading: 'Category',
              cell: (draft) =>
                /* A transfer between the owner's own accounts is no spending: where it went stands where a category would. */
                draft.kind === 'transfer' ? (
                  <Select
                    aria-label={`To account for ${draft.description}`}
                    value={draft.toAccountId ?? ''}
                    onChange={(e) => void run(draft.id, () => editDraft(database, ws, draft.id, { toAccountId: e.target.value }))}
                    className="py-1"
                  >
                    <option value="">To…</option>
                    {money.map((account) => (
                      <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                    ))}
                  </Select>
                ) : (
                  <Select
                    aria-label={`Category for ${draft.description}`}
                    value={draft.categoryAccountId ?? ''}
                    onChange={(e) => void run(draft.id, () => editDraft(database, ws, draft.id, { categoryAccountId: e.target.value }))}
                    className="py-1"
                  >
                    {/* Confirming a draft records real spending, so it may only name the open workspace's categories. */}
                    <CategoryOptions accounts={accounts} kind={draft.amountMinor >= 0 ? 'expense' : 'income'} parentSuffix="(general)" />
                  </Select>
                ),
            },
            {
              key: 'actions',
              heading: '',
              cell: (draft) => (
                /* Glyphs at every width, the corner button's shape — the names they answer to are unchanged. */
                <span className="flex items-center justify-end gap-[6px] whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`Record ${draft.description}`}
                    disabled={busy !== null}
                    onClick={() => void record(draft)}
                    className="ph-focus flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-tint)] disabled:opacity-40"
                  >
                    <Check size={18} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Discard ${draft.description}`}
                    disabled={busy !== null}
                    onClick={() => void discard(draft)}
                    className="ph-focus flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-alarm)] disabled:opacity-40"
                  >
                    <X size={18} aria-hidden />
                  </button>
                </span>
              ),
            },
          ]}
        />
      )}

      <SkippedList />

      {overlays}
    </div>
  );
}
