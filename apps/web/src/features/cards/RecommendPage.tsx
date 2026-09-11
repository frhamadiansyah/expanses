import { type CompareTarget, CURRENCIES, formatMinor, isoDate, parseMajor, type Recommendation, recommendCards } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { CategoryOptions } from './options';
import { compareTargets } from './recommend-targets';
import { expenseAncestors, formatPoints, loadCardPoints } from './useCardPoints';

const VALUE = 'value';

export function RecommendPage() {
  const { database, ws } = useApp();
  const all = useAccounts().data ?? [];
  const [amount, setAmount] = useState('');
  const [spentIn, setSpentIn] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(isoDate());
  const [compareIn, setCompareIn] = useState(VALUE);
  const [results, setResults] = useState<{ target: CompareTarget; list: Recommendation[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const cards = all.filter((a) => a.subtype === 'credit_card' && a.archivedAt === null);
  const loadAll = (onDate: string) => Promise.all(cards.map((card) => loadCardPoints(database, ws, card, all, onDate)));
  const targets = useQuery({
    queryKey: ['recommend-targets', ws.workspaceId, cards.map((c) => c.id).join(',')],
    enabled: cards.length > 0,
    queryFn: async () => compareTargets((await loadAll(isoDate())).map((cp) => ({ programName: cp.program?.name ?? null, transferPartners: cp.transferPartners }))),
  });

  async function compare(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!categoryId) throw new Error('Choose a category');
      const amountMinor = parseMajor(amount, ws.baseCurrency);
      if (amountMinor <= 0) throw new Error('Amount must be greater than zero');
      const loaded = await loadAll(date);
      const candidates = loaded.map((cp) => ({
        cardAccountId: cp.card.id,
        cardName: cp.card.name,
        currency: cp.card.currency!,
        rules: cp.rules,
        programName: cp.program?.name ?? null,
        bonuses: cp.bonuses,
        transferPartners: cp.transferPartners,
        cycleLines: cp.current?.lines ?? [],
        bestRedemption: cp.best,
      }));
      const target: CompareTarget = compareIn === VALUE ? { kind: 'value' } : { kind: 'program', program: compareIn };
      const query = { amountMinor, currency: ws.baseCurrency, originalCurrency: spentIn || null, mcc: null, categoryId, description: merchant, occurredOn: date };
      setResults({ target, list: recommendCards(query, candidates, expenseAncestors(all), target) });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Which card should I use?" />
      <Card>
        <form onSubmit={compare} className="grid gap-3 md:grid-cols-2">
          <Field label={`Amount (${ws.baseCurrency})`} hint={spentIn ? `The ${ws.baseCurrency} amount billed after conversion.` : undefined}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
          </Field>
          <Field label="Spent in" hint="Currency the merchant charges. Some cards earn more in certain currencies.">
            <Select value={spentIn} onChange={(e) => setSpentIn(e.target.value)}>
              <option value="">{ws.baseCurrency}</option>
              {CURRENCIES.filter((c) => c.code !== ws.baseCurrency).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <CategoryOptions accounts={all} kind="expense" />
            </Select>
          </Field>
          <Field label="Merchant" hint="Optional. Matches merchant keywords in your rules.">
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Sushi Tei" />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Compare in" hint="Value uses each card's redemption rate; a program converts through transfer partners.">
            <Select value={compareIn} onChange={(e) => setCompareIn(e.target.value)}>
              <option value={VALUE}>{ws.baseCurrency} value</option>
              {(targets.data ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              Compare cards
            </Button>
          </div>
        </form>
        <ErrorBox error={error} />
      </Card>

      {results && results.list.length === 0 && <Empty>No credit cards yet.</Empty>}
      {results?.list.map((r, i) => {
        const { target } = results;
        const best = i === 0 && r.eligible && (target.kind === 'program' ? r.comparable && (r.compareUnits ?? 0) > 0 : r.points > 0);
        return (
          <Card key={r.cardAccountId} className={cx(best && 'ring-2 ring-emerald-600')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">
                  {best && <span className="mr-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">Best</span>}
                  {r.cardName}
                </div>
                {!r.eligible && <div className="text-xs text-slate-500">Card currency differs from this purchase</div>}
                {r.eligible && r.points === 0 && <div className="text-xs text-slate-500">No earn rule matches — set up rules on the card page</div>}
                {target.kind === 'program' && r.eligible && !r.comparable && <div className="text-xs text-slate-500">Can't reach {target.program} from this card</div>}
                {r.capHeadroom.map((h) => (
                  <div key={h.ruleId} className="text-xs text-slate-500">
                    {h.ruleName}: {formatMinor(h.remainingMinor, ws.baseCurrency)} left this cycle
                  </div>
                ))}
              </div>
              <div className="text-right">
                <div className="tabular font-semibold">{formatPoints(r.points)} pts</div>
                {target.kind === 'program' ? (
                  <div className="tabular text-sm">{r.compareUnits !== null ? `≈ ${formatPoints(r.compareUnits)} ${target.program}` : '—'}</div>
                ) : (
                  <>
                    {r.valueMinor !== null && r.valueCurrency && (
                      <div className="text-sm">
                        ≈ <Money minor={r.valueMinor} currency={r.valueCurrency} />
                      </div>
                    )}
                    {r.effectiveRateBps !== null && <div className="text-xs text-slate-500">{(r.effectiveRateBps / 100).toFixed(2)}% back</div>}
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
