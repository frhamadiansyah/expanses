import { CURRENCIES, displayAmount, type EarnRule, formatMinor, isoDate, minorToMajorString, parseMajor, type Redemption } from '@expanses/core';
import {
  archiveEarnRule,
  createProgram,
  deleteRedemptionOption,
  type RewardProgramRow,
  recordCycleActual,
  saveCardTerms,
  saveRedemptionOption,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { RuleForm } from './RuleForm';
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

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function CycleSummary({ result, rules, unit, currency, best, title }: { result: CycleResult; rules: EarnRule[]; unit: string; currency: string; best: Redemption | null; title: string }) {
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
        {rules.map((rule) => {
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
      {result.earn.unearnedSpendMinor > 0 && (
        <p className="mt-2 text-xs text-amber-700">{formatMinor(result.earn.unearnedSpendMinor, currency)} earned nothing — no rule matched. Add a base rule?</p>
      )}
    </Section>
  );
}

function ActualForm({ program, result, unit }: { program: RewardProgramRow; result: CycleResult; unit: string }) {
  const { database, ws } = useApp();
  const { error, run } = useAction();
  const [value, setValue] = useState(result.actual === null ? '' : String(result.actual));
  const diff = result.actual === null ? null : result.actual - result.earn.totalPoints;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => recordCycleActual(database, ws, { programId: program.id, cycleStart: result.cycle.start, actualPoints: Number(value) }));
  };
  return (
    <Section title={`Check against statement: ${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}`}>
      <p className="text-sm text-slate-600">
        Projected <span className="tabular font-medium">{formatPoints(result.earn.totalPoints)}</span> {unit}.
        {diff !== null && (diff === 0 ? ' Statement matches exactly.' : ` Statement shows ${diff > 0 ? '+' : ''}${formatPoints(diff)} vs projection — a rule may need adjusting, or the bank credited differently.`)}
      </p>
      <form onSubmit={submit} className="mt-2 flex items-end gap-2">
        <Field label={`Actual ${unit} on statement`}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" required />
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
  const today = isoDate();
  const data = useQuery({
    queryKey: ['card-points', ws.workspaceId, today, cardId],
    enabled: !!card,
    queryFn: () => loadCardPoints(database, ws, card!, all, today),
  });
  const { error, run } = useAction();
  const [editingRule, setEditingRule] = useState<EarnRule | 'new' | null>(null);

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

  return (
    <div className="space-y-4">
      <PageHeader title={card.name} action={<Link to="/cards" className="text-sm underline">All cards</Link>} />
      <ErrorBox error={error} />

      <Section title="Card terms">
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

      {!cp.program ? (
        <Section title="Rewards program">
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
      ) : (
        <>
          {cp.current ? (
            <CycleSummary title="This cycle" result={cp.current} rules={cp.rules} unit={cp.program.unit} currency={currency} best={cp.best} />
          ) : (
            <Card>
              <p className="text-sm text-amber-700">Save the statement day above to track cycles.</p>
            </Card>
          )}
          {cp.previous && <ActualForm program={cp.program} result={cp.previous} unit={cp.program.unit} />}

          <Section title="Earn rules" action={editingRule === null && <Button variant="secondary" onClick={() => setEditingRule('new')}>Add rule</Button>}>
            {editingRule === 'new' && <RuleForm programId={cp.program.id} currency={currency} accounts={all} onDone={() => setEditingRule(null)} />}
            {cp.rules.length === 0 && editingRule === null && <Empty>Add a base rule first, e.g. 1 point per Rp 2.500, then bonus rules with higher priority.</Empty>}
            <ul className="divide-y divide-slate-100">
              {[...cp.rules].sort((a, b) => b.priority - a.priority).map((rule) =>
                editingRule !== 'new' && editingRule?.id === rule.id ? (
                  <li key={rule.id} className="py-2">
                    <RuleForm programId={cp.program!.id} currency={currency} accounts={all} initial={rule} onDone={() => setEditingRule(null)} />
                  </li>
                ) : (
                  <li key={rule.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {rule.name} {rule.stackable && <span className="text-xs text-slate-500">(stacks)</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {rule.rateNum} per {formatMinor(rule.rateDen, currency)} · priority {rule.priority}
                        {rule.capSpendMinor !== null && ` · cap ${formatMinor(rule.capSpendMinor, currency)}/cycle`}
                        {rule.match.categoryIds?.length ? ` · ${rule.match.categoryIds.map((id) => all.find((a) => a.id === id)?.name ?? '?').join(', ')}` : ' · all categories'}
                        {rule.match.merchantPatterns?.length ? ` · merchants: ${rule.match.merchantPatterns.join(', ')}` : ''}
                      </div>
                    </div>
                    <Button variant="ghost" onClick={() => setEditingRule(rule)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => window.confirm(`Remove rule ${rule.name}?`) && void run(() => archiveEarnRule(database, ws, rule.id))}>
                      Remove
                    </Button>
                  </li>
                ),
              )}
            </ul>
          </Section>

          <Section title="What points are worth">
            <ul className="mb-3 divide-y divide-slate-100">
              {cp.redemptions.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {r.name}: {formatPoints(r.perPoints)} {cp.program!.unit} = {formatMinor(r.valueMinor, r.currency)}
                  </span>
                  <Button variant="ghost" onClick={() => void run(() => deleteRedemptionOption(database, ws, r.id))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <form
              className="grid gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
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
        </>
      )}
    </div>
  );
}
