import { CURRENCIES, type CycleBonus, cycleFor, type EarnRule, explainCycle, formatMinor, isoDate, minorToMajorString, parseMajor, previousCycle, type Redemption, type TransferPartner } from '@expanses/core';
import type { CatalogEntry } from '@expanses/catalog';
import {
  type AccountRow,
  applyCatalogEntry,
  listCycleActuals,
  addCard,
  archiveCard,
  archiveCycleBonus,
  setCatalogCategoryChoice,
  archiveEarnRule,
  createProgram,
  deleteRedemptionOption,
  type RewardProgramRow,
  recordCycleActual,
  backfillCycles,
  recordPointSnapshot,
  recordRedemption,
  saveCardTerms,
  saveRedemptionOption,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, PanelHeader, ReadOnlyRow, SelectRow, TextRow, useWalletSlot, WideColumn } from '../../ui/native';
import { InstallmentList } from '../loans/InstallmentList';
import { BonusForm } from './BonusForm';
import { BonusProgress } from './BonusProgress';
import { CatalogPanel } from './CatalogPanel';
import { CardFace } from './CardFace';
import { useCardIdentities, useCards } from './card-queries';
import { CatalogPicker } from './CatalogPicker';
import { ruleQualifiers } from './rule-summary';
import { capMeter } from './cap-meter';
import { describeSuggestion } from './hint-text';
import { PurchaseList, SuggestionFixes } from './PurchaseList';
import { activeDuring } from './catalog-panel';
import { RuleForm } from './RuleForm';
import { StatementPanel, type StatementPoints } from './StatementPanel';
import { CardHero, type CardTab, CardTabs } from './CardHero';
import { purchasesOf } from './hint-text';
import { TransferEstimates } from './TransferEstimates';
import { refreshLedger, useCardLedger } from './useCardLedger';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { ActionRow, Capsule, ColumnGroup, EARLIER, FigureRow, GlyphButton, Line, Meter, RowWithActions, Step, StepperRow, SubmitRow, SUBTITLE, TextLine, TITLE } from './rows';
import { type CardPoints, type CycleResult, formatPoints, loadCardPoints, loadCycleResult, pointsValue, shortDate } from './useCardPoints';
import { creditMinor, owedMinor } from '../networth/debt-rows';

const route = getRouteApi('/cards/$cardId');

function useAction() {
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await invalidate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };
  return { error, run };
}

/** The ground a native screen is laid on, and the column a desktop reads it in. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}

function CycleSummary({
  result,
  rules,
  bonuses,
  partners,
  unit,
  currency,
  best,
  title,
  today,
}: {
  result: CycleResult;
  rules: EarnRule[];
  bonuses: CycleBonus[];
  partners: TransferPartner[];
  unit: string;
  currency: string;
  best: Redemption | null;
  title: string;
  today: string;
}) {
  // Catalogue cards keep earlier terms as dated rules; only those in force during the cycle are relevant here.
  const activeRules = rules.filter((rule) => activeDuring(rule, result.cycle.start, result.cycle.end));
  const spend = result.lines.reduce((s, l) => s + Math.max(0, l.amountMinor), 0);
  const value = pointsValue(result.earn.totalPoints, best);
  /*
   * One section, several groups: the cycle's three figures, then each rule, each bonus and each partner as rows.
   * The heading names the whole section, so everything the cycle says is found under it.
   */
  return (
    <section className="mb-[18px]">
      <PanelHeader title={`${title}: ${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}`} />
      <InsetGroup>
        <ReadOnlyRow label="Spend" value={formatMinor(spend, currency)} />
        <ReadOnlyRow label={`Projected ${unit}`} value={formatPoints(result.earn.totalPoints)} />
        {value !== null && best && <ReadOnlyRow label="Worth about" value={formatMinor(value, best.currency)} />}
      </InsetGroup>
      {(activeRules.length > 0 || result.earn.unearnedSpendMinor > 0 || result.earn.cardFeeSpendMinor > 0) && (
        <InsetGroup header="By rule">
          {activeRules.map((rule) => {
            const used = result.earn.spendByRule[rule.id] ?? 0;
            const cap = rule.capSpendMinor ? capMeter(used, rule.capSpendMinor) : null;
            return (
              <FigureRow key={rule.id} title={rule.name} value={`${formatMinor(used, currency)} → ${formatPoints(result.earn.pointsByRule[rule.id] ?? 0)} ${unit}`}>
                {cap !== null && (
                  <>
                    <Meter fraction={cap.fraction} tone={cap.tone} />
                    <p className={cx('mt-[4px]', SUBTITLE)}>
                      Cap {formatMinor(rule.capSpendMinor!, currency)} · {formatMinor(Math.max(0, rule.capSpendMinor! - used), currency)} left
                    </p>
                  </>
                )}
              </FigureRow>
            );
          })}
          {result.earn.unearnedSpendMinor > 0 && (
            <TextLine tone="warn">{formatMinor(result.earn.unearnedSpendMinor, currency)} earned nothing — no rule matched. Add a base rule?</TextLine>
          )}
          {result.earn.cardFeeSpendMinor > 0 && (
            <TextLine tone="ink-3">{formatMinor(result.earn.cardFeeSpendMinor, currency)} in card fees and charges earns no points.</TextLine>
          )}
        </InsetGroup>
      )}
      <BonusProgress bonuses={bonuses} result={result} unit={unit} currency={currency} />
      <TransferEstimates partners={partners} points={result.earn.totalPoints} unit={unit} today={today} />
    </section>
  );
}

/**
 * Checks one statement's points against what the bank gave: the last statement to begin with, and any earlier
 * one on request, so a statement left unchecked can still be caught up. Earlier statements not checked yet are
 * listed, to jump straight to them.
 */
function StatementCheck({ cp, accounts, unit, currency, today }: { cp: CardPoints; accounts: AccountRow[]; unit: string; currency: string; today: string }) {
  const { database, ws } = useApp();
  const { error, run } = useAction();
  const program = cp.program!;
  const statementDay = cp.terms?.statementDay ?? 1;
  // 1 is the statement just closed; the cycle still open has no statement to check yet.
  const [back, setBack] = useState(1);
  const cycleAt = (steps: number) => {
    let cycle = cycleFor(today, program.cycleAnchor, statementDay);
    for (let i = 0; i < steps; i += 1) cycle = previousCycle(cycle, program.cycleAnchor, statementDay);
    return cycle;
  };
  const cycle = cycleAt(back);
  const result = useQuery({
    queryKey: ['statement-check', ws.workspaceId, program.id, cycle.start, cp.rules.length, cp.bonuses.length],
    queryFn: () => loadCycleResult(database, ws, cp, accounts, cycle),
  });
  const actuals = useQuery({ queryKey: ['cycle-actuals', ws.workspaceId, program.id], queryFn: () => listCycleActuals(database, ws, program.id) });
  const checked = new Set((actuals.data ?? []).map((row) => row.cycleStart));
  const unchecked = [1, 2, 3, 4, 5, 6].map(cycleAt).filter((c) => !checked.has(c.start));
  /*
   * One section for the whole check, headed by the statement it is checking, so the figure, the field, its Save and
   * the causes found are all read as one statement's check — in groups, not in a ringed card.
   */
  return (
    <section className="mb-[18px]">
      <PanelHeader title={`${cp.crediting === 'per_transaction' ? 'Bonus points credited' : 'Check against statement'}: ${shortDate(cycle.start)} – ${shortDate(cycle.end)}`} />
      <InsetGroup>
        <StepperRow
          earlier={{ label: 'Earlier statement to check', glyph: EARLIER, onClick: () => setBack((b) => b + 1) }}
          later={{ label: 'Later statement to check', onClick: () => setBack((b) => Math.max(1, b - 1)) }}
          laterDisabled={back <= 1}
        >
          Statement of {shortDate(cycle.end)}
        </StepperRow>
        {unchecked.length > 0 && (
          <Line testId="unchecked-statements" className="flex flex-wrap items-center gap-[8px]">
            <span className={SUBTITLE}>Not checked yet:</span>
            {unchecked.map((c) => (
              <Capsule
                key={c.start}
                selected={c.start === cycle.start}
                onClick={() => setBack([1, 2, 3, 4, 5, 6].find((steps) => cycleAt(steps).start === c.start) ?? 1)}
              >
                {shortDate(c.end)}
              </Capsule>
            ))}
          </Line>
        )}
      </InsetGroup>
      {result.data ? (
        <ActualForm
          key={`${cycle.start}:${result.data.actual ?? ''}`}
          result={result.data}
          unit={unit}
          currency={currency}
          crediting={cp.crediting}
          save={(actualPoints) =>
            run(async () => {
              await recordCycleActual(database, ws, { programId: program.id, cycleStart: cycle.start, actualPoints });
              // The ledger for this cycle is rebuilt now, since the page only derives the two cycles it shows.
              await refreshLedger(database, ws, program.id, [cycle], today);
            })
          }
        />
      ) : (
        <p className="pb-[18px] text-[15px] text-[var(--ph-ink-3)]">Working out this statement…</p>
      )}
      <ErrorBox error={error} />
    </section>
  );
}

function ActualForm({
  result,
  unit,
  currency,
  crediting,
  save,
}: {
  result: CycleResult;
  unit: string;
  currency: string;
  crediting: 'per_transaction' | 'per_statement';
  save: (actualPoints: number) => Promise<boolean>;
}) {
  const { run } = useAction();
  const [value, setValue] = useState(result.actual === null ? '' : String(result.actual));
  const perPurchase = crediting === 'per_transaction';
  const diff = result.actual === null ? null : result.actual - result.earn.totalPoints;
  // Recomputes the cycle per purchase, so only when the saved statement total or the cycle changes, not per keystroke.
  const hints = useMemo(() => (!perPurchase && result.actual !== null && result.actual !== result.earn.totalPoints ? explainCycle(result.context, result.actual) : []), [perPurchase, result]);
  const dates = Object.fromEntries(result.lines.map((line) => [line.transactionId, line.occurredOn]));
  const descriptions = Object.fromEntries(result.lines.map((line) => [line.transactionId, line.description]));
  const estimatedBonus = Object.values(result.earn.bonusById).reduce((sum, points) => sum + points, 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(Number(value.trim().replace(',', '.')));
  };
  return (
    <>
      <form onSubmit={submit}>
        <InsetGroup>
          {perPurchase ? (
            <TextLine>
              Points your bank credited outside individual purchases, such as cycle bonuses. Estimated <span className="tabular font-medium">{formatPoints(estimatedBonus)}</span> {unit}.
            </TextLine>
          ) : (
            <TextLine>
              Projected <span className="tabular font-medium">{formatPoints(result.earn.totalPoints)}</span> {unit}.
              {diff !== null && (diff === 0 ? ' Statement matches exactly.' : ` Statement shows ${diff > 0 ? '+' : ''}${formatPoints(diff)} vs projection.`)}
            </TextLine>
          )}
          <TextRow label={perPurchase ? 'Bonus points credited' : `Actual ${unit} on statement`} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required />
          <SubmitRow label="Save" />
        </InsetGroup>
      </form>
      {hints.length > 0 && (
        <InsetGroup header="Likely causes">
          {hints.map((hint, i) => (
            <Line key={i}>
              <p className="text-[14px] leading-[19px] text-[var(--ph-ink)]">{describeSuggestion(hint, unit, currency, descriptions)}</p>
              <SuggestionFixes suggestion={hint} description={hint.kind === 'mcc' ? (descriptions[hint.transactionId] ?? '') : ''} occurredOn={hint.kind === 'mcc' ? dates[hint.transactionId] : undefined} run={run} />
            </Line>
          ))}
        </InsetGroup>
      )}
      {!perPurchase && diff !== null && diff !== 0 && hints.length === 0 && (
        <p className="px-[4px] pb-[18px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">No MCC, bonus, or rounding in this card's rules explains the difference. A rule may need adjusting.</p>
      )}
    </>
  );
}

export function CardDetailPage() {
  const { database, ws } = useApp();
  const { cardId } = route.useParams();
  const accounts = useAccounts();
  const balances = useBalances();
  const all = accounts.data ?? [];
  const card = all.find((a) => a.id === cardId);
  const plastic = useCards(card?.id).data ?? [];
  const identities = useCardIdentities().data ?? {};
  const [newLast4, setNewLast4] = useState('');
  const [newHolder, setNewHolder] = useState('');
  const today = isoDate();
  const data = useQuery({
    queryKey: ['card-points-detail', ws.workspaceId, today, cardId],
    enabled: !!card,
    queryFn: () => loadCardPoints(database, ws, card!, all, today),
  });
  // Before the early returns: the ledger fills the cycles this page shows, then reports the balance.
  const ledger = useCardLedger(data.data?.program?.id, [data.data?.current?.cycle ?? null, data.data?.previous?.cycle ?? null], today);
  const { error, run } = useAction();
  const [observedBalance, setObservedBalance] = useState('');
  const [anchorEarnedOn, setAnchorEarnedOn] = useState('');
  const [spendPoints, setSpendPoints] = useState('');
  const [spendNote, setSpendNote] = useState('');
  const [spendValue, setSpendValue] = useState('');
  const [spendKind, setSpendKind] = useState<'redeem' | 'transfer'>('redeem');
  const [spendChoice, setSpendChoice] = useState('');
  const [editingRule, setEditingRule] = useState<EarnRule | 'new' | null>(null);
  const [editingBonus, setEditingBonus] = useState<CycleBonus | 'new' | null>(null);
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [browsingCatalog, setBrowsingCatalog] = useState(false);

  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [limit, setLimit] = useState('');
  const [fee, setFee] = useState('');
  const [programName, setProgramName] = useState('');
  const [unit, setUnit] = useState<RewardProgramRow['unit']>('points');
  const [anchor, setAnchor] = useState<RewardProgramRow['cycleAnchor']>('statement');
  const [redeemName, setRedeemName] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [redeemValue, setRedeemValue] = useState('');
  const [redeemCurrency, setRedeemCurrency] = useState(ws.baseCurrency);
  const [loadedTermsFor, setLoadedTermsFor] = useState<string | null>(null);
  // Opened from the Wallet stack, the raised card is this page's header and the stack's screen is its ground.
  const slot = useWalletSlot();
  const Ground = slot ? Fragment : Screen;
  /** The tab the owner picked; until then the page opens where the card needs attention. */
  // Kept in the address, so a reload, the back button and a shared link all land on the same tab.
  const chosenTab: CardTab | null = route.useSearch().tab ?? null;
  const navigate = useNavigate({ from: '/cards/$cardId' });
  const setChosenTab = (tab: CardTab) => void navigate({ search: { tab }, replace: true });
  // Reaching a new setup step while on the page brings that step's tab forward; finishing setup leaves it be.
  // A debit card has no statement day to ask for, so its setup starts at the program.
  const isDebit = card?.subtype !== undefined && card.subtype !== 'credit_card';
  const setupStep = data.data ? (!isDebit && !data.data.terms ? 1 : !data.data.program ? 2 : data.data.rules.length === 0 ? 3 : null) : undefined;
  const seenStep = useRef(setupStep);
  useEffect(() => {
    const before = seenStep.current;
    seenStep.current = setupStep;
    if (before === undefined || setupStep === undefined || before === setupStep || setupStep === null) return;
    void navigate({ search: { tab: setupStep === 1 ? 'card' : 'rules' }, replace: true });
  }, [setupStep, navigate]);

  if (accounts.isSuccess && !card) return <Empty>Card not found.</Empty>;
  if (!card || !data.data)
    return (
      <>
        {slot && <div aria-hidden style={{ height: slot.height }} className="mb-5" />}
        <p className="text-sm text-slate-500">Loading…</p>
      </>
    );
  const cp = data.data;
  const currency = card.currency!;

  if (loadedTermsFor !== card.id) {
    setLoadedTermsFor(card.id);
    setStatementDay(cp.terms ? String(cp.terms.statementDay) : '');
    setDueDay(cp.terms ? String(cp.terms.dueDay) : '');
    setLimit(cp.terms?.creditLimitMinor != null ? minorToMajorString(cp.terms.creditLimitMinor, currency) : '');
    setFee(cp.terms?.annualFeeMinor != null ? minorToMajorString(cp.terms.annualFeeMinor, currency) : '');
    setProgramName(`${card.name} rewards`);
  }

  // The Debts page's figure for this card, read by the same function, so the two screens always agree.
  const owed = isDebit ? 0 : owedMinor(balances.data ?? {}, card.id);
  // Paid past what it owed: the bank holds the rest for you. Unpaid stays at nothing, as the Debts page says.
  const credit = isDebit ? 0 : creditMinor(balances.data ?? {}, card.id);
  const optionalMinor = (v: string) => (v.trim() ? parseMajor(v, currency) : null);
  // Setup is ordered: the statement day defines cycles, a program holds rules, and rules produce points.
  const hasTerms = !!cp.terms;
  const step = !isDebit && !hasTerms ? 1 : !cp.program ? 2 : cp.rules.length === 0 ? 3 : null;
  const canUseCatalog = !cp.program || cp.catalog.status === null;
  // What points can go to on this card: its transfer partners and its redemption options, catalogue or typed.
  const spendChoices: { key: string; label: string; kind: 'redeem' | 'transfer' }[] = [
    ...cp.transferPartners.map((partner) => ({ key: `partner:${partner.id}`, label: partner.program, kind: 'transfer' as const })),
    ...cp.redemptions.map((option) => ({ key: `option:${option.id}`, label: option.name, kind: option.type === 'miles_transfer' ? ('transfer' as const) : ('redeem' as const) })),
  ].filter((choice, index, all) => all.findIndex((other) => other.label === choice.label) === index);
  // A card with no statement day opens on its terms; any other card opens on its statement, since rewards are optional.
  const active: CardTab = chosenTab ?? (step === 1 ? 'card' : isDebit ? 'points' : 'statement');
  const on = (tab: CardTab) => active === tab;
  /*
   * Opened from the Wallet stack, a card shows Wallet's summary: its tiles and its latest transactions. Its sections
   * are screens of their own, reached from ⋯ or a tile, under the same raised card. A card still being set up has
   * the step it is at under its summary, as the page always had.
   */
  const summary = !!slot && chosenTab === null;
  const sections = !summary || step !== null;
  const openTab = (tab: CardTab, focusId?: string) => {
    // From the summary a section is a step forward, so Back returns to the summary; between sections it is a switch.
    if (summary) void navigate({ search: { tab } });
    else setChosenTab(tab);
    if (focusId) window.setTimeout(() => document.getElementById(focusId)?.scrollIntoView({ block: 'start' }), 0);
  };
  // Points for each purchase in the two cycles the page has worked out, shown beside the statement's own lines.
  const statementPoints: Record<string, StatementPoints> = {};
  for (const result of [cp.previous, cp.current]) {
    if (!result) continue;
    const approximate = new Set(result.earn.approximateTransactionIds);
    for (const purchase of purchasesOf(result.lines)) {
      // Only an MCC the owner set is worth printing on the statement; a guessed one is checked in the Points tab.
      const known = purchase.mccSource === 'typed' || purchase.mccSource === 'memory';
      statementPoints[purchase.transactionId] = {
        points: result.earn.pointsByTransaction[purchase.transactionId] ?? 0,
        approximate: approximate.has(purchase.transactionId),
        mcc: purchase.cardFee || !known ? null : purchase.mcc,
        cardFee: purchase.cardFee,
      };
    }
  }
  const confirmCustomise = () =>
    cp.catalog.status !== 'linked' ||
    window.confirm(`${card.name} follows the catalogue. Changing it makes it customised: catalogue updates stop applying automatically and wait for your review. Continue?`);
  const chooseEntry = (entry: CatalogEntry) => {
    setCatalogId(entry.id);
    // Some issuers close every cardholder's statement on the same day.
    if (!hasTerms && entry.program.fixedStatementDay && !statementDay) setStatementDay(String(entry.program.fixedStatementDay));
  };
  const applyEntry = (entry: CatalogEntry, memberLevel: string | null = null, categoryOption: string | null = null) => {
    const manual = cp.rules.length;
    if (manual > 0 && !window.confirm(`Replace your ${manual} earn rule${manual === 1 ? '' : 's'} with the catalogue terms for ${entry.name}?`)) return;
    void run(async () => {
      const { programId } = await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry, today, replaceManual: manual > 0, memberLevel });
      // The first pick runs from the start of the card, so every cycle already recorded is covered by it.
      if (categoryOption) await setCatalogCategoryChoice(database, ws, programId, categoryOption, today, today);
      setBrowsingCatalog(false);
    }).then((applied) => {
      // The catalogue writes the published annual fee onto the card terms, so the form has to read them again —
      // after run() has awaited the refetch, or it would reload the terms as they were before applying. Without
      // this the fee box stays empty, and saving terms would write that emptiness back over the fee.
      if (applied) setLoadedTermsFor(null);
    });
  };

  return (
    <Ground>
      {!slot && <LargeTitle title={card.name} back="Cards" backTo="/cards" oneLine />}
      {/* In a section the raised card is still the header, so the section leaves it its place. */}
      {slot && !summary && <div aria-hidden data-testid="wallet-slot" className="mb-5" style={{ height: slot.height }} />}
      {(!slot || summary) && (
      <CardHero
        cp={cp}
        accounts={all}
        plastic={plastic}
        issuer={identities[card.id]?.issuer ?? null}
        owedMinor={owed}
        creditMinor={credit}
        debit={isDebit}
        pointsBalance={ledger.data ? { total: ledger.data.balance.total, posted: ledger.data.balance.postedTotal, estimated: ledger.data.balance.projectedTotal } : null}
        today={today}
        onTab={openTab}
        lines={[...(cp.current?.lines ?? []), ...(cp.previous?.lines ?? [])]}
      />
      )}
      {/*
       * The control and what it controls share one column at every width. On a desktop the hero is two columns,
       * and a control drawn in the right one of them sat over a section spanning both — it did not line up with
       * the thing it switches. That column is the page's whole width on a desktop, and the forms in it lay their
       * fields out across it, as the page did before the kit: a desktop is not a phone held sideways.
       */}
      {sections && (
      <WideColumn>
      <div className="mt-[4px]">
      <CardTabs active={active} onChange={(tab) => setChosenTab(tab)} debit={isDebit} />
      <ErrorBox error={error} />
      {on('rules') && cp.catalog.entryId && <CatalogPanel cp={cp} today={today} run={run} />}

      {on('card') && !isDebit && (
        <>
          {step === 1 && <Step>Step 1 of 3</Step>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => saveCardTerms(database, ws, { accountId: card.id, statementDay: Number(statementDay), dueDay: Number(dueDay), creditLimitMinor: optionalMinor(limit), annualFeeMinor: optionalMinor(fee) }));
            }}
          >
            <ColumnGroup
              header="Card terms"
              footer={step === 1 ? 'Start with your billing date. It decides which purchases count toward each points cycle and when bonus caps reset.' : undefined}
              columns={[
                [
                  <TextRow label="Billing date" hint="Day of the month" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} inputMode="numeric" placeholder="25" required />,
                  <TextRow label="Due date" hint="Day of the month" value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" placeholder="12" required />,
                ],
                [
                  <TextRow label={`Credit limit (${currency})`} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />,
                  <TextRow label={`Annual fee (${currency})`} value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />,
                  // The balance and its share of the limit are read whole, so they share the wider second column.
                  <ReadOnlyRow
                    label="Current balance"
                    value={`${formatMinor(owed, currency)}${cp.terms?.creditLimitMinor ? ` · ${Math.round((owed / cp.terms.creditLimitMinor) * 100)}% of limit` : ''}`}
                  />,
                  <SubmitRow label="Save terms" />,
                ],
              ]}
            />
          </form>
        </>
      )}

      {on('statement') && cp.terms && <StatementPanel card={card} statementDay={cp.terms.statementDay} accounts={all} plastic={plastic} today={today} points={cp.program && cp.rules.length > 0 ? statementPoints : undefined} unit={cp.program?.unit} />}

      {on('card') && (
        <>
          <InsetGroup
            header="Cards on this account"
            footer="One statement, one limit — and sometimes more than one card. A supplementary card spends against this same account, so recording its last four digits is what tells whose spending is whose."
          >
            {[...plastic].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((piece) => (
              // The card's own face beside whose it is: a row with its art, and the way to take the card off.
              <Line key={piece.id} testId="card-on-account" pad="8px 4px 8px 13px" className="flex items-center gap-[12px]">
                <CardFace issuer={identities[card.id]?.issuer ?? null} name={card.name} last4={piece.last4} holderName={piece.holderName} network={cp.catalog.entry?.network} look={cp.catalog.entry?.look} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate', TITLE)}>{piece.holderName ?? (piece.isPrimary ? 'Primary' : 'Supplementary')}</span>
                  <span className={cx('tabular block truncate', SUBTITLE)}>
                    ···· {piece.last4 ?? '····'}
                    {piece.isPrimary ? ' · primary' : ''}
                  </span>
                </span>
                <GlyphButton
                  label={`Remove card ending ${piece.last4 ?? 'unknown'}`}
                  glyph={<Trash2 size={17} aria-hidden />}
                  destructive
                  onClick={() => void run(() => archiveCard(database, ws, piece.id))}
                />
              </Line>
            ))}
            {plastic.length === 0 && <TextLine tone="ink-3">No card recorded on this account yet.</TextLine>}
          </InsetGroup>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await addCard(database, ws, { accountId: card.id, last4: newLast4, holderName: newHolder, isPrimary: plastic.length === 0 });
                setNewLast4('');
                setNewHolder('');
              });
            }}
          >
            <ColumnGroup
              header="Add a card"
              columns={[
                [<TextRow label="Last 4 digits" value={newLast4} onChange={(e) => setNewLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="8802" />],
                [<TextRow label="Whose card" hint="Optional. Yours, or whoever holds the supplementary card." value={newHolder} onChange={(e) => setNewHolder(e.target.value)} placeholder="Spouse" />],
                [<SubmitRow label="Add card" />],
              ]}
            />
          </form>
        </>
      )}

      {on('card') && step === 1 && (
        <CatalogPicker
          header="Is your card in the catalogue?"
          today={today}
          selectedId={catalogId}
          onSelect={chooseEntry}
          debit={isDebit}
          applyHint="Save the card terms above, then use these terms in the next step."
        />
      )}

      {on('rules') && hasTerms && !cp.program && (
        <>
          <Step>Step 2 of 3 · Rewards program</Step>
          <CatalogPicker header="Choose from catalogue" today={today} selectedId={catalogId} onSelect={chooseEntry} onApply={applyEntry} debit={isDebit} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => createProgram(database, ws, { cardAccountId: card.id, name: programName, unit, cycleAnchor: anchor }));
            }}
          >
            <ColumnGroup
              header="Or set up manually"
              columns={[
                [
                  <TextRow label="Program name" value={programName} onChange={(e) => setProgramName(e.target.value)} required />,
                  <SelectRow label="Earns" value={unit} onChange={(e) => setUnit(e.target.value as RewardProgramRow['unit'])}>
                    <option value="points">Points</option>
                    <option value="miles">Miles</option>
                    <option value="cashback">Cashback</option>
                  </SelectRow>,
                ],
                [
                  <SelectRow label="Caps reset" value={anchor} onChange={(e) => setAnchor(e.target.value as RewardProgramRow['cycleAnchor'])}>
                    <option value="statement">Each statement cycle</option>
                    <option value="calendar">Each calendar month</option>
                  </SelectRow>,
                  <SubmitRow label="Set up rewards" />,
                ],
              ]}
            />
          </form>
        </>
      )}

      {hasTerms && cp.program && (
        <>
          {/* What this cycle is earning comes first: it is what the Points tab is opened for. */}
          {on('points') && cp.current && cp.rules.length > 0 && (
            <CycleSummary title="This cycle" result={cp.current} rules={cp.rules} bonuses={cp.bonuses} partners={cp.transferPartners} unit={cp.program.unit} currency={currency} best={cp.best} today={today} />
          )}
          {on('points') && cp.current && cp.rules.length > 0 && <PurchaseList cp={cp} run={run} currency={currency} />}
          {on('points') && cp.previous && cp.rules.length > 0 && <StatementCheck cp={cp} accounts={all} unit={cp.program.unit} currency={currency} today={today} />}
          {on('points') && ledger.data && (
            <>
              <InsetGroup
                header="Points balance"
                footer="Posted points come from figures you typed in. Estimated points are worked out from your rules, and become posted as you record what the bank actually gave."
              >
                <InsetRow
                  title={
                    <span className="tabular text-[22px] leading-[28px] font-extrabold tracking-[-0.02em]" data-testid="points-balance">
                      {formatPoints(ledger.data.balance.total)} {cp.program.unit}
                    </span>
                  }
                  subtitle={
                    <span data-testid="points-provenance">
                      {formatPoints(ledger.data.balance.postedTotal)} posted · {formatPoints(ledger.data.balance.projectedTotal)} estimated
                    </span>
                  }
                />
              </InsetGroup>
              <InsetGroup footer="Works the last two years of cycles out from purchases already recorded here. Points earned before you used this app are not among them — type the balance the issuer shows instead.">
                <ActionRow label="Catch up this card" onClick={() => void run(() => backfillCycles(database, ws, cp.program!.id, 24, today))} />
              </InsetGroup>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await recordPointSnapshot(database, ws, {
                      programId: cp.program!.id,
                      balance: Number(observedBalance.trim().replace(',', '.')),
                      observedOn: today,
                      ...(anchorEarnedOn.trim() === '' ? {} : { earnedOn: anchorEarnedOn }),
                    });
                    setObservedBalance('');
                    setAnchorEarnedOn('');
                  });
                }}
              >
                <InsetGroup header="The issuer's balance">
                  <TextRow label="Balance in the app" value={observedBalance} onChange={(event) => setObservedBalance(event.target.value)} inputMode="decimal" required />
                  <TextRow
                    label="Earned around"
                    hint="Roughly when those points were earned, which decides when they expire. Empty counts them as earned today."
                    type="date"
                    value={anchorEarnedOn}
                    onChange={(event) => setAnchorEarnedOn(event.target.value)}
                  />
                  <SubmitRow label="Anchor balance" />
                </InsetGroup>
              </form>
            </>
          )}
          {on('points') && ledger.data && cp.rules.length > 0 && (
            <div id="spend-points" className="scroll-mt-4">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await recordRedemption(database, ws, {
                      programId: cp.program!.id,
                      kind: spendKind,
                      points: Number(spendPoints.trim().replace(',', '.')),
                      occurredOn: today,
                      note: spendNote.trim() || null,
                      valueMinor: spendValue.trim() === '' ? null : parseMajor(spendValue, currency),
                    });
                    setSpendPoints('');
                    setSpendNote('');
                    setSpendValue('');
                    setSpendChoice('');
                  });
                }}
              >
                <ColumnGroup
                  header="Spend points"
                  footer="Taken from the points that expire soonest, so none are lost that could have been used."
                  columns={[
                    [
                      <TextRow label={`${cp.program.unit === 'miles' ? 'Miles' : 'Points'} spent`} value={spendPoints} onChange={(event) => setSpendPoints(event.target.value)} inputMode="decimal" required />,
                      spendChoices.length > 0 && (
                        <SelectRow
                          label="What for"
                          value={spendChoice}
                          onChange={(event) => {
                            const choice = spendChoices.find((option) => option.key === event.target.value);
                            setSpendChoice(event.target.value);
                            // A partner means the points moved to an airline or hotel; anything else was spent here.
                            if (choice) setSpendKind(choice.kind);
                            setSpendNote(choice ? choice.label : '');
                          }}
                        >
                          <option value="">Choose…</option>
                          {spendChoices.some((option) => option.kind === 'transfer') && (
                            <optgroup label="Move to a partner">
                              {spendChoices.filter((option) => option.kind === 'transfer').map((option) => (
                                <option key={option.key} value={option.key}>
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {spendChoices.some((option) => option.kind === 'redeem') && (
                            <optgroup label="Redeem">
                              {spendChoices.filter((option) => option.kind === 'redeem').map((option) => (
                                <option key={option.key} value={option.key}>
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <option value="other">Something else…</option>
                        </SelectRow>
                      ),
                      (spendChoices.length === 0 || spendChoice === 'other') && (
                        <TextRow label={spendChoices.length === 0 ? 'What for' : 'Describe it'} value={spendNote} onChange={(event) => setSpendNote(event.target.value)} placeholder="Statement credit" />
                      ),
                    ],
                    [
                      <TextRow label={`What it fetched (${currency})`} hint="Leave empty if it had no cash value." value={spendValue} onChange={(event) => setSpendValue(event.target.value)} inputMode="decimal" />,
                      (spendChoices.length === 0 || spendChoice === 'other') && (
                        <SelectRow label="Kind" value={spendKind} onChange={(event) => setSpendKind(event.target.value as 'redeem' | 'transfer')}>
                          <option value="redeem">Redeemed</option>
                          <option value="transfer">Moved to a partner</option>
                        </SelectRow>
                      ),
                      <SubmitRow label="Spend points" />,
                    ],
                  ]}
                />
              </form>
            </div>
          )}

          {on('points') && ledger.data && (
            <>
              <div data-testid="card-year-roi">
                {/* Four figures, four columns on a desktop: the tiles the page had, as one group. */}
                <ColumnGroup
                  header="What the annual fee bought"
                  footer={
                    <>
                      {ledger.data.roi.from} to {ledger.data.roi.to} ·{' '}
                      {ledger.data.roi.anchoredOn === 'fee' ? 'from the day the fee was charged' : 'the last twelve months, since no fee charge is recorded'}
                      {ledger.data.roi.estimated ? ' · estimated, because some points were worked out rather than confirmed' : ''}
                    </>
                  }
                  columns={[
                    [<InsetRow title="Earned" value={`${formatPoints(ledger.data.roi.pointsEarned)} ${cp.program.unit}`} valueTone="ink" />],
                    [<InsetRow title="Worth" value={formatMinor(ledger.data.roi.valueMinor, currency)} valueTone="ink" />],
                    [<InsetRow title="Annual fee" value={formatMinor(ledger.data.roi.annualFeeMinor, currency)} valueTone="ink" />],
                    [<InsetRow title="Net" value={formatMinor(ledger.data.roi.netMinor, currency)} valueTone={ledger.data.roi.netMinor < 0 ? 'alarm' : 'tint'} />],
                  ]}
                />
              </div>
              {ledger.data.roi.realised && (
                <div data-testid="card-year-realised">
                  <InsetGroup header="At what your points have really fetched" footer="The figures above value points at the best option, which assumes the best use.">
                    <InsetRow title="Earned" value={`${formatMinor(ledger.data.roi.realised.valueMinor, currency)} earned`} valueTone="ink" />
                    <InsetRow
                      title="Net"
                      value={`${formatMinor(ledger.data.roi.realised.netMinor, currency)} net`}
                      valueTone={ledger.data.roi.realised.netMinor < 0 ? 'alarm' : 'tint'}
                    />
                  </InsetGroup>
                </div>
              )}
            </>
          )}

          {on('rules') && (
            <>
              {step === 3 && <Step>Step 3 of 3</Step>}
              {(() => {
                const sorted = [...cp.rules].sort((a, b) => b.priority - a.priority);
                const row = (rule: EarnRule) => (
                  <RowWithActions
                    key={rule.id}
                    label={`Edit ${rule.name}`}
                    onClick={() => setEditingRule(rule)}
                    title={
                      <>
                        {rule.name}
                        {rule.stackable && <span className="font-normal text-[var(--ph-ink-3)]"> (stacks)</span>}
                      </>
                    }
                    subtitle={
                      <>
                        {formatPoints(rule.rateNum)} per {formatMinor(rule.rateDen, currency)} · priority {rule.priority}
                        {rule.validFrom && ` · from ${rule.validFrom}`}
                        {rule.validTo && ` · until ${rule.validTo}`}
                        {rule.capSpendMinor !== null && ` · cap ${formatMinor(rule.capSpendMinor, currency)}/cycle`}
                        {(() => {
                          const parts = ruleQualifiers(rule, (id) => all.find((a) => a.id === id)?.name ?? '?', (minor) => formatMinor(minor, currency));
                          return parts.length ? parts.map((part) => ` · ${part}`).join('') : ' · all categories';
                        })()}
                      </>
                    }
                    actions={[
                      {
                        label: `Remove ${rule.name}`,
                        glyph: <Trash2 size={17} aria-hidden />,
                        destructive: true,
                        onClick: () => window.confirm(`Remove rule ${rule.name}?`) && confirmCustomise() && void run(() => archiveEarnRule(database, ws, rule.id)),
                      },
                    ]}
                  />
                );
                /*
                 * The rule being edited is replaced where it stands by its form, as it always was: the list splits
                 * around it, so the form reads as that rule opened up rather than as a second copy under the list.
                 */
                const at = editingRule !== null && editingRule !== 'new' ? sorted.findIndex((rule) => rule.id === editingRule.id) : -1;
                const before = at < 0 ? sorted : sorted.slice(0, at);
                const after = at < 0 ? [] : sorted.slice(at + 1);
                return (
                  <>
                    {/* A group with no row left in it would be an empty white bar, so only its header stays. */}
                    {before.length === 0 && editingRule !== null ? (
                      <PanelHeader title="Earn rules" />
                    ) : (
                      <InsetGroup header="Earn rules">
                        {cp.rules.length === 0 && editingRule === null && (
                          <TextLine tone="ink-3">
                            Add your card's base earn rate first. The form starts with a typical rate — change it to match your card. Then add bonus rules with a higher priority.
                          </TextLine>
                        )}
                        {before.map(row)}
                        {editingRule === null && canUseCatalog && (
                          <ActionRow label={browsingCatalog ? 'Close catalogue' : 'Choose from catalogue'} icon={<BookOpen size={15} aria-hidden />} onClick={() => setBrowsingCatalog(!browsingCatalog)} />
                        )}
                        {editingRule === null && <ActionRow label="Add rule" icon={<Plus size={16} aria-hidden />} onClick={() => setEditingRule('new')} />}
                      </InsetGroup>
                    )}
                    {at >= 0 && editingRule !== null && editingRule !== 'new' && (
                      <RuleForm key={editingRule.id} programId={cp.program!.id} currency={currency} accounts={all} initial={editingRule} beforeSave={confirmCustomise} onDone={() => setEditingRule(null)} />
                    )}
                    {after.length > 0 && <InsetGroup>{after.map(row)}</InsetGroup>}
                  </>
                );
              })()}
              {browsingCatalog && canUseCatalog && <CatalogPicker today={today} selectedId={catalogId} onSelect={chooseEntry} onApply={applyEntry} debit={isDebit} />}
              {editingRule === 'new' && (
                <RuleForm programId={cp.program.id} currency={currency} accounts={all} suggestBase={cp.rules.length === 0} beforeSave={confirmCustomise} onDone={() => setEditingRule(null)} />
              )}
            </>
          )}

          {on('rules') && cp.rules.length > 0 && (
            <>
              {(() => {
                const row = (bonus: CycleBonus) => (
                  <RowWithActions
                    key={bonus.id}
                    testId={`bonus-${bonus.id}`}
                    label={`Edit ${bonus.name}`}
                    onClick={() => confirmCustomise() && setEditingBonus(bonus)}
                    title={
                      <>
                        {bonus.name}
                        {!activeDuring(bonus, today, today) && <span className="ml-2 text-[12.5px] font-normal text-[var(--ph-ink-3)]">past terms</span>}
                      </>
                    }
                    subtitle={
                      <>
                        {bonus.tiers.map((tier) => `${formatMinor(tier.minSpendMinor, currency)} → ${formatPoints(tier.bonus)} ${cp.program!.unit}`).join(' · ')}
                        {bonus.validFrom && ` · from ${bonus.validFrom}`}
                        {bonus.validTo && ` · until ${bonus.validTo}`}
                      </>
                    }
                    actions={[
                      {
                        label: `Remove ${bonus.name}`,
                        glyph: <Trash2 size={17} aria-hidden />,
                        destructive: true,
                        onClick: () => window.confirm(`Remove bonus ${bonus.name}?`) && confirmCustomise() && void run(() => archiveCycleBonus(database, ws, bonus.id)),
                      },
                    ]}
                  />
                );
                // As with rules: the bonus being edited opens where it stands.
                const at = editingBonus !== null && editingBonus !== 'new' ? cp.bonuses.findIndex((bonus) => bonus.id === editingBonus.id) : -1;
                const before = at < 0 ? cp.bonuses : cp.bonuses.slice(0, at);
                const after = at < 0 ? [] : cp.bonuses.slice(at + 1);
                return (
                  <>
                    {before.length === 0 && editingBonus !== null ? (
                      <PanelHeader title="Spend bonuses" />
                    ) : (
                      <InsetGroup header="Spend bonuses">
                        {cp.bonuses.length === 0 && editingBonus === null && (
                          <TextLine tone="ink-3">No spend bonuses. Add one for a card that pays a lump for reaching a spend in a cycle.</TextLine>
                        )}
                        {before.map(row)}
                        {editingBonus === null && <ActionRow label="Add bonus" icon={<Plus size={16} aria-hidden />} onClick={() => confirmCustomise() && setEditingBonus('new')} />}
                      </InsetGroup>
                    )}
                    {at >= 0 && editingBonus !== null && editingBonus !== 'new' && (
                      <BonusForm
                        key={editingBonus.id}
                        programId={cp.program!.id}
                        currency={currency}
                        unit={cp.program!.unit}
                        accounts={all}
                        initial={editingBonus}
                        beforeSave={confirmCustomise}
                        onDone={() => setEditingBonus(null)}
                      />
                    )}
                    {after.length > 0 && <InsetGroup>{after.map(row)}</InsetGroup>}
                  </>
                );
              })()}
              {editingBonus === 'new' && (
                <BonusForm programId={cp.program.id} currency={currency} unit={cp.program.unit} accounts={all} beforeSave={confirmCustomise} onDone={() => setEditingBonus(null)} />
              )}
            </>
          )}

          {on('rules') && cp.rules.length > 0 && (
            <>
              <InsetGroup header="What points are worth">
                {cp.redemptions.length === 0 && <TextLine tone="ink-3">No values yet. Add what a redemption fetches, so points can be worth something here.</TextLine>}
                {cp.redemptions.map((r) => (
                  <RowWithActions
                    key={r.id}
                    title={`${r.name}: ${formatPoints(r.perPoints)} ${cp.program!.unit} = ${formatMinor(r.valueMinor, r.currency)}`}
                    actions={[
                      {
                        label: `Remove ${r.name}`,
                        glyph: <Trash2 size={17} aria-hidden />,
                        destructive: true,
                        onClick: () => confirmCustomise() && void run(() => deleteRedemptionOption(database, ws, r.id)),
                      },
                    ]}
                  />
                ))}
              </InsetGroup>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!confirmCustomise()) return;
                  void run(async () => {
                    await saveRedemptionOption(database, ws, { programId: cp.program!.id, name: redeemName, type: 'cashback', perPoints: Number(redeemPoints), valueMinor: parseMajor(redeemValue, redeemCurrency), currency: redeemCurrency });
                    setRedeemName('');
                    setRedeemPoints('');
                    setRedeemValue('');
                  });
                }}
              >
                <ColumnGroup
                  header="Add a value"
                  columns={[
                    [
                      <TextRow label="Redemption" value={redeemName} onChange={(e) => setRedeemName(e.target.value)} placeholder="Statement credit" />,
                      <TextRow label={cp.program.unit === 'miles' ? 'Miles redeemed' : 'Points redeemed'} value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} inputMode="numeric" placeholder="1000" required />,
                    ],
                    [
                      <TextRow label="Worth" value={redeemValue} onChange={(e) => setRedeemValue(e.target.value)} inputMode="decimal" placeholder="2500" required />,
                      <SelectRow label="Currency" value={redeemCurrency} onChange={(e) => setRedeemCurrency(e.target.value)}>
                        {CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </SelectRow>,
                    ],
                    [<SubmitRow label="Add value" />],
                  ]}
                />
              </form>
            </>
          )}
        </>
      )}

      {on('card') && <InstallmentList cardAccountId={card.id} currency={currency} />}
      </div>
      </WideColumn>
      )}
    </Ground>
  );
}
