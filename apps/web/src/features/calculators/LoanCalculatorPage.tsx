import { formatMinor, groupedMajorString, groupTypedAmount, isoDate, parseGroupedMajor, yearlyRows } from '@expanses/core';
import { getLoanCalculatorDraft, saveLoanCalculatorDraft } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Table2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { cx, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, LargeTitle, Panel, PickerRow, ReadOnlyRow, SCREEN, SegmentedControl, SelectRow, TextRow } from '../../ui/native';
import { LOAN_CALCULATOR } from './catalogue';
import {
  asksFee,
  asksPrice,
  type CostDraft,
  type LoanCalcDraft,
  loanCalcDraftFrom,
  type LoanKind,
  type LoanKindDraft,
  LOAN_KINDS,
  loanWorking,
  type StageDraft,
} from './loan-calc-form';
import {
  cell,
  debtPrefill,
  feeLine,
  flatNote,
  halfRepaidText,
  incomeShare,
  interestOfLoan,
  jumpWarning,
  KIND_LABEL,
  KIND_TITLE,
  loanResult,
  priceVsPaid,
  principalLabel,
  stageRate,
  stageTitle,
  totalCaption,
  yearlyCostWarning,
} from './loan-calc-view';
import { refusal } from './parts';

export type LoanView = 'result' | 'schedule';
export interface LoanSearch {
  kind?: LoanKind;
  view?: LoanView;
  /** The debt Add debt's "Work it out first" came from, so Save as debt goes back to the same one. */
  item?: string;
}

/** `/calculators/loan`'s address: the kind, the page (inputs, result or the table), and the debt it came from. */
export function loanSearch(search: Record<string, unknown>): LoanSearch {
  const out: LoanSearch = {};
  if (LOAN_KINDS.includes(search.kind as LoanKind)) out.kind = search.kind as LoanKind;
  if (search.view === 'result' || search.view === 'schedule') out.view = search.view;
  if (typeof search.item === 'string' && search.item) out.item = search.item;
  return out;
}

/** How long typing pauses before the boxes are kept on the device. */
const KEEP_AFTER_MS = 600;

/**
 * The loan calculator: what a home, a vehicle, an online loan or any other loan costs in full before it is taken,
 * and Save as debt to add it with exactly those terms.
 *
 * Three pages on one address — the inputs, the result, and the table alone — so the boxes stay as typed between
 * them, and the browser's back walks them. The boxes are kept on the device as they change, as life cover's are.
 */
export function LoanCalculatorPage() {
  const { database, ws } = useApp();
  const [error, setError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const queryKey = ['loan-calculator', ws.workspaceId];
  const remembered = useQuery({ queryKey, queryFn: () => getLoanCalculatorDraft(database, ws) });
  if (!remembered.isSuccess) return <div className={SCREEN}>{remembered.error ? <ErrorBox error={remembered.error} /> : null}</div>;
  return (
    <LoanCalculator
      key={ws.workspaceId}
      initial={loanCalcDraftFrom(remembered.data)}
      error={error}
      keep={async (draft) => {
        try {
          await saveLoanCalculatorDraft(database, ws, draft as unknown as Record<string, unknown>);
          // Coming back to the page in the same session opens on what was kept, not on the first read.
          queryClient.setQueryData(queryKey, draft as unknown as Record<string, unknown>);
        } catch (e) {
          setError(e);
        }
      }}
    />
  );
}

function LoanCalculator({ initial, error, keep }: { initial: LoanCalcDraft; error: unknown; keep: (draft: LoanCalcDraft) => Promise<void> }) {
  const { ws } = useApp();
  const navigate = useNavigate();
  const search = loanSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const [draft, setDraft] = useState<LoanCalcDraft>(() => (search.kind ? { ...initial, kind: search.kind } : initial));
  const kind = draft.kind;
  const kindDraft = draft.drafts[kind];
  const today = isoDate();
  const working = loanWorking(kind, kindDraft, ws.baseCurrency, today);

  // Kept as they change, once typing pauses, and once more on the way out.
  const latest = useRef(draft);
  const pending = useRef(false);
  const keepRef = useRef(keep);
  keepRef.current = keep;
  useEffect(() => {
    if (draft === initial) return;
    latest.current = draft;
    pending.current = true;
    const timer = setTimeout(() => {
      pending.current = false;
      void keepRef.current(draft);
    }, KEEP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [draft, initial]);
  useEffect(
    () => () => {
      if (pending.current) void keepRef.current(latest.current);
    },
    [],
  );

  const setKindDraft = (patch: Partial<LoanKindDraft>) => setDraft((current) => ({ ...current, drafts: { ...current.drafts, [current.kind]: { ...current.drafts[current.kind], ...patch } } }));
  const flush = () => {
    if (!pending.current) return;
    pending.current = false;
    void keepRef.current(latest.current);
  };
  // Moving between the inputs, the result and the table keeps the boxes at once, as leaving the page does.
  const go = (view: LoanView | undefined) => {
    flush();
    void navigate({ to: '/calculators/loan', search: { kind, ...(view ? { view } : {}), ...(search.item ? { item: search.item } : {}) } });
  };

  const view = working.input ? search.view : undefined;
  if (view === 'schedule' && working.input) return <SchedulePage rows={loanResult(working.input).rows} onBack={() => go('result')} />;
  if (view === 'result' && working.input && working.facts) {
    return (
      <ResultPage
        kind={kind}
        working={{ input: working.input, facts: working.facts }}
        onBack={() => go(undefined)}
        onTable={() => go('schedule')}
        onSave={() => {
          flush();
          void navigate({ to: '/debts/new', search: { calc: debtPrefill(kind, working.input!, ws.baseCurrency, search.item) } });
        }}
      />
    );
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title={LOAN_CALCULATOR.label} back="Calculators" backTo="/calculators" />
      <ErrorBox error={error} />
      <SegmentedControl
        label="Kind of loan"
        className="mb-[14px]"
        segments={LOAN_KINDS.map((key) => ({ key, label: KIND_LABEL[key] }))}
        value={kind}
        onChange={(key) => {
          setDraft((current) => ({ ...current, kind: key as LoanKind }));
          void navigate({ to: '/calculators/loan', search: { kind: key as LoanKind, ...(search.item ? { item: search.item } : {}) }, replace: true });
        }}
      />
      <LoanInputs kind={kind} draft={kindDraft} problems={working.problems} loanMinor={working.loanMinor} set={setKindDraft} />
      <InsetGroup>
        <InsetRow title="See result" action onClick={() => working.input && go('result')} className={working.input ? undefined : 'opacity-40'} />
      </InsetGroup>
    </div>
  );
}

/** A box typed as a percentage of something or as an amount, with a switch between the two and the other one shown under it. */
function ShareRow({
  label,
  value,
  as,
  ofMinor,
  problem,
  onChange,
}: {
  label: string;
  value: string;
  as: 'percent' | 'amount';
  /** What the percentage is of: the price, the loan. */
  ofMinor: number | null;
  problem?: string;
  onChange: (value: string, as: 'percent' | 'amount') => void;
}) {
  const { ws } = useApp();
  const currency = ws.baseCurrency;
  const read = (): number | null => {
    try {
      if (value.trim() === '') return null;
      if (as === 'amount') return parseGroupedMajor(value, currency);
      const percent = Number(value.trim().replace(',', '.'));
      return Number.isFinite(percent) && ofMinor !== null ? Math.round((ofMinor * percent) / 100) : null;
    } catch {
      return null;
    }
  };
  const minor = read();
  const other =
    minor === null || ofMinor === null || !(ofMinor > 0)
      ? undefined
      : as === 'percent'
        ? formatMinor(minor, currency)
        : `${(Math.round((minor * 10_000) / ofMinor) / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
  // Switching keeps the same figure, written the other way.
  const flip = () => {
    const next = as === 'percent' ? 'amount' : 'percent';
    if (minor === null || ofMinor === null || !(ofMinor > 0)) return onChange('', next);
    onChange(next === 'amount' ? groupedMajorString(minor, currency) : String(Math.round((minor * 10_000) / ofMinor) / 100).replace('.', ','), next);
  };
  return (
    <TextRow
      label={label}
      value={value}
      inputMode="decimal"
      prefix={as === 'amount' ? currency : undefined}
      suffix={as === 'percent' ? '%' : undefined}
      placeholder={as === 'percent' ? 'Percent' : 'Amount'}
      hint={refusal(problem, other)}
      onChange={(e) => onChange(as === 'amount' ? groupTypedAmount(e.target.value, currency) : e.target.value, as)}
      trailing={
        <button
          type="button"
          onClick={flip}
          aria-label={as === 'percent' ? `${label} as an amount` : `${label} as a percentage`}
          className="ph-focus ml-[6px] shrink-0 rounded-full bg-[var(--ph-fill)] px-[9px] py-[3px] text-[12.5px] leading-[16px] font-semibold text-[var(--ph-ink-2)]"
        >
          {as === 'percent' ? currency : '%'}
        </button>
      }
    />
  );
}

/** The boxes each kind asks for, in the order that loan is quoted. */
function LoanInputs({
  kind,
  draft,
  problems,
  loanMinor,
  set,
}: {
  kind: LoanKind;
  draft: LoanKindDraft;
  problems: Record<string, string>;
  loanMinor: number | null;
  set: (patch: Partial<LoanKindDraft>) => void;
}) {
  const { ws } = useApp();
  const currency = ws.baseCurrency;
  const [stageOpen, setStageOpen] = useState<number | null>(null);
  const [costsOpen, setCostsOpen] = useState(false);
  const money = (key: 'price' | 'amount' | 'income') => (e: { target: { value: string } }) => set({ [key]: groupTypedAmount(e.target.value, currency) });
  const priceMinor = (() => {
    try {
      return draft.price.trim() ? parseGroupedMajor(draft.price, currency) : null;
    } catch {
      return null;
    }
  })();
  const priced = asksPrice(kind) && draft.price.trim() !== '';
  const costsSummary = draft.costs.filter((cost) => cost.amount.trim() !== '').length;
  const costsLabel = kind === 'vehicle' ? 'Admin and insurance' : 'Upfront costs';

  return (
    <>
      <InsetGroup>
        {asksPrice(kind) && (
          <TextRow
            label={kind === 'home' ? 'House price' : 'Vehicle price'}
            prefix={currency}
            value={draft.price}
            onChange={money('price')}
            inputMode="decimal"
            placeholder="Amount"
            hint={refusal(problems.price)}
          />
        )}
        {asksPrice(kind) && (
          <ShareRow label="Down payment" value={draft.down} as={draft.downAs} ofMinor={priceMinor} problem={problems.down} onChange={(down, downAs) => set({ down, downAs })} />
        )}
        {/* The loan follows the price and down payment; with no price it is typed. */}
        {priced ? (
          <ReadOnlyRow label="Loan" value={loanMinor !== null ? formatMinor(loanMinor, currency) : null} testId="loan-amount" />
        ) : (
          <TextRow
            label={asksPrice(kind) ? 'Loan' : 'Amount'}
            prefix={currency}
            value={draft.amount}
            onChange={money('amount')}
            inputMode="decimal"
            placeholder="Amount"
            hint={refusal(problems.amount)}
          />
        )}
        {kind === 'home' ? (
          <TextRow label="Years" value={draft.years} onChange={(e) => set({ years: e.target.value })} inputMode="numeric" placeholder="Years" hint={refusal(problems.years)} />
        ) : (
          <TextRow label="Months" value={draft.months} onChange={(e) => set({ months: e.target.value })} inputMode="numeric" placeholder="Months" hint={refusal(problems.months)} />
        )}
        {kind !== 'home' && (
          <TextRow
            label={kind === 'online' ? 'Interest' : 'Rate'}
            value={draft.rate}
            onChange={(e) => set({ rate: e.target.value })}
            inputMode="decimal"
            placeholder="Percent"
            suffix={kind === 'online' ? '% a month' : kind === 'vehicle' ? '% a year, flat' : '% a year'}
            hint={refusal(problems.rate)}
          />
        )}
        {kind === 'other' && (
          <SelectRow label="Interest charged" value={draft.flat ? 'flat' : 'owed'} onChange={(e) => set({ flat: e.target.value === 'flat' })}>
            <option value="owed">On what is owed</option>
            <option value="flat">Flat, on the whole loan</option>
          </SelectRow>
        )}
        {asksFee(kind) && (
          <ShareRow label="Fee at the start" value={draft.fee} as={draft.feeAs} ofMinor={loanMinor} problem={problems.fee} onChange={(fee, feeAs) => set({ fee, feeAs })} />
        )}
        {kind === 'vehicle' && (
          <PickerRow label={costsLabel} value={costsSummary > 0 ? costsTotal(draft.costs, currency) : null} placeholder="Optional" onOpen={() => setCostsOpen(true)} />
        )}
      </InsetGroup>

      {kind === 'home' && (
        <InsetGroup header="Rate stages">
          {draft.stages.map((stage, index) => (
            <InsetRow
              key={index}
              testId="rate-stage"
              icon={<span className={cx('text-[12px] font-bold', stage.kind === 'floating' ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink)]')}>{index + 1}</span>}
              title={stage.kind === 'fixed' ? 'Fixed' : 'Floating'}
              subtitle={refusal(problems[`stage${index + 1}.years`] ?? problems[`stage${index + 1}.rate`], stageWhen(draft.stages, index, draft.years))}
              value={stage.rate.trim() ? `${stage.rate.trim()}% a year` : 'Rate'}
              valueTone={stage.rate.trim() ? 'ink' : 'ink-3'}
              onClick={() => setStageOpen(index)}
            />
          ))}
          <InsetRow
            title={<span className="font-normal text-[var(--ph-tint)]">＋ Add stage</span>}
            label="Add stage"
            chevron={false}
            onClick={() => {
              // A new stage goes before the last, which keeps running to the end of the loan.
              const at = Math.max(0, draft.stages.length - 1);
              set({ stages: [...draft.stages.slice(0, at), { kind: 'fixed', years: '', rate: '' }, ...draft.stages.slice(at)] });
              setStageOpen(at);
            }}
          />
        </InsetGroup>
      )}

      <InsetGroup header="Optional">
        <TextRow label="Monthly income" prefix={currency} value={draft.income} onChange={money('income')} inputMode="decimal" placeholder="Amount" hint={refusal(problems.income)} />
        {kind === 'home' && (
          <PickerRow label={costsLabel} value={costsSummary > 0 ? costsTotal(draft.costs, currency) : null} placeholder="Fees, insurance" onOpen={() => setCostsOpen(true)} />
        )}
      </InsetGroup>

      {stageOpen !== null && draft.stages[stageOpen] && (
        <StageSheet
          stage={draft.stages[stageOpen]!}
          last={stageOpen === draft.stages.length - 1}
          only={draft.stages.length === 1}
          problems={{ years: problems[`stage${stageOpen + 1}.years`], rate: problems[`stage${stageOpen + 1}.rate`] }}
          onChange={(stage) => set({ stages: draft.stages.map((current, index) => (index === stageOpen ? stage : current)) })}
          onRemove={() => {
            set({ stages: draft.stages.filter((_, index) => index !== stageOpen) });
            setStageOpen(null);
          }}
          onClose={() => setStageOpen(null)}
        />
      )}
      {costsOpen && <CostsSheet title={costsLabel} costs={draft.costs} onChange={(costs) => set({ costs })} onClose={() => setCostsOpen(false)} />}
    </>
  );
}

function costsTotal(costs: readonly CostDraft[], currency: string): string {
  let total = 0;
  for (const cost of costs) {
    try {
      total += cost.amount.trim() ? parseGroupedMajor(cost.amount, currency) : 0;
    } catch {
      // A cost that does not read says so in the sheet; the summary counts the rest.
    }
  }
  return formatMinor(total, currency);
}

/** When a stage runs: "first 3 years", "years 4–5", "remaining 17 years", "the whole loan". */
function stageWhen(stages: readonly StageDraft[], index: number, yearsTyped: string): string {
  const years = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
  const plural = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;
  if (stages.length === 1) return 'the whole loan';
  const before = stages.slice(0, index).map((stage) => years(stage.years));
  const known = before.every((value) => value !== null);
  const start = known ? (before as number[]).reduce((total, value) => total + value, 0) : null;
  if (index === stages.length - 1) {
    const total = years(yearsTyped);
    return start !== null && total !== null && total > start ? `remaining ${plural(total - start)}` : 'the rest of the loan';
  }
  const own = years(stages[index]!.years);
  if (own === null) return 'how many years';
  if (index === 0) return `first ${plural(own)}`;
  return start !== null ? `years ${start + 1}–${start + own}` : plural(own);
}

/** One rate stage: fixed or floating, how many years (the last stage runs to the end), and its rate a year. */
function StageSheet({
  stage,
  last,
  only,
  problems,
  onChange,
  onRemove,
  onClose,
}: {
  stage: StageDraft;
  last: boolean;
  only: boolean;
  problems: { years?: string; rate?: string };
  onChange: (stage: StageDraft) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet grouped title="Rate stage" onClose={onClose} confirm={{ label: 'Done', run: onClose }}>
      <InsetGroup footer={last ? 'The last stage runs to the end of the loan.' : undefined}>
        <SelectRow label="Kind" value={stage.kind} onChange={(e) => onChange({ ...stage, kind: e.target.value as StageDraft['kind'] })}>
          <option value="fixed">Fixed</option>
          <option value="floating">Floating</option>
        </SelectRow>
        {!last && (
          <TextRow label="Years" value={stage.years} onChange={(e) => onChange({ ...stage, years: e.target.value })} inputMode="numeric" placeholder="Years" hint={refusal(problems.years)} />
        )}
        <TextRow
          label="Rate"
          value={stage.rate}
          onChange={(e) => onChange({ ...stage, rate: e.target.value })}
          inputMode="decimal"
          placeholder="Percent"
          suffix="% a year"
          hint={refusal(problems.rate)}
        />
      </InsetGroup>
      {!only && (
        <InsetGroup>
          <DestructiveRow label="Remove stage" onClick={onRemove} />
        </InsetGroup>
      )}
    </Sheet>
  );
}

/** Costs paid at the start beside the loan, each named; counted in everything paid. */
function CostsSheet({ title, costs, onChange, onClose }: { title: string; costs: CostDraft[]; onChange: (costs: CostDraft[]) => void; onClose: () => void }) {
  const { ws } = useApp();
  const edit = (index: number, patch: Partial<CostDraft>) => onChange(costs.map((cost, at) => (at === index ? { ...cost, ...patch } : cost)));
  return (
    <Sheet grouped title={title} onClose={onClose} confirm={{ label: 'Done', run: onClose }}>
      {costs.map((cost, index) => (
        <InsetGroup key={index}>
          <TextRow label="What" value={cost.name} onChange={(e) => edit(index, { name: e.target.value })} placeholder="Name" />
          <TextRow
            label="Amount"
            prefix={ws.baseCurrency}
            value={cost.amount}
            onChange={(e) => edit(index, { amount: groupTypedAmount(e.target.value, ws.baseCurrency) })}
            inputMode="decimal"
            placeholder="Amount"
          />
          <DestructiveRow label="Remove" onClick={() => onChange(costs.filter((_, at) => at !== index))} />
        </InsetGroup>
      ))}
      <InsetGroup footer="Paid at the start beside the loan, and counted in everything paid.">
        <InsetRow title="Add cost" action onClick={() => onChange([...costs, { name: '', amount: '' }])} />
      </InsetGroup>
    </Sheet>
  );
}

/** A two-or-more part bar: each part its share of the whole, a hair of gap between. */
function SplitBar({ parts, label }: { parts: { minor: number; colour: string }[]; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex h-[12px] gap-[2px] overflow-hidden rounded-full">
      {parts
        .filter((part) => part.minor > 0)
        .map((part, index) => (
          <i key={index} className="block" style={{ flex: part.minor, background: part.colour }} />
        ))}
    </div>
  );
}

const BLUE = 'var(--ph-tint)';
const ORANGE = 'var(--ph-warn)';
const GREY = 'var(--ph-ink-3)';
const Dot = ({ colour }: { colour: string }) => <span aria-hidden className="mr-[5px] inline-block h-[8px] w-[8px] rounded-full align-[1px]" style={{ background: colour }} />;

/** A tinted note inside the card: amber for a warning, red for an alarm, blue for an explanation. */
function Note({ tone, children, testId }: { tone: 'warn' | 'alarm' | 'info'; children: ReactNode; testId?: string }) {
  return (
    <p
      data-testid={testId}
      className="mt-[12px] rounded-[10px] px-[12px] py-[9px] text-[13px] leading-[18px]"
      style={{ background: `var(--ph-${tone}-panel)`, color: `var(--ph-${tone}-ink)` }}
    >
      {children}
    </p>
  );
}

/** The result: one card with the totals and every rate stage, then what it means, then Save as debt. */
function ResultPage({
  kind,
  working: { input, facts },
  onBack,
  onTable,
  onSave,
}: {
  kind: LoanKind;
  working: { input: NonNullable<ReturnType<typeof loanWorking>['input']>; facts: NonNullable<ReturnType<typeof loanWorking>['facts']> };
  onBack: () => void;
  onTable: () => void;
  onSave: () => void;
}) {
  const { ws } = useApp();
  const currency = ws.baseCurrency;
  const result = loanResult(input);
  const months = result.rows.length;
  const jump = jumpWarning(result.jump, currency);
  const flat = flatNote(input, kind);
  const fee = asksFee(kind) ? feeLine(facts, result.interestMinor, currency) : null;
  const yearly = asksFee(kind) && (kind === 'online' || facts.feeMinor > 0) ? yearlyCostWarning(facts, result.rows, currency) : null;
  const paid = priceVsPaid(kind, facts, result.interestMinor, currency);
  const share = incomeShare(result.lines, facts.incomeMinor);
  const half = halfRepaidText(result.halfMonth);
  const interestShare = interestOfLoan(result);
  const PART_COLOUR = { down: GREY, costs: 'var(--ph-ink-2)', loan: BLUE, interest: ORANGE } as const;
  const bandColour = share?.band === 'comfortable' ? 'up' : share?.band === 'stretched' ? 'warn' : 'alarm';

  return (
    <div className={SCREEN}>
      <LargeTitle
        title={KIND_TITLE[kind]}
        back="Inputs"
        onBack={onBack}
        actions={[{ key: 'table', label: 'Table', glyph: <Table2 size={20} aria-hidden />, run: onTable }]}
      />
      <Panel testId="loan-hero">
        <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{totalCaption(kind, months)}</p>
        <p className="tabular text-[30px] leading-[36px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="loan-total">
          {formatMinor(result.totalPaidMinor, currency)}
        </p>
        <div className="mt-[12px] mb-[10px]">
          <SplitBar
            label={`${result.principalPercent}% principal, ${result.interestPercent}% interest`}
            parts={[
              { minor: result.principalMinor, colour: BLUE },
              { minor: result.interestMinor, colour: ORANGE },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <div>
            <p className="text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
              <Dot colour={BLUE} />
              {principalLabel(kind, result.principalPercent)}
            </p>
            <p className="tabular mt-[2px] text-[17px] leading-[22px] font-semibold text-[var(--ph-ink)]">{formatMinor(result.principalMinor, currency)}</p>
          </div>
          <div className="text-right">
            <p className="text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
              <Dot colour={ORANGE} />
              {`Interest · ${result.interestPercent}%`}
            </p>
            <p className="tabular mt-[2px] text-[17px] leading-[22px] font-semibold text-[var(--ph-ink)]" data-testid="loan-interest">
              {formatMinor(result.interestMinor, currency)}
            </p>
          </div>
        </div>
        {interestShare && kind !== 'online' && <p className="mt-[10px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{interestShare}</p>}
        {fee && (
          <p className="mt-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="loan-fee">
            <Dot colour={GREY} />
            {fee}
          </p>
        )}
        <div className="mt-[14px] border-t-[0.5px] border-[var(--ph-hair)]">
          {result.lines.map((line) => {
            const title = stageTitle(line, kind);
            return (
              <div key={line.fromMonth} data-testid="loan-stage" className="flex items-center justify-between gap-3 border-b-[0.5px] border-[var(--ph-hair)] py-[10px] last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-[15px] leading-[20px] text-[var(--ph-ink)]">
                    {title.months}
                    {title.years && <span className="text-[12.5px] text-[var(--ph-ink-3)]">{` · ${title.years}`}</span>}
                  </p>
                  <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{stageRate(line, kind, input.method)}</p>
                </div>
                <span className="tabular shrink-0 text-[15px] text-[var(--ph-ink)]">{formatMinor(line.paymentMinor, currency)}</span>
              </div>
            );
          })}
        </div>
        {jump && (
          <Note tone="warn" testId="loan-jump">
            {jump}
          </Note>
        )}
        {flat && (
          <Note tone="info" testId="loan-flat">
            {flat.lead}
            <b>{flat.figure}</b>
            {flat.tail}
          </Note>
        )}
        {yearly && (
          <Note tone={kind === 'online' ? 'alarm' : 'info'} testId="loan-yearly-cost">
            {yearly.lead}
            <b>{yearly.figure}</b>
            {yearly.tail}
          </Note>
        )}
      </Panel>

      {(paid || share || half) && (
        <Panel testId="loan-insights">
          {paid && (
            <div className="mb-[12px] border-b-[0.5px] border-[var(--ph-hair)] pb-[12px] last:mb-0 last:border-b-0 last:pb-0">
              <p className="mb-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{paid.caption}</p>
              <SplitBar label={paid.caption} parts={paid.parts.map((part) => ({ minor: part.minor, colour: PART_COLOUR[part.key] }))} />
              <ul className="mt-[8px] space-y-[2px] text-[12.5px] leading-[17px] text-[var(--ph-ink-2)]">
                {paid.parts.map((part) => (
                  <li key={part.key} className="flex justify-between gap-3">
                    <span>
                      <Dot colour={PART_COLOUR[part.key]} />
                      {part.label}
                    </span>
                    <span className="tabular">{formatMinor(part.minor, currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{paid.total}</p>
            </div>
          )}
          {share && (
            <div className="mb-[12px] border-b-[0.5px] border-[var(--ph-hair)] pb-[12px] last:mb-0 last:border-b-0 last:pb-0" data-testid="loan-income">
              <div className="flex items-center justify-between">
                <span className="text-[15px] text-[var(--ph-ink)]">Share of income</span>
                <span
                  className="rounded-[5px] px-[6px] py-[1px] text-[11.5px] font-semibold"
                  style={{ background: `var(--ph-${bandColour}-panel)`, color: `var(--ph-${bandColour}-ink)` }}
                >
                  {share.tag}
                </span>
              </div>
              <div className="mt-[5px] h-[5px] overflow-hidden rounded-full bg-[var(--ph-track)]">
                <i className="block h-full rounded-full" style={{ width: `${share.widthPercent}%`, background: `var(--ph-${bandColour})` }} />
              </div>
              <p className="mt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{share.note}</p>
            </div>
          )}
          {half && (
            <div className="flex justify-between gap-3" data-testid="loan-half">
              <span className="text-[15px] text-[var(--ph-ink)]">Half of the loan repaid</span>
              <span className="tabular text-[15px] text-[var(--ph-ink)]">
                {half.month} <span className="text-[12.5px] text-[var(--ph-ink-3)]">{half.year}</span>
              </span>
            </div>
          )}
        </Panel>
      )}

      <InsetGroup>
        <InsetRow title="Save as debt" action onClick={onSave} />
      </InsetGroup>
    </div>
  );
}

/**
 * The table and nothing else: every month (or every year), # · Payment · Principal · Interest · Left, the header row
 * held under the bar while the months scroll past. No totals: the result page has them.
 */
function SchedulePage({ rows, onBack }: { rows: ReturnType<typeof loanResult>['rows']; onBack: () => void }) {
  const { ws } = useApp();
  const [yearly, setYearly] = useState(false);
  const shown = yearly ? yearlyRows(rows) : rows.map((row, index) => ({ index: index + 1, ...row }));
  const currency = ws.baseCurrency;
  const head = 'sticky top-[calc(env(safe-area-inset-top)+44px)] z-[1] bg-[var(--ph-surface)] md:top-0';
  return (
    <div className={SCREEN}>
      <LargeTitle title="Schedule" back="Result" onBack={onBack} />
      <SegmentedControl
        label="Period"
        className="mb-[10px]"
        segments={[
          { key: 'monthly', label: 'Monthly' },
          { key: 'yearly', label: 'Yearly' },
        ]}
        value={yearly ? 'yearly' : 'monthly'}
        onChange={(key) => setYearly(key === 'yearly')}
      />
      {/* `clip`, not `hidden`: the corners are rounded without making a scroll box, so the header row can stick. */}
      <div className="mb-[18px] rounded-[12px] bg-[var(--ph-surface)] md:max-w-2xl" style={{ overflow: 'clip' }}>
        <table className="tabular w-full table-fixed border-collapse text-[11px] leading-[14px] md:text-[13px]" data-testid="loan-schedule">
          <colgroup>
            <col style={{ width: yearly ? '11%' : '11%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '21%' }} />
            <col style={{ width: '21%' }} />
            <col style={{ width: '25%' }} />
          </colgroup>
          <thead>
            <tr className="text-[var(--ph-ink-3)]">
              {['#', 'Payment', 'Principal', 'Interest', 'Left'].map((heading, index) => (
                <th
                  key={heading}
                  scope="col"
                  className={cx(head, 'py-[8px] font-semibold', index === 0 ? 'pl-[10px] text-left' : 'px-[2px] text-right', index === 4 && 'pr-[10px]')}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.index} className="border-t-[0.5px] border-[var(--ph-hair)]" data-testid="schedule-row">
                <td className="py-[7px] pl-[10px] text-left text-[var(--ph-ink-3)]">{row.index}</td>
                <td className="px-[2px] text-right whitespace-nowrap text-[var(--ph-ink)]">{cell(row.paymentMinor, currency)}</td>
                <td className="px-[2px] text-right whitespace-nowrap text-[var(--ph-ink)]">{cell(row.principalMinor, currency)}</td>
                <td className="px-[2px] text-right whitespace-nowrap text-[var(--ph-ink)]">{cell(row.interestMinor, currency)}</td>
                <td className="pr-[10px] pl-[2px] text-right font-semibold whitespace-nowrap text-[var(--ph-ink)]">{cell(row.balanceMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
