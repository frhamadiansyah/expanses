import { CURRENCIES, type CycleBonus, displayAmount, type EarnRule, explainCycle, formatMinor, isoDate, minorToMajorString, parseMajor, type Redemption, type TransferPartner } from '@expanses/core';
import type { CatalogEntry } from '@expanses/catalog';
import {
  applyCatalogEntry,
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
import { getRouteApi, Link } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { InstallmentList } from '../loans/InstallmentList';
import { BonusForm } from './BonusForm';
import { BonusProgress } from './BonusProgress';
import { CatalogPanel } from './CatalogPanel';
import { useCards } from './card-queries';
import { CatalogPicker } from './CatalogPicker';
import { ruleQualifiers } from './rule-summary';
import { describeSuggestion } from './hint-text';
import { PurchaseList, SuggestionFixes } from './PurchaseList';
import { activeDuring } from './catalog-panel';
import { RuleForm } from './RuleForm';
import { TransferEstimates } from './TransferEstimates';
import { useCardLedger } from './useCardLedger';
import { type CycleResult, formatPoints, loadCardPoints, pointsValue, shortDate } from './useCardPoints';

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

function Section({ title, step, children, action }: { title: string; step?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          {step && <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{step}</div>}
          <h2 className="text-sm font-semibold text-slate-600">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </Card>
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
  return (
    <Section title={`${title}: ${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}`}>
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-slate-500">Spend</div>
          <Money minor={spend} currency={currency} className="font-semibold" />
        </div>
        <div>
          <div className="text-xs text-slate-500">Projected {unit}</div>
          <div className="tabular font-semibold">{formatPoints(result.earn.totalPoints)}</div>
        </div>
        {value !== null && best && (
          <div>
            <div className="text-xs text-slate-500">Worth about</div>
            <Money minor={value} currency={best.currency} className="font-semibold" />
          </div>
        )}
      </div>
      <ul className="mt-3 space-y-2">
        {activeRules.map((rule) => {
          const used = result.earn.spendByRule[rule.id] ?? 0;
          const pct = rule.capSpendMinor ? Math.min(100, Math.round((used / rule.capSpendMinor) * 100)) : null;
          return (
            <li key={rule.id} className="text-sm">
              <div className="flex justify-between">
                <span>{rule.name}</span>
                <span className="tabular">
                  {formatMinor(used, currency)} → {formatPoints(result.earn.pointsByRule[rule.id] ?? 0)} {unit}
                </span>
              </div>
              {pct !== null && (
                <div className="mt-1">
                  <div className="h-1.5 rounded bg-slate-100">
                    <div className={pct >= 100 ? 'h-1.5 rounded bg-amber-500' : 'h-1.5 rounded bg-emerald-600'} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-xs text-slate-500">
                    Cap {formatMinor(rule.capSpendMinor!, currency)} · {formatMinor(Math.max(0, rule.capSpendMinor! - used), currency)} left
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <BonusProgress bonuses={bonuses} result={result} unit={unit} currency={currency} />
      <TransferEstimates partners={partners} points={result.earn.totalPoints} unit={unit} today={today} />
      {result.earn.unearnedSpendMinor > 0 && (
        <p className="mt-2 text-xs text-amber-700">{formatMinor(result.earn.unearnedSpendMinor, currency)} earned nothing — no rule matched. Add a base rule?</p>
      )}
      {result.earn.cardFeeSpendMinor > 0 && (
        <p className="mt-2 text-xs text-slate-500">{formatMinor(result.earn.cardFeeSpendMinor, currency)} in card fees and charges earns no points.</p>
      )}
    </Section>
  );
}

function ActualForm({ program, result, unit, currency, crediting }: { program: RewardProgramRow; result: CycleResult; unit: string; currency: string; crediting: 'per_transaction' | 'per_statement' }) {
  const { database, ws } = useApp();
  const { error, run } = useAction();
  const [value, setValue] = useState(result.actual === null ? '' : String(result.actual));
  const perPurchase = crediting === 'per_transaction';
  const diff = result.actual === null ? null : result.actual - result.earn.totalPoints;
  // Recomputes the cycle per purchase, so only when the saved statement total or the cycle changes, not per keystroke.
  const hints = useMemo(() => (!perPurchase && result.actual !== null && result.actual !== result.earn.totalPoints ? explainCycle(result.context, result.actual) : []), [perPurchase, result]);
  const dates = Object.fromEntries(result.lines.map((line) => [line.transactionId, line.occurredOn]));
  const descriptions = Object.fromEntries(result.lines.map((line) => [line.transactionId, line.description]));
  const estimatedBonus = Object.values(result.earn.bonusById).reduce((sum, points) => sum + points, 0);
  const range = `${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => recordCycleActual(database, ws, { programId: program.id, cycleStart: result.cycle.start, actualPoints: Number(value.trim().replace(',', '.')) }));
  };
  return (
    <Section title={perPurchase ? `Bonus points credited: ${range}` : `Check against statement: ${range}`}>
      {perPurchase ? (
        <p className="text-sm text-slate-600">
          Points your bank credited outside individual purchases, such as cycle bonuses. Estimated <span className="tabular font-medium">{formatPoints(estimatedBonus)}</span> {unit}.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          Projected <span className="tabular font-medium">{formatPoints(result.earn.totalPoints)}</span> {unit}.
          {diff !== null && (diff === 0 ? ' Statement matches exactly.' : ` Statement shows ${diff > 0 ? '+' : ''}${formatPoints(diff)} vs projection.`)}
        </p>
      )}
      {hints.length > 0 && (
        <div className="mt-2 space-y-2">
          <div className="text-xs font-semibold text-slate-600">Likely causes</div>
          {hints.map((hint, i) => (
            <div key={i} className="rounded bg-amber-50 p-2 text-xs">
              <p>{describeSuggestion(hint, unit, currency, descriptions)}</p>
              <SuggestionFixes suggestion={hint} description={hint.kind === 'mcc' ? (descriptions[hint.transactionId] ?? '') : ''} occurredOn={hint.kind === 'mcc' ? dates[hint.transactionId] : undefined} run={run} />
            </div>
          ))}
        </div>
      )}
      {!perPurchase && diff !== null && diff !== 0 && hints.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">No MCC, bonus, or rounding in this card's rules explains the difference. A rule may need adjusting.</p>
      )}
      <form onSubmit={submit} className="mt-2 flex items-end gap-2">
        <Field label={perPurchase ? 'Bonus points credited' : `Actual ${unit} on statement`}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required />
        </Field>
        <Button type="submit">Save</Button>
      </form>
      <ErrorBox error={error} />
    </Section>
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

  if (accounts.isSuccess && !card) return <Empty>Card not found.</Empty>;
  if (!card || !data.data) return <p className="text-sm text-slate-500">Loading…</p>;
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

  const owed = displayAmount('liability', balances.data?.[card.id] ?? 0);
  const optionalMinor = (v: string) => (v.trim() ? parseMajor(v, currency) : null);
  // Setup is ordered: the statement day defines cycles, a program holds rules, and rules produce points.
  const hasTerms = !!cp.terms;
  const step = !hasTerms ? 1 : !cp.program ? 2 : cp.rules.length === 0 ? 3 : null;
  const canUseCatalog = !cp.program || cp.catalog.status === null;
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
    <div className="space-y-4">
      <PageHeader title={card.name} action={<Link to="/cards" className="text-sm underline">All cards</Link>} />
      <ErrorBox error={error} />
      {cp.catalog.entryId && <CatalogPanel cp={cp} today={today} run={run} />}

      <Section title="Card terms" step={step === 1 ? 'Step 1 of 3' : undefined}>
        {step === 1 && (
          <p className="mb-3 text-sm text-slate-600">
            Start with your statement day. It decides which purchases count toward each points cycle and when bonus caps reset.
          </p>
        )}
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => saveCardTerms(database, ws, { accountId: card.id, statementDay: Number(statementDay), dueDay: Number(dueDay), creditLimitMinor: optionalMinor(limit), annualFeeMinor: optionalMinor(fee) }));
          }}
        >
          <Field label="Statement day">
            <Input value={statementDay} onChange={(e) => setStatementDay(e.target.value)} inputMode="numeric" placeholder="25" required />
          </Field>
          <Field label="Payment due day">
            <Input value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" placeholder="12" required />
          </Field>
          <Field label={`Credit limit (${currency})`}>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={`Annual fee (${currency})`}>
            <Input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />
          </Field>
          <div className="flex items-center gap-4 md:col-span-4">
            <Button type="submit">Save terms</Button>
            <span className="text-sm text-slate-600">
              Owed now <Money minor={owed} currency={currency} />
              {cp.terms?.creditLimitMinor ? ` · ${Math.round((owed / cp.terms.creditLimitMinor) * 100)}% of limit` : ''}
            </span>
          </div>
        </form>
      </Section>

      <Section title="Cards on this account">
        <p className="mb-3 text-sm text-slate-600">
          One statement, one limit — and sometimes more than one card. A supplementary card spends against this same
          account, so recording its last four digits is what tells whose spending is whose.
        </p>
        {plastic.length > 0 && (
          <ul className="mb-3 divide-y divide-slate-100">
            {plastic.map((piece) => (
              <li key={piece.id} data-testid="card-on-account" className="flex items-center gap-3 py-1.5 text-sm">
                <span className="tabular">···· {piece.last4 ?? '????'}</span>
                <span className="flex-1 text-slate-600">{piece.holderName ?? (piece.isPrimary ? 'Primary' : 'Supplementary')}</span>
                <Button variant="ghost" aria-label={`Remove card ending ${piece.last4 ?? 'unknown'}`} onClick={() => void run(() => archiveCard(database, ws, piece.id))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await addCard(database, ws, { accountId: card.id, last4: newLast4, holderName: newHolder, isPrimary: plastic.length === 0 });
              setNewLast4('');
              setNewHolder('');
            });
          }}
        >
          <Field label="Last 4 digits">
            <Input value={newLast4} onChange={(e) => setNewLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="8802" />
          </Field>
          <Field label="Whose card" hint="Optional. Yours, or whoever holds the supplementary card.">
            <Input value={newHolder} onChange={(e) => setNewHolder(e.target.value)} placeholder="Spouse" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              Add card
            </Button>
          </div>
        </form>
      </Section>

      {step === 1 && (
        <Section title="Is your card in the catalogue?">
          <CatalogPicker today={today} selectedId={catalogId} onSelect={chooseEntry} applyHint="Save the card terms above, then use these terms in the next step." />
        </Section>
      )}

      {hasTerms && !cp.program && (
        <Section title="Rewards program" step="Step 2 of 3">
          <h3 className="mb-2 text-sm font-medium">Choose from catalogue</h3>
          <CatalogPicker today={today} selectedId={catalogId} onSelect={chooseEntry} onApply={applyEntry} />
          <h3 className="mb-2 mt-6 text-sm font-medium">Or set up manually</h3>
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => createProgram(database, ws, { cardAccountId: card.id, name: programName, unit, cycleAnchor: anchor }));
            }}
          >
            <Field label="Program name">
              <Input value={programName} onChange={(e) => setProgramName(e.target.value)} required />
            </Field>
            <Field label="Earns">
              <Select value={unit} onChange={(e) => setUnit(e.target.value as RewardProgramRow['unit'])}>
                <option value="points">Points</option>
                <option value="miles">Miles</option>
                <option value="cashback">Cashback</option>
              </Select>
            </Field>
            <Field label="Caps reset">
              <Select value={anchor} onChange={(e) => setAnchor(e.target.value as RewardProgramRow['cycleAnchor'])}>
                <option value="statement">Each statement cycle</option>
                <option value="calendar">Each calendar month</option>
              </Select>
            </Field>
            <div className="md:col-span-3">
              <Button type="submit">Set up rewards</Button>
            </div>
          </form>
        </Section>
      )}

      {hasTerms && cp.program && (
        <>
          {ledger.data && (
            <Section title="Points balance">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="text-2xl font-semibold" data-testid="points-balance">
                  {formatPoints(ledger.data.balance.total)} {cp.program.unit}
                </div>
                <div className="text-xs text-slate-500" data-testid="points-provenance">
                  {formatPoints(ledger.data.balance.postedTotal)} posted · {formatPoints(ledger.data.balance.projectedTotal)} estimated
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Posted points come from figures you typed in. Estimated points are worked out from your rules, and become posted as you
                record what the bank actually gave.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => void run(() => backfillCycles(database, ws, cp.program!.id, 24, today))}>
                  Catch up this card
                </Button>
                <span className="text-xs text-slate-500">
                  Works the last two years of cycles out from purchases already recorded here. Points earned before you used this app are not
                  among them — type the balance the issuer shows instead.
                </span>
              </div>
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
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
                <Field label="Balance in the app">
                  <Input value={observedBalance} onChange={(event) => setObservedBalance(event.target.value)} inputMode="decimal" required />
                </Field>
                <Field label="Earned around" hint="Roughly when those points were earned, which decides when they expire. Empty counts them as earned today.">
                  <Input type="date" value={anchorEarnedOn} onChange={(event) => setAnchorEarnedOn(event.target.value)} />
                </Field>
                <Button type="submit" variant="secondary">
                  Anchor balance
                </Button>
              </form>
            </Section>
          )}
          {ledger.data && cp.rules.length > 0 && (
            <Section title="Spend points">
              <form
                className="grid gap-3 md:grid-cols-5 md:items-end"
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
                  });
                }}
              >
                <Field label={`${cp.program.unit === 'miles' ? 'Miles' : 'Points'} spent`}>
                  <Input value={spendPoints} onChange={(event) => setSpendPoints(event.target.value)} inputMode="decimal" required />
                </Field>
                <Field label="What for">
                  <Input value={spendNote} onChange={(event) => setSpendNote(event.target.value)} placeholder="Statement credit" />
                </Field>
                <Field label={`What it fetched (${currency})`} hint="Leave empty if it had no cash value.">
                  <Input value={spendValue} onChange={(event) => setSpendValue(event.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Kind">
                  <Select value={spendKind} onChange={(event) => setSpendKind(event.target.value as 'redeem' | 'transfer')}>
                    <option value="redeem">Redeemed</option>
                    <option value="transfer">Moved to a partner</option>
                  </Select>
                </Field>
                <div className="pb-1">
                  <Button type="submit" variant="secondary">
                    Spend points
                  </Button>
                </div>
              </form>
              <p className="mt-2 text-xs text-slate-500">Taken from the points that expire soonest, so none are lost that could have been used.</p>
            </Section>
          )}

          {ledger.data && (
            <Section title="What the annual fee bought">
              <div className="grid gap-3 sm:grid-cols-4" data-testid="card-year-roi">
                <div>
                  <div className="text-xs text-slate-500">Earned</div>
                  <div className="text-lg font-semibold">
                    {formatPoints(ledger.data.roi.pointsEarned)} {cp.program.unit}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Worth</div>
                  <div className="text-lg font-semibold">
                    <Money minor={ledger.data.roi.valueMinor} currency={currency} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Annual fee</div>
                  <div className="text-lg font-semibold">
                    <Money minor={ledger.data.roi.annualFeeMinor} currency={currency} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Net</div>
                  <div className={cx('text-lg font-semibold', ledger.data.roi.netMinor < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                    <Money minor={ledger.data.roi.netMinor} currency={currency} />
                  </div>
                </div>
              </div>
              {ledger.data.roi.realised && (
                <div className="mt-3 flex flex-wrap items-baseline gap-3 border-t border-slate-100 pt-3" data-testid="card-year-realised">
                  <span className="text-xs text-slate-500">At what your points have really fetched</span>
                  <span className="text-sm font-semibold">
                    <Money minor={ledger.data.roi.realised.valueMinor} currency={currency} /> earned
                  </span>
                  <span className={cx('text-sm font-semibold', ledger.data.roi.realised.netMinor < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                    <Money minor={ledger.data.roi.realised.netMinor} currency={currency} /> net
                  </span>
                  <span className="text-xs text-slate-500">The figures above value points at the best option, which assumes the best use.</span>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {ledger.data.roi.from} to {ledger.data.roi.to} ·{' '}
                {ledger.data.roi.anchoredOn === 'fee' ? 'from the day the fee was charged' : 'the last twelve months, since no fee charge is recorded'}
                {ledger.data.roi.estimated ? ' · estimated, because some points were worked out rather than confirmed' : ''}
              </p>
            </Section>
          )}

          {cp.current && cp.rules.length > 0 && (
            <CycleSummary title="This cycle" result={cp.current} rules={cp.rules} bonuses={cp.bonuses} partners={cp.transferPartners} unit={cp.program.unit} currency={currency} best={cp.best} today={today} />
          )}
          {cp.current && cp.rules.length > 0 && <PurchaseList cp={cp} run={run} currency={currency} />}
          {cp.previous && cp.rules.length > 0 && <ActualForm program={cp.program} result={cp.previous} unit={cp.program.unit} currency={currency} crediting={cp.crediting} />}

          <Section
            title="Earn rules"
            step={step === 3 ? 'Step 3 of 3' : undefined}
            action={
              editingRule === null && (
                <div className="flex gap-2">
                  {canUseCatalog && (
                    <Button variant="ghost" onClick={() => setBrowsingCatalog(!browsingCatalog)}>
                      {browsingCatalog ? 'Close catalogue' : 'Choose from catalogue'}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setEditingRule('new')}>
                    Add rule
                  </Button>
                </div>
              )
            }
          >
            {browsingCatalog && canUseCatalog && (
              <div className="mb-4 rounded border border-slate-200 p-3">
                <CatalogPicker today={today} selectedId={catalogId} onSelect={chooseEntry} onApply={applyEntry} />
              </div>
            )}
            {editingRule === 'new' && (
              <RuleForm programId={cp.program.id} currency={currency} accounts={all} suggestBase={cp.rules.length === 0} beforeSave={confirmCustomise} onDone={() => setEditingRule(null)} />
            )}
            {cp.rules.length === 0 && editingRule === null && (
              <Empty>Add your card's base earn rate first. The form starts with a typical rate — change it to match your card. Then add bonus rules with a higher priority.</Empty>
            )}
            <ul className="divide-y divide-slate-100">
              {[...cp.rules].sort((a, b) => b.priority - a.priority).map((rule) =>
                editingRule !== 'new' && editingRule?.id === rule.id ? (
                  <li key={rule.id} className="py-2">
                    <RuleForm programId={cp.program!.id} currency={currency} accounts={all} initial={rule} beforeSave={confirmCustomise} onDone={() => setEditingRule(null)} />
                  </li>
                ) : (
                  <li key={rule.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {rule.name} {rule.stackable && <span className="text-xs text-slate-500">(stacks)</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatPoints(rule.rateNum)} per {formatMinor(rule.rateDen, currency)} · priority {rule.priority}
                        {rule.validFrom && ` · from ${rule.validFrom}`}
                        {rule.validTo && ` · until ${rule.validTo}`}
                        {rule.capSpendMinor !== null && ` · cap ${formatMinor(rule.capSpendMinor, currency)}/cycle`}
                        {(() => {
                          const parts = ruleQualifiers(rule, (id) => all.find((a) => a.id === id)?.name ?? '?', (minor) => formatMinor(minor, currency));
                          return parts.length ? parts.map((part) => ` · ${part}`).join('') : ' · all categories';
                        })()}
                      </div>
                    </div>
                    <Button variant="ghost" onClick={() => setEditingRule(rule)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => window.confirm(`Remove rule ${rule.name}?`) && confirmCustomise() && void run(() => archiveEarnRule(database, ws, rule.id))}>
                      Remove
                    </Button>
                  </li>
                ),
              )}
            </ul>
          </Section>

          {cp.rules.length > 0 && (
            <Section
              title="Spend bonuses"
              action={
                editingBonus === null && (
                  <Button variant="secondary" onClick={() => confirmCustomise() && setEditingBonus('new')}>
                    Add bonus
                  </Button>
                )
              }
            >
              {editingBonus === 'new' && (
                <BonusForm
                  programId={cp.program.id}
                  currency={currency}
                  unit={cp.program.unit}
                  accounts={all}
                  beforeSave={confirmCustomise}
                  onDone={() => setEditingBonus(null)}
                />
              )}
              {cp.bonuses.length === 0 && editingBonus === null && (
                <Empty>No spend bonuses. Add one for a card that pays a lump for reaching a spend in a cycle.</Empty>
              )}
              <ul className="divide-y divide-slate-100">
                {cp.bonuses.map((bonus) =>
                  editingBonus !== 'new' && editingBonus?.id === bonus.id ? (
                    <li key={bonus.id} className="py-2">
                      <BonusForm
                        programId={cp.program!.id}
                        currency={currency}
                        unit={cp.program!.unit}
                        accounts={all}
                        initial={bonus}
                        beforeSave={confirmCustomise}
                        onDone={() => setEditingBonus(null)}
                      />
                    </li>
                  ) : (
                    <li key={bonus.id} className="flex items-center gap-3 py-2 text-sm" data-testid={`bonus-${bonus.id}`}>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {bonus.name}
                          {!activeDuring(bonus, today, today) && <span className="ml-2 text-xs font-normal text-slate-500">past terms</span>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {bonus.tiers
                            .map((tier) => `${formatMinor(tier.minSpendMinor, currency)} → ${formatPoints(tier.bonus)} ${cp.program!.unit}`)
                            .join(' · ')}
                          {bonus.validFrom && ` · from ${bonus.validFrom}`}
                          {bonus.validTo && ` · until ${bonus.validTo}`}
                        </div>
                      </div>
                      <Button variant="ghost" onClick={() => confirmCustomise() && setEditingBonus(bonus)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          window.confirm(`Remove bonus ${bonus.name}?`) && confirmCustomise() && void run(() => archiveCycleBonus(database, ws, bonus.id))
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ),
                )}
              </ul>
            </Section>
          )}

          {cp.rules.length > 0 && (
            <Section title="What points are worth">
              <ul className="mb-3 divide-y divide-slate-100">
                {cp.redemptions.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {r.name}: {formatPoints(r.perPoints)} {cp.program!.unit} = {formatMinor(r.valueMinor, r.currency)}
                    </span>
                    <Button variant="ghost" onClick={() => confirmCustomise() && void run(() => deleteRedemptionOption(database, ws, r.id))}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              <form
                className="grid gap-3 md:grid-cols-4"
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
                <Field label="Redemption">
                  <Input value={redeemName} onChange={(e) => setRedeemName(e.target.value)} placeholder="Statement credit" />
                </Field>
                <Field label={cp.program.unit === 'miles' ? 'Miles redeemed' : 'Points redeemed'}>
                  <Input value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} inputMode="numeric" placeholder="1000" required />
                </Field>
                <Field label="Worth">
                  <Input value={redeemValue} onChange={(e) => setRedeemValue(e.target.value)} inputMode="decimal" placeholder="2500" required />
                </Field>
                <Field label="Currency">
                  <Select value={redeemCurrency} onChange={(e) => setRedeemCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="md:col-span-4">
                  <Button type="submit" variant="secondary">
                    Add value
                  </Button>
                </div>
              </form>
            </Section>
          )}
        </>
      )}

      <InstallmentList cardAccountId={card.id} currency={currency} />
    </div>
  );
}
