import { type CaptureLine, formatMinor, isoDate } from '@expanses/core';
import {
  type AccountRow,
  type CheckDecisions,
  type CheckDraftRow,
  fillSameMerchant,
  getCardTerms,
  listDrafts,
  listTransactions,
  NO_PREVIOUS_BALANCE_MESSAGE,
  ownerScope,
  type PreparedCheck,
  prepareStatementCheck,
  recordStatementCheck,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { native } from '../../capture/native';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN, TextRow } from '../../ui/native';
import { cycleBack } from '../cards/statement-dates';
import { dropStatementBatch, setCheckedNote, statementBatch } from './batch';
import { AskList, type CandidateInfo, type CheckList, CheckResult, DiffersList, FlaggedList, MatchedList } from './CheckResult';
import { canRecordAll, needsCategory, recordLabel, statementMonth } from './check-model';
import { MissingRows } from './MissingRows';

/** `/cards/$cardId/check?start&end&batch`: the period when the card page knows it, and lines already read (S2). */
export interface CheckSearch {
  start?: string;
  end?: string;
  /** Screenshots already read elsewhere (the share sheet), held by `holdStatementBatch`. */
  batch?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function checkSearch(search: Record<string, unknown>): CheckSearch {
  const date = (v: unknown) => (typeof v === 'string' && ISO.test(v) ? v : undefined);
  return { start: date(search.start), end: date(search.end), batch: typeof search.batch === 'string' ? search.batch : undefined };
}

const dayYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function CheckStatementPage() {
  const { cardId = '' } = useParams({ strict: false }) as { cardId?: string };
  const search = useSearch({ strict: false }) as CheckSearch;
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const terms = useQuery({ queryKey: ['card-terms', ws.workspaceId, cardId], queryFn: async () => (await getCardTerms(database, ws, cardId)) ?? null });
  if (!accounts.isSuccess || !terms.isSuccess) return <div className={SCREEN}>Loading…</div>;
  const card = accounts.data.find((a) => a.id === cardId);
  if (!card)
    return (
      <div className={SCREEN}>
        <LargeTitle title="Check statement" back="Cards" backTo="/cards" />
        <Empty>This card is not in this workspace.</Empty>
      </div>
    );
  const fallback = cycleBack(isoDate(), terms.data?.statementDay ?? 1, 1);
  return (
    <CheckBody
      card={card}
      accounts={accounts.data}
      initial={{ start: search.start ?? fallback.start, end: search.end ?? fallback.end }}
      batch={search.batch}
    />
  );
}

interface Shot {
  file: File;
  url: string;
}

/** A picked file's bytes as base64, for the phone to read. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('That screenshot could not be opened'));
    reader.readAsDataURL(file);
  });
}

const NO_DECISIONS: CheckDecisions = { differs: {}, flagged: {}, ask: {}, moveStart: false };

function CheckBody({ card, accounts, initial, batch }: { card: AccountRow; accounts: AccountRow[]; initial: { start: string; end: string }; batch?: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const currency = card.currency ?? ws.baseCurrency;
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [shots, setShots] = useState<Shot[]>([]);
  const held = useMemo(() => statementBatch(batch), [batch]);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [prepared, setPrepared] = useState<PreparedCheck | null>(null);
  const [rows, setRows] = useState<CheckDraftRow[]>([]);
  const [decisions, setDecisions] = useState<CheckDecisions>(NO_DECISIONS);
  const [guard, setGuard] = useState(false);
  const [view, setView] = useState<'result' | CheckList>('result');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // The thumbnails' object URLs go with the screen, whatever way it is left.
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const candidates = useQuery({
    queryKey: ['statement-candidates', ws.workspaceId, card.id, prepared?.period.start, prepared?.period.end],
    enabled: prepared !== null,
    queryFn: async () => {
      const period = prepared!.period;
      const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const map = new Map<string, CandidateInfo>();
      // The card's purchases from every workspace, as the check matched them.
      for (const view of await listTransactions(database, ownerScope(ws), { accountId: card.id, from: shift(period.start, -7), to: shift(period.end, 7), limit: 2000 })) {
        const onCard = view.entries.filter((e) => e.accountId === card.id).reduce((sum, e) => sum + e.amountMinor, 0);
        map.set(view.id, { on: view.occurredOn, description: view.description, amountMinor: Math.abs(onCard) });
      }
      for (const draft of await listDrafts(database, ws)) map.set(`draft:${draft.id}`, { on: draft.occurredOn, description: draft.description, amountMinor: Math.abs(draft.amountMinor) });
      return map;
    },
  });

  const count = held ? held.length : shots.length;
  const period = { start, end };
  const periodValid = ISO.test(start) && ISO.test(end) && start <= end;

  function add(files: FileList | null) {
    if (!files) return;
    const picked = [...files].filter((f) => f.type.startsWith('image/') || f.type === '');
    setShots((was) => [...was, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }
  function remove(index: number) {
    setShots((was) => {
      URL.revokeObjectURL(was[index]!.url);
      return was.filter((_, i) => i !== index);
    });
  }

  async function check() {
    setError(null);
    setBusy(true);
    try {
      let images: CaptureLine[][];
      if (held) images = held;
      else {
        images = [];
        for (const [index, shot] of shots.entries()) {
          setProgress({ at: index + 1, of: shots.length });
          const { lines } = await native.recognizeImage({ base64: await base64Of(shot.file) });
          images.push(lines);
        }
        // Read: the pictures and their bytes are let go of here, and only the lines stay, in memory.
        shots.forEach((s) => URL.revokeObjectURL(s.url));
        setShots([]);
      }
      setProgress(null);
      const result = await prepareStatementCheck(database, ws, { cardAccountId: card.id, period, images, today: isoDate() });
      dropStatementBatch(batch);
      setPrepared(result);
      setRows(result.rows);
      setDecisions(NO_DECISIONS);
      setView('result');
      // S10: older than the card's start in cicis, and the summary says what was owed before it. Without it, recording
      // waits for that screenshot. Either way today's balance stays as it is.
      setGuard(result.startsAfterPeriod && result.previousMinor !== null);
    } catch (e) {
      setError(e);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function record() {
    if (!prepared) return;
    setError(null);
    setBusy(true);
    try {
      const result = await recordStatementCheck(database, ws, { ...prepared, rows }, decisions);
      const month = statementMonth(prepared.period);
      setCheckedNote(
        result.status === 'reconciled'
          ? `${month} statement checked — ✓ Reconciled`
          : result.status === 'differs'
            ? `${month} statement checked — differs by ${formatMinor(Math.abs(result.differenceMinor), currency)}`
            : `${month} statement checked — add the summary to reconcile`,
      );
      await invalidate();
      await navigate({ to: '/cards/$cardId', params: { cardId: card.id }, search: { tab: 'statement' } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const back = { back: card.name, backTo: '/cards/$cardId' as const, backParams: { cardId: card.id }, backSearch: { tab: 'statement' as const } };

  if (!prepared) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Check statement" {...back} />
        <ErrorBox error={error} />
        <InsetGroup>
          <ReadOnlyRow label="Card" value={card.name} />
          <TextRow label="Statement from" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <TextRow label="Statement to" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </InsetGroup>
        {held ? (
          <InsetGroup header="Screenshots" trailing={String(held.length)}>
            <InsetRow title={`${held.length} screenshot${held.length === 1 ? '' : 's'} read on this phone`} chevron={false} />
          </InsetGroup>
        ) : (
          <section className="mb-[18px]" aria-label="Screenshots">
            <h2 className="mb-[6px] flex justify-between px-[16px] text-[12px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
              <span>Screenshots</span>
              <span>{shots.length}</span>
            </h2>
            <div className="flex flex-wrap gap-[8px]">
              {shots.map((shot, index) => (
                <div key={shot.url} data-testid="statement-shot" className="relative h-[120px] w-[64px] overflow-hidden rounded-[8px] bg-[var(--ph-surface)] ring-1 ring-[var(--ph-hair)]">
                  <img src={shot.url} alt={`Screenshot ${index + 1}`} className="h-full w-full object-cover object-top" />
                  <button
                    type="button"
                    aria-label={`Remove screenshot ${index + 1}`}
                    onClick={() => remove(index)}
                    className="ph-focus absolute top-[2px] right-[2px] flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[var(--ph-scrim)] text-white"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="ph-focus flex h-[120px] w-[64px] items-center justify-center rounded-[8px] border-[1.5px] border-dashed border-[var(--ph-chevron)] text-[var(--ph-ink-3)]"
                aria-label="Add screenshots"
              >
                <Plus size={22} aria-hidden />
              </button>
              <input
                ref={input}
                data-testid="statement-files"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  add(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </section>
        )}
        <p className="mx-[4px] mb-[14px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Add every page of transactions, and the summary with the new balance. Overlapping screenshots are fine — a row seen twice counts once. Read on this phone; the
          screenshots are deleted after the check.
        </p>
        {progress && (
          <p role="status" className="mb-[10px] text-center text-[15px] text-[var(--ph-ink-2)]">
            Reading {progress.at} of {progress.of} on this phone…
          </p>
        )}
        <Button className="min-h-12 w-full text-[17px]" disabled={busy || count === 0 || !periodValid} onClick={() => void check()}>
          Check {count} screenshot{count === 1 ? '' : 's'}
        </Button>
      </div>
    );
  }

  const missing = rows.filter((r) => r.outcome.status === 'missing');
  const gaps = missing.filter((r) => needsCategory(r) && r.categoryId === null).length;
  const asksOpen = rows.some((r) => r.outcome.status === 'ask' && decisions.ask[r.index] === undefined);
  const ready = canRecordAll(rows, decisions.ask) && !prepared.needsPreviousBalance;
  const footer = (
    <div className="mt-[6px] mb-[18px]">
      <Button data-testid="record-all" className="min-h-12 w-full text-[17px]" disabled={busy || !ready} onClick={() => void record()}>
        {missing.length === 0 ? 'Finish the check' : recordLabel(missing.length, gaps)}
      </Button>
      {prepared.needsPreviousBalance && (
        <p data-testid="needs-previous" className="mt-[6px] px-[4px] text-[12.5px] text-[var(--ph-warn)]">
          {NO_PREVIOUS_BALANCE_MESSAGE}
        </p>
      )}
      {asksOpen && <p className="mt-[6px] px-[4px] text-[12.5px] text-[var(--ph-warn)]">Choose the recorded transaction for each alike row first.</p>}
    </div>
  );
  const map = candidates.data ?? new Map<string, CandidateInfo>();
  const month = statementMonth(prepared.period);
  const year = prepared.period.start.slice(0, 4);
  const toResult = { back: `${month} statement`, onBack: () => setView('result') };
  const otherCards = accounts.filter((a) => a.id !== card.id && a.archivedAt === null && a.subtype === 'credit_card' && (a.currency ?? ws.baseCurrency) === currency);

  return (
    <div className={SCREEN}>
      {view === 'result' && <LargeTitle title={`${month} ${year} statement`} subtitle={`${dayYear(prepared.period.start)} – ${dayYear(prepared.period.end)}`} {...back} />}
      {view === 'missing' && <LargeTitle title={`${month} · ${missing.length} missing`} {...toResult} />}
      {view === 'matched' && <LargeTitle title="Matched" {...toResult} />}
      {view === 'differs' && <LargeTitle title="Amount differs" {...toResult} />}
      {view === 'flagged' && <LargeTitle title="Not on this statement" {...toResult} />}
      {view === 'ask' && <LargeTitle title="Which one was it?" {...toResult} />}
      <ErrorBox error={error ?? candidates.error} />

      {view === 'result' && <CheckResult prepared={prepared} rows={rows} ask={decisions.ask} onOpen={setView} footer={footer} />}
      {view === 'missing' && (
        <MissingRows
          rows={rows}
          currency={currency}
          cardName={card.name}
          accounts={accounts}
          onPick={(index, categoryId) => setRows((was) => fillSameMerchant(was, index, categoryId))}
          onCorrect={(index, patch) => setRows((was) => was.map((r) => (r.index === index ? { ...r, ...patch } : r)))}
          footer={footer}
        />
      )}
      {view === 'matched' && <MatchedList rows={rows} currency={currency} candidates={map} />}
      {view === 'differs' && (
        <DiffersList
          rows={rows}
          currency={currency}
          decisions={decisions.differs}
          onDecide={(index, answer) => setDecisions((d) => ({ ...d, differs: { ...d.differs, [index]: answer } }))}
        />
      )}
      {view === 'ask' && (
        <AskList
          rows={rows}
          currency={currency}
          ask={decisions.ask}
          candidates={map}
          onChoose={(index, id) => setDecisions((d) => ({ ...d, ask: { ...d.ask, [index]: id } }))}
        />
      )}
      {view === 'flagged' && (
        <FlaggedList
          prepared={prepared}
          rows={rows}
          ask={decisions.ask}
          candidates={map}
          otherCards={otherCards}
          decisions={decisions.flagged}
          onDecide={(id, answer) => setDecisions((d) => ({ ...d, flagged: { ...d.flagged, [id]: answer } }))}
        />
      )}

      {guard && prepared.previousMinor !== null && (
        <Sheet title="Before this card's start" onClose={() => setGuard(false)}>
          <p className="mb-[14px] text-[15px] text-[var(--ph-ink)]">
            Start this card on {dayYear(prepared.period.start)} with {formatMinor(prepared.previousMinor, currency)} owed?
          </p>
          <p className="mb-[14px] text-[12.5px] text-[var(--ph-ink-3)]">The balance today stays as it is; the history before the current start is filled from this statement.</p>
          <div className="flex flex-col gap-[8px]">
            <Button
              className="min-h-12"
              onClick={() => {
                setDecisions((d) => ({ ...d, moveStart: true }));
                setGuard(false);
              }}
            >
              Yes, start it there
            </Button>
            <Button
              variant="secondary"
              className="min-h-12"
              onClick={() => {
                setDecisions((d) => ({ ...d, moveStart: false }));
                setGuard(false);
              }}
            >
              No, keep the current start
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
