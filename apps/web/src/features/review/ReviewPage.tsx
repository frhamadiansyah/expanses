import { showToast } from '../../ui/Toast';
import { dayMonth, formatMinor } from '@expanses/core';
import {
  addPhoto,
  type CaptureSource,
  confirmDraft,
  moveIntoSharedEvent,
  ownerScope,
  sharedEventOf,
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
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Check, Camera, Images, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useBackToCashflow } from '../../app/from-search';
import { usePhone } from '../../app/use-phone';
import { captureBytes, native } from '../../capture/native';
import { nextWaitingStatement, onWaitingStatement } from '../../capture/statements';
import { useScanReceipt } from '../../capture/use-scan';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { photos } from '../../photos/store';
import { cx, Empty, ErrorBox, Select } from '../../ui';
import { type CornerAction, Figure, LargeTitle, PushedTitle, RecordTable, SCREEN } from '../../ui/native';
import { type ToastIcon, UndoToast } from '../../ui/UndoToast';
import { CategoryOptions } from '../cards/options';
import { type Door, spendingDoor } from '../goals/set-aside-question';
import { asksAboutSetAside, SetAsideSheet } from '../goals/SetAsideQuestion';
import { answerPatch, captureRowView, effectiveCategory, type ReadingWithLines } from './capture-view';
import { CaptureTypeMark } from './CaptureTypeMark';
import { CaptureViewer } from './CaptureViewer';
import { DraftDays } from './DraftDays';
import { DraftSheet } from './DraftSheet';
import { keepsPicture } from './keep-picture';
import { corrections, draftPatch, foreignPair, quickCharge, recordsOnForm } from './draft-form';
import { chargedFigure, type FormDraft } from '../transactions/tx-form';
import { useCaptureSources, useDraftCategoryGuesses, useDrafts } from './queries';
import { SkippedList } from './SkippedList';
import { useSharedEventSummaries } from '../events/shared-queries';
import { moveAfterSave, postTag, recordedIntoText } from '../transactions/shared-move';
import { useOpenBook } from '../workspaces/queries';
import type { SwipeAction, SwipeHint } from '../../ui/SwipeRow';

/** What a draft's account was charged, in the account's own currency, for a figure read in another one. */
type Charged = { amountMinor: number; currency: string };

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
  const queryClient = useQueryClient();
  const resolveRates = useResolveRates();
  const phone = usePhone();
  const drafts = useDrafts();
  const guesses = useDraftCategoryGuesses(drafts.data ?? []).data;
  const accounts = useAccounts().data ?? [];
  const sources = useCaptureSources().data ?? [];
  const sharedSummaries = useSharedEventSummaries().data ?? {};
  const openBook = useOpenBook();
  const scan = useScanReceipt();
  const navigate = useNavigate();
  // A section from the More sheet; a step down from Cashflow when Cashflow opened it.
  const backToCashflow = useBackToCashflow();
  /*
   * A single screenshot shared from Photos lands here (`cicis://review`), and the drain decides what it is: a
   * statement page waits for its card instead of becoming a draft. Whether the drain finishes before this screen
   * opens or after, the owner is handed on to the card picker, as several shared screenshots are.
   */
  useEffect(() => {
    const open = () => {
      const batch = nextWaitingStatement();
      if (batch) void navigate({ to: '/statement/shared', search: { batch }, replace: true });
    };
    open();
    return onWaitingStatement(open);
  }, [navigate]);
  // Confirming a draft records real spending, so the account it names has to be one that can pay.
  const money = moneyHolders(accounts).filter((a) => canPayWith(a));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The draft the phone's sheet is open on, by id — the row that was tapped. */
  // A draft the table sent here to be recorded on its form (a shared event's, fix round 1) opens at once.
  const { draft: openedDraft } = useSearch({ from: '/review' });
  const [editing, setEditing] = useState<string | null>(openedDraft ?? null);
  /** The full-screen picture, and the field it was opened at — null means "the picture as a whole". */
  const [viewing, setViewing] = useState<{ draft: DraftRow; focus: 'amount' | 'name' | 'date' | null } | null>(null);
  /** What the phone just did, and the way back — the bills list's own toast, for the same reason. */
  const [toast, setToast] = useState<{ text: string; icon: ToastIcon; undo: () => Promise<void>; expire?: () => Promise<void> } | null>(null);
  /*
   * What the toast does when it goes without Undo — a discarded capture's picture is dropped only then, so Undo brings
   * the draft back whole. Kept in a ref as well, so leaving the page (or a new toast) still does it.
   */
  const expiring = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => () => void expiring.current?.(), []);

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

  /**
   * Says what the phone just did, with the way back on the toast. A charge worked out from the day's rate is said
   * with it: nobody saw that figure before it posted.
   */
  function resolved(draft: DraftRow, what: 'recorded' | 'discarded', transactionId: string | null, expire?: () => Promise<void>, charged?: Charged | null) {
    setEditing(null);
    void expiring.current?.();
    expiring.current = expire ?? null;
    setToast({
      icon: what === 'recorded' ? 'recorded' : 'discarded',
      text: `${what === 'recorded' ? 'Recorded' : 'Discarded'} ${draft.description}${charged ? ` · ${formatMinor(charged.amountMinor, charged.currency)}` : ''}`,
      undo: () => undo(draft, transactionId),
      expire,
    });
  }

  /** A draft whose payment takes promised money: confirmed from the question's sheet once it is answered. */
  const [asking, setAsking] = useState<{ id: string; door: Door; undoable: boolean; keepPhoto: boolean; charged: Charged | null } | null>(null);

  /**
   * Fetches the day's rate for a draft read in a currency its account does not hold, when this device has none for
   * that day. A record gesture waits for it; a draft merely opened asks for it behind the form (`openDraft`), because
   * the owner asked for the charge to be worked out, and only the two currency codes and the day leave the device.
   * Null when the rates could not be read at all.
   */
  async function dayRates(draft: DraftRow, pair: { from: string; to: string }) {
    const rates = await resolveRates([pair.from, pair.to], draft.occurredOn).catch(() => null);
    // The form's "Charged in …" row reads what is stored, and is never asked twice: it has to hear that a rate just was.
    await queryClient.invalidateQueries({ queryKey: ['suggested-rate'] });
    return rates;
  }

  /**
   * Confirms the draft. A purchase that would take promised money gets its question first, in a sheet; money in
   * and transfers do not, because nothing about them is spending. The picture's fate is settled afterwards — see
   * `settlePicture`: the app's camera's picture is kept with the purchase, any other let go (`keepsPicture`).
   */
  async function record(draft: DraftRow, opts: { undoable?: boolean } = {}) {
    setError(null);
    // Captured in event mode for a shared event: recording moves it into the event, so it is done on the form, seen.
    if (recordsOnForm(draft, sharedSummaries)) {
      setEditing(draft.id);
      return;
    }
    const keepPhoto = keepsPicture(draft);
    // A category the row showed from the merchant's history is written onto the draft before it is recorded.
    const guessed = effectiveCategory(draft, guesses);
    if (guessed && !draft.categoryAccountId) {
      try {
        await editDraft(database, ws, draft.id, { categoryAccountId: guessed });
      } catch (e) {
        setError(e);
        return;
      }
    }
    /*
     * A figure in a currency the account does not hold posts as what the account was charged: worked out here at the
     * day's rate, as the form's own row would open on. Without that rate the form opens instead, and the row is typed.
     */
    let charged: Charged | null = null;
    const pair = foreignPair(draft, accounts);
    if (pair) {
      const charge = quickCharge(draft, pair, await dayRates(draft, pair), ws.baseCurrency);
      if (charge.kind === 'ask') {
        setEditing(draft.id);
        return;
      }
      charged = { amountMinor: charge.amountMinor, currency: charge.currency };
    }
    if (draft.kind === 'expense') {
      // The door weighs the money that leaves the account, in the account's own currency.
      const door = spendingDoor(draft.accountId ?? '', charged ? charged.amountMinor : Math.max(0, draft.amountMinor));
      let asks = false;
      try {
        asks = await asksAboutSetAside(database, ws, door);
      } catch (e) {
        setError(e);
        return;
      }
      if (asks) {
        setAsking({ id: draft.id, door: door!, undoable: opts.undoable ?? false, keepPhoto, charged });
        return;
      }
    }
    await run(draft.id, async () => {
      const { transactionId, keptImage } = await confirmDraft(database, ws, draft.id, { setAside: null, keepPhoto, charged });
      await settlePicture(draft, transactionId, keptImage);
      // A charge nobody saw before it posted is always said, with the way back, whichever button recorded it.
      if (opts.undoable || charged) resolved(draft, 'recorded', transactionId, undefined, charged);
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
  async function recordForm(draft: DraftRow, form: FormDraft, opts: { setAside: SetAsideChoice | null }) {
    setError(null);
    const patch = draftPatch(form, draft, accounts);
    // What the "Charged in …" row says, when the form shows one: the figure that posts, the draft's own kept beside it.
    const charged = chargedFigure(form, accounts);
    for (const { field, value } of corrections(form, draft, accounts)) {
      await learnFromCorrection(database, draft.id, field, value).catch(() => undefined);
    }
    await editDraft(database, ws, draft.id, patch);
    // Into a shared event the draft is recorded with no tag, then moved (fix round 1, H2): a move refused or failed
    // leaves an ordinary purchase in its workspace, seen, never one tagged to the event and not in it.
    const tag = postTag(form.eventId, !!form.eventId && !!sharedSummaries[form.eventId]);
    const { transactionId, keptImage, notMoved } = await confirmDraft(database, ws, draft.id, {
      setAside: opts.setAside,
      keepPhoto: keepsPicture(draft),
      charged,
      extras: {
        eventId: tag.eventId,
        channel: form.channel || null,
        excludedFromReport: form.excluded,
        mcc: form.mcc.trim() || null,
        photoIds: form.photoIds,
      },
    });
    await settlePicture(draft, transactionId, keptImage);
    /*
     * A shared event picked on the form — by hand, or already picked by event mode — moves the purchase into the event
     * now, as tagging a saved purchase into one does (shared events §6, D2). The form said so under its Event row.
     */
    if (tag.moveInto) {
      const target = await sharedEventOf(database, ownerScope(ws), tag.moveInto).catch(() => null);
      const notIn = await moveAfterSave(
        async () => {
          const wanted = [target?.currency, patch.currency, accounts.find((a) => a.id === patch.accountId)?.currency].filter((c): c is string => !!c);
          await resolveRates([...new Set(wanted)], patch.occurredOn).catch(() => undefined);
          return moveIntoSharedEvent(database, ownerScope(ws), tag.moveInto!, [transactionId]);
        },
        { bookName: openBook?.name ?? 'this workspace', eventName: target?.name ?? 'the event' },
      );
      await invalidate().catch(() => undefined);
      if (notIn === null) {
        // Moved: the event's record now, which an Undo here cannot take back — as Select → Add to event rules (M1).
        setEditing(null);
        showToast(recordedIntoText(patch.description, target?.name ?? 'the event'));
        return;
      }
      setError(new Error(notIn));
    }
    resolved({ ...draft, description: patch.description }, 'recorded', transactionId);
    // A shared workspace's spending moved into its shared event, or saved there with why not (sync gaps fix round 1).
    if (notMoved) showToast(notMoved);
  }

  /** Says a draft is not something to record. It stays, so the same capture is not offered again. */
  async function discard(draft: DraftRow, undoable = false) {
    await run(draft.id, async () => {
      await dismissDraft(database, ws, draft.id);
      // The capture's own copy of the picture goes with the resolution; nothing kept it. With Undo on offer it waits
      // for the toast to go, so Undo puts the draft back with its picture.
      const dropPicture = async () => {
        if (draft.imageFile) await native.deleteCaptureImage({ file: draft.imageFile }).catch(() => undefined);
      };
      if (undoable) resolved(draft, 'discarded', null, dropPicture);
      else await dropPicture();
    });
  }

  /**
   * What a swipe right does. A draft the reader could not finish — no account, no destination, no figure — carries
   * a question of its own, and no gesture may answer it: the sheet opens on the row instead.
   */
  function swipeRecord(draft: DraftRow) {
    // A category is a question too: the row no longer prints it, but recording without one is refused all the same.
    const uncategorised = draft.kind !== 'transfer' && !effectiveCategory(draft, guesses);
    // Captured in event mode for a shared event: recording moves it into the event, so it is done on the form, seen.
    const intoShared = recordsOnForm(draft, sharedSummaries);
    if (uncategorised || intoShared || captureRowView(draft, sourceOf(draft)).needs.length > 0) void openToFinish(draft);
    else void record(draft, { undoable: true });
  }

  /**
   * Opens the form on a draft a record gesture could not finish. For a figure in a currency its account does not
   * hold, the gesture asked for it to be recorded, so the day's rate is fetched first and the "Charged in …" row
   * opens on it.
   */
  async function openToFinish(draft: DraftRow) {
    const pair = foreignPair(draft, accounts);
    if (pair) await dayRates(draft, pair);
    setEditing(draft.id);
  }

  /**
   * Opens the form on a draft that was tapped. The form opens at once; for a figure in a currency its account does
   * not hold, the day's rate is fetched behind it, and the untouched "Charged in …" row fills when it arrives.
   */
  function openDraft(draft: DraftRow) {
    setEditing(draft.id);
    const pair = foreignPair(draft, accounts);
    if (pair) void dayRates(draft, pair);
  }

  /** What stands behind a row dragged left: Discard, undoable from the toast. */
  const discardActions = (draft: DraftRow): SwipeAction[] => [
    { label: 'Discard', name: `Discard ${draft.description}`, icon: Trash2, tone: 'destructive', onPress: () => void discard(draft, true) },
  ];
  /** What the ground under a right drag shows: letting go past the threshold records the draft. */
  const recordHint: SwipeHint = { label: 'Record', icon: Check, tone: 'positive' };

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
              charged: asking.charged,
            });
            const draft = list.find((row) => row.id === asking.id);
            if (draft) await settlePicture(draft, transactionId, keptImage);
            await invalidate();
            if ((asking.undoable || asking.charged) && draft) resolved(draft, 'recorded', transactionId, undefined, asking.charged);
          }}
          onClose={() => setAsking(null)}
        />
      )}

      {toast && (
        <UndoToast
          icon={toast.icon}
          text={toast.text}
          onUndo={() =>
            void run('undo', async () => {
              const takeBack = toast.undo;
              expiring.current = null;
              setToast(null);
              await takeBack();
            })
          }
          onDone={() => {
            expiring.current = null;
            void toast.expire?.();
            setToast(null);
          }}
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

  const scanActions: CornerAction[] = [
    {
      key: 'scan',
      label: 'Scan a receipt',
      glyph: <Camera size={20} aria-hidden />,
      // The camera for a receipt in hand; the library for a picture already taken — one receipt or payment
      // screen becomes a draft, a statement's screenshots go on to their card, as the share sheet sends them.
      menu: [
        { key: 'camera', label: 'Take photo', glyph: <Camera size={18} aria-hidden />, run: () => void scan.scan('camera') },
        { key: 'photos', label: 'Choose from Photos', glyph: <Images size={18} aria-hidden />, run: () => void scan.scan('photos') },
      ],
    },
  ];

  return (
    <div className={SCREEN}>
      {backToCashflow ? <PushedTitle title="Review" actions={scanActions} {...backToCashflow} /> : <LargeTitle title="Review" actions={scanActions} />}
      <ErrorBox error={error ?? scan.error ?? drafts.error} />

      {drafts.isSuccess && list.length === 0 && <Empty>Nothing waiting. Captured spending appears here before it reaches the accounts.</Empty>}

      {list.length > 0 && phone && (
        // A phone draws the queue as Cashflow draws the ledger: a card per day, each row headed by its category.
        <DraftDays
          drafts={list}
          accounts={accounts}
          sourceOf={sourceOf}
          busy={busy}
          onOpen={openDraft}
          onSwipeRight={swipeRecord}
          discardActions={discardActions}
          recordHint={recordHint}
          guesses={guesses}
        />
      )}

      {list.length > 0 && !phone && (
        <RecordTable
          records={list}
          rowTestId={() => 'draft-row'}
          /* A row opens the sheet on a phone, and the sheet holds what the row had no width for. A desktop reads
             the very same fields as columns and has nowhere to open. */
          detail={{ kind: 'screen', open: openDraft }}
          rowSwipe={(draft) => ({ onSwipeRight: () => swipeRecord(draft), rightHint: recordHint, leftActions: discardActions(draft) })}
          shape={{
            key: (draft) => draft.id,
            title: (draft) => {
              const view = captureRowView(draft, sourceOf(draft));
              return (
                <>
                  {view.type && <CaptureTypeMark type={view.type} />}
                  {draft.description}
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
                    {view.type && <CaptureTypeMark type={view.type} />}
                    {draft.description}
                    {/* Where it came from and how many sightings are folded in: the phone row's subtitle, as a line. */}
                    {view.type && (
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
