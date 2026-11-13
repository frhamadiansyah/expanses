import { type CaptureLine, formatMinor, groupedMajorString, groupTypedAmount, isoDate, type ListOutcome, type ListRow, matchList, parseGroupedMajor, readTransactionList } from '@expanses/core';
import { type AccountRow, guessCategoryFromHistory, listTransactions, ownerScope, postTransactions, uncategorisedCategory } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Check, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { native } from '../../capture/native';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Button, cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, PickerRow, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { showToast } from '../../ui/Toast';
import { useOpeningDay } from '../accounts/queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { DateRow } from '../transactions/CardRows';
import { CategoryPicker } from '../transactions/CategoryPicker';
import { FormRows } from '../transactions/FormRow';
import { shortDate } from '../transactions/quick-row';
import { dropStatementBatch, statementBatch } from './batch';
import {
  addedToast,
  candidateOf,
  canRecord,
  listCounts,
  listInputs,
  type NewRow,
  newRowsFrom,
  recordLabel,
  type RowType,
  tickedRows,
  toggled,
  withEdit,
} from './list-model';

/** `/statement/list?account&batch`: the account the list belongs to, and lines already read (the picker, the share sheet). */
export interface ListSearch {
  account?: string;
  batch?: string;
}
export function listSearch(search: Record<string, unknown>): ListSearch {
  return { account: typeof search.account === 'string' ? search.account : undefined, batch: typeof search.batch === 'string' ? search.batch : undefined };
}

/** What the matcher and the lists need of a recorded entry. */
interface Recorded {
  on: string;
  description: string;
  amountMinor: number;
  direction: 'out' | 'in';
}

interface Checked {
  rows: ListRow[];
  outcomes: ListOutcome[];
  notOnList: string[];
  recorded: Map<string, Recorded>;
  emptyImages: number[];
}

type View = 'result' | 'recorded' | 'new' | 'differs' | 'notListed';

interface Shot {
  file: File;
  url: string;
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('That screenshot could not be opened'));
    reader.readAsDataURL(file);
  });
}

const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function ListCheckPage() {
  const { account: accountId = '', batch } = useSearch({ strict: false }) as ListSearch;
  const accounts = useAccounts();
  if (!accounts.isSuccess) return <div className={SCREEN}>Loading…</div>;
  const account = accounts.data.find((a) => a.id === accountId);
  if (!account)
    return (
      <div className={SCREEN}>
        <LargeTitle title="Check statement" back="Wallet" backTo="/wallet" />
        <Empty>This account is not in this workspace.</Empty>
      </div>
    );
  return <ListBody key={account.id} account={account} accounts={accounts.data} batch={batch} />;
}

function ListBody({ account, accounts, batch }: { account: AccountRow; accounts: AccountRow[]; batch?: string }) {
  const { database, ws } = useApp();
  const openingDay = useOpeningDay(account);
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const currency = account.currency ?? ws.baseCurrency;
  const held = useMemo(() => statementBatch(batch), [batch]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [view, setView] = useState<View>('result');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ note: string; amount: string; type: RowType; categoryId: string; otherAccountId: string; occurredOn: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [amountError, setAmountError] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  async function check(images: CaptureLine[][]) {
    const today = isoDate();
    const reading = readTransactionList(images, { today, currency });
    const days = reading.rows.map((r) => r.on).sort();
    const recorded = new Map<string, Recorded>();
    if (days.length > 0) {
      const views = await listTransactions(database, ownerScope(ws), { accountId: account.id, from: days[0], to: days[days.length - 1], limit: 5000 });
      for (const view of views) {
        const candidate = candidateOf(view, account.id);
        if (candidate) recorded.set(candidate.id, candidate);
      }
    }
    const candidates = [...recorded].map(([id, c]) => ({ id, ...c }));
    const { outcomes, notOnList } = matchList(reading.rows, candidates);
    const guesses: Record<number, string | null> = {};
    await Promise.all(
      outcomes.map(async (outcome, i) => {
        const row = reading.rows[i]!;
        if (outcome.status === 'new' && row.description) guesses[i] = await guessCategoryFromHistory(database, ws, row.description, row.direction === 'in' ? 'income' : 'expense');
      }),
    );
    setChecked({ rows: reading.rows, outcomes, notOnList, recorded, emptyImages: reading.emptyImages });
    setNewRows(newRowsFrom(reading.rows, outcomes, guesses));
    setView('result');
  }

  async function run() {
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
      await check(images);
      dropStatementBatch(batch);
    } catch (e) {
      setError(e);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  // Screenshots already read (the picker, the share sheet) go straight to the check.
  useEffect(() => {
    if (!held || started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = { back: account.name, backTo: '/accounts/$accountId' as const, backParams: { accountId: account.id } };

  if (!checked) {
    if (held) {
      return (
        <div className={SCREEN}>
          <LargeTitle title="Check statement" {...back} />
          <ErrorBox error={error} />
          {!error && (
            <p role="status" className="py-[24px] text-center text-[15px] text-[var(--ph-ink-2)]">
              Reading on this phone…
            </p>
          )}
        </div>
      );
    }
    return (
      <div className={SCREEN}>
        <LargeTitle title="Check statement" {...back} />
        <ErrorBox error={error} />
        <InsetGroup>
          <InsetRow title="Account" value={account.name} chevron={false} />
        </InsetGroup>
        <section className="mb-[18px]" aria-label="Screenshots">
          <h2 className="mb-[6px] flex justify-between px-[4px] text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
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
                  onClick={() => {
                    URL.revokeObjectURL(shot.url);
                    setShots((was) => was.filter((_, i) => i !== index));
                  }}
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
                const picked = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/') || f.type === '');
                setShots((was) => [...was, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
                e.target.value = '';
              }}
            />
          </div>
        </section>
        <p className="mx-[4px] mb-[14px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Add every page of the transaction list. Overlapping screenshots are fine; an entry seen twice counts once. The screenshots are read on this phone and deleted after the
          check.
        </p>
        {progress && (
          <p role="status" className="mb-[10px] text-center text-[15px] text-[var(--ph-ink-2)]">
            Reading {progress.at} of {progress.of} on this phone…
          </p>
        )}
        <InsetGroup>
          <InsetRow action title="Read" testId="list-read" disabled={busy || shots.length === 0} onClick={() => void run()} />
        </InsetGroup>
      </div>
    );
  }

  const { rows, outcomes, notOnList, recorded } = checked;
  const counts = listCounts(outcomes, notOnList);
  const days = rows.map((r) => r.on).sort();
  const range = days.length === 0 ? '' : days[0] === days[days.length - 1] ? dayMonth(days[0]!) : `${dayMonth(days[0]!)} – ${dayMonth(days[days.length - 1]!)}`;
  const money = (minor: number) => formatMinor(minor, currency);
  const toResult = { back: `${account.name} statement`, onBack: () => setView('result') };
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const today = isoDate();
  const others = moneyHolders(accounts).filter((a) => a.id !== account.id && a.archivedAt === null && (a.currency ?? ws.baseCurrency) === currency);

  async function record() {
    if (!canRecord(newRows) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ticked = tickedRows(newRows);
      const uncategorised = {
        expense: ticked.some((r) => r.type === 'expense' && !r.categoryId) ? await uncategorisedCategory(database, ws, 'expense') : '',
        income: ticked.some((r) => r.type === 'income' && !r.categoryId) ? await uncategorisedCategory(database, ws, 'income') : '',
      };
      // An account in another currency: the day's rate for each day recorded, asked before anything is written.
      const rates: Record<string, Record<string, number>> = {};
      if (currency !== ws.baseCurrency) {
        for (const day of new Set(ticked.map((r) => r.occurredOn))) {
          const found = await resolveRates([currency], day);
          if (found.missing.length > 0) throw new Error(`No ${found.missing[0]}→${ws.baseCurrency} rate for ${day}. Add it under Add more details on the Add screen.`);
          rates[day] = found.rates;
        }
      }
      const inputs = listInputs(newRows, { id: account.id, currency }, uncategorised, (day) => rates[day], openingDay);
      // One database transaction: all of the ticked rows land or none of them does.
      await postTransactions(database, ws, inputs);
      await invalidate();
      showToast(addedToast(inputs.length, counts.skipped));
      await navigate({ to: '/accounts/$accountId', params: { accountId: account.id }, replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  function open(row: NewRow) {
    setEditing(row.id);
    setAmountError('');
    setDraft({
      note: row.note,
      amount: groupedMajorString(row.amountMinor, currency),
      type: row.type,
      categoryId: row.categoryId,
      otherAccountId: row.otherAccountId,
      occurredOn: row.occurredOn,
    });
  }
  function closeSheet() {
    setEditing(null);
    setDraft(null);
    setPicking(false);
    setAmountError('');
  }
  function apply() {
    if (editing === null || !draft) return;
    let amountMinor: number;
    try {
      amountMinor = parseGroupedMajor(draft.amount, currency);
    } catch (e) {
      setAmountError(e instanceof Error ? e.message : 'Not an amount');
      return;
    }
    if (amountMinor <= 0) {
      setAmountError('An amount above zero');
      return;
    }
    setNewRows((was) =>
      withEdit(was, editing, { note: draft.note.trim(), amountMinor, type: draft.type, categoryId: draft.type === 'transfer' ? '' : draft.categoryId, otherAccountId: draft.otherAccountId, occurredOn: draft.occurredOn }),
    );
    closeSheet();
  }

  const subtitleOf = (row: NewRow) =>
    `${shortDate(row.occurredOn, today)} · ${row.type === 'transfer' ? (row.otherAccountId ? `${row.direction === 'out' ? 'To' : 'From'} ${nameOf(row.otherAccountId)}` : 'Choose the other account') : row.categoryId ? nameOf(row.categoryId) : 'Choose a category'}`;
  const signed = (row: NewRow) => `${(row.type === 'transfer' ? row.direction === 'in' : row.type === 'income') ? '+' : '−'}${money(row.amountMinor)}`;

  const editingRow = editing === null ? undefined : newRows.find((r) => r.id === editing);
  const bar = [
    { n: counts.recorded, tone: 'var(--ph-chevron)' },
    { n: counts.new, tone: 'var(--ph-ink)' },
    { n: counts.differs, tone: 'var(--ph-ink-3)' },
  ].filter((part) => part.n > 0);

  const listRows = (status: ListOutcome['status']) => outcomes.flatMap((o, i) => (o.status === status ? [{ row: rows[i]!, outcome: o, index: i }] : []));

  return (
    <div className={SCREEN}>
      {view === 'result' && <LargeTitle title={`${account.name} statement`} {...back} />}
      {view === 'recorded' && <LargeTitle title="Already recorded" {...toResult} />}
      {view === 'new' && <LargeTitle title={`New · ${newRows.length}`} {...toResult} />}
      {view === 'differs' && <LargeTitle title="Amount differs" {...toResult} />}
      {view === 'notListed' && <LargeTitle title="Recorded, not on this list" {...toResult} />}

      {view === 'result' && (
        <>
          <section data-testid="list-headline" className="mb-[18px] rounded-[11px] bg-[var(--ph-surface)] px-[16px] py-[14px]">
            <div className="flex items-baseline justify-between gap-[8px]">
              <span className="text-[13px] text-[var(--ph-ink-3)]">{range}</span>
              <span className="text-[17px] font-semibold text-[var(--ph-ink)]">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'} read
              </span>
            </div>
            {bar.length > 0 && (
              <div aria-hidden className="mt-[10px] flex h-[10px] gap-[2px] overflow-hidden rounded-[5px]">
                {bar.map((part) => (
                  <i key={part.tone} className="block h-full" style={{ width: `${(part.n / rows.length) * 100}%`, background: part.tone }} />
                ))}
              </div>
            )}
          </section>
          {checked.emptyImages.length > 0 && (
            <InsetGroup footer="Cropped or blurry, perhaps. Check again with it retaken to read its rows.">
              {checked.emptyImages.map((image) => (
                <InsetRow key={image} title={`Nothing read from screenshot ${image + 1}`} chevron={false} valueTone="warn" />
              ))}
            </InsetGroup>
          )}
          <ErrorBox error={error} />
          <InsetGroup header="Rows">
            <InsetRow testId="count-recorded" title="Already recorded" value={String(counts.recorded)} onClick={() => setView('recorded')} />
            <InsetRow testId="count-new" title="New — record here" value={String(counts.new)} onClick={() => setView('new')} />
            <InsetRow testId="count-differs" title="Amount differs" value={String(counts.differs)} onClick={() => setView('differs')} />
          </InsetGroup>
          <InsetGroup>
            <InsetRow testId="count-not-listed" title="Recorded, not on this list" value={String(counts.notOnList)} onClick={() => setView('notListed')} />
          </InsetGroup>
        </>
      )}

      {view === 'recorded' && (
        <InsetGroup>
          {listRows('recorded').length === 0 && <InsetRow title="None yet" chevron={false} />}
          {listRows('recorded').map(({ row, index }) => (
            <InsetRow key={index} testId="recorded-row" title={row.description} subtitle={shortDate(row.on, today)} value={`${row.direction === 'in' ? '+' : '−'}${money(row.amountMinor)}`} chevron={false} />
          ))}
        </InsetGroup>
      )}

      {view === 'differs' && (
        <InsetGroup footer="Recorded with another amount than the list shows. Open the entry on the account to change it.">
          {listRows('differs').length === 0 && <InsetRow title="None" chevron={false} />}
          {listRows('differs').map(({ row, outcome, index }) => (
            <InsetRow
              key={index}
              testId="differs-row"
              title={row.description}
              subtitle={`${shortDate(row.on, today)} · recorded ${outcome.status === 'differs' ? money(outcome.recordedMinor) : ''}`}
              value={`${row.direction === 'in' ? '+' : '−'}${money(row.amountMinor)}`}
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

      {view === 'notListed' && (
        <InsetGroup footer="Recorded on this account on the days the list covers, with no row to match.">
          {notOnList.length === 0 && <InsetRow title="None" chevron={false} />}
          {notOnList.map((id) => {
            const r = recorded.get(id);
            return r ? (
              <InsetRow key={id} testId="not-listed-row" title={r.description} subtitle={shortDate(r.on, today)} value={`${r.direction === 'in' ? '+' : '−'}${money(r.amountMinor)}`} chevron={false} />
            ) : null;
          })}
        </InsetGroup>
      )}

      {view === 'new' && (
        <>
          <ErrorBox error={error} />
          {newRows.length === 0 ? (
            <Empty>Nothing new on this list.</Empty>
          ) : (
            <>
              <h2 className="px-[13px] pb-[6px] text-[13px] leading-4 text-[var(--ph-ink-3)] uppercase">Tap a row to change it</h2>
              <div className="mb-[14px] overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*>.ph-row-body]:border-t-[0.5px] [&>*+*>.ph-row-body]:border-[var(--ph-hair)]">
                {newRows.map((row) => (
                  <div key={row.id} className={cx('flex items-center gap-3 pl-[14px]', !row.ticked && 'opacity-60')}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={row.ticked}
                      aria-label={`Record ${row.note || 'row'}`}
                      onClick={() => setNewRows((was) => toggled(was, row.id))}
                      className={cx(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                        row.ticked ? 'bg-[var(--ph-tint)] text-[var(--ph-surface)]' : 'ring-[1.5px] ring-slate-300 ring-inset',
                      )}
                    >
                      {row.ticked && <Check size={15} strokeWidth={3} aria-hidden />}
                    </button>
                    <button type="button" data-testid="new-row" onClick={() => open(row)} className="ph-focus-inset flex min-w-0 flex-1 items-center gap-3 text-left active:bg-[var(--ph-fill)]">
                      <CategoryIcon categoryId={row.type === 'transfer' ? null : row.categoryId || null} accounts={accounts} />
                      <span className="ph-row-body flex min-h-[60px] min-w-0 flex-1 items-center gap-2 pr-[14px]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[17px] leading-[22px] text-[var(--ph-ink)]">{row.note || 'No note'}</span>
                          <span className="block truncate text-[13px] leading-4 text-[var(--ph-ink-3)]">{subtitleOf(row)}</span>
                        </span>
                        <span className="tabular shrink-0 text-[16px] leading-[22px] text-[var(--ph-ink)]">{signed(row)}</span>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
              <Button data-testid="record-new" className="min-h-12 w-full text-[17px]" disabled={busy || !canRecord(newRows)} onClick={() => void record()}>
                {recordLabel(newRows)}
              </Button>
              <p className="mt-[6px] text-center text-[12.5px] text-[var(--ph-ink-3)]">Unchecked rows are left out</p>
            </>
          )}
        </>
      )}

      {editingRow && draft && !picking && (
        <Sheet grouped title={editingRow.note || 'Row'} onClose={closeSheet} confirm={{ label: 'Save row', run: apply }}>
          <div className="space-y-3 pb-2">
            <InsetGroup>
              <SelectRow
                label="Type"
                value={draft.type}
                onChange={(e) => {
                  const type = e.target.value as RowType;
                  setDraft({ ...draft, type, categoryId: type === draft.type ? draft.categoryId : '' });
                }}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </SelectRow>
              <TextRow
                label="Amount"
                prefix={currency}
                value={draft.amount}
                inputMode="decimal"
                placeholder="Amount"
                onChange={(e) => {
                  setAmountError('');
                  setDraft({ ...draft, amount: groupTypedAmount(e.target.value, currency) });
                }}
              />
              {draft.type === 'transfer' ? (
                <SelectRow label={editingRow.direction === 'out' ? 'To account' : 'From account'} value={draft.otherAccountId} onChange={(e) => setDraft({ ...draft, otherAccountId: e.target.value })}>
                  <option value="">Choose an account</option>
                  {others.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </SelectRow>
              ) : (
                <PickerRow label="Category" value={draft.categoryId ? nameOf(draft.categoryId) : ''} placeholder="Choose a category" onOpen={() => setPicking(true)} />
              )}
              <TextRow label="Note" value={draft.note} placeholder="Note" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </InsetGroup>
            {amountError && <p role="alert" className="px-[13px] text-[13px] leading-4 text-[var(--ph-alarm-ink)]">{amountError}</p>}
            <FormRows>
              <DateRow on={draft.occurredOn} onChange={(occurredOn) => setDraft({ ...draft, occurredOn })} />
            </FormRows>
          </div>
        </Sheet>
      )}
      {editingRow && draft && picking && draft.type !== 'transfer' && (
        <CategoryPicker
          kind={draft.type}
          lockKind
          value={draft.categoryId}
          onPick={(categoryId) => setDraft({ ...draft, categoryId })}
          // No category: recorded under Uncategorised (`listInputs`).
          {...(draft.categoryId ? { onNone: () => setDraft({ ...draft, categoryId: '' }) } : {})}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
