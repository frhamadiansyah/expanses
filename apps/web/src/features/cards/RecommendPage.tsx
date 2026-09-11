import { formatMinor, isoDate, parseMajor, type Recommendation, recommendCards } from '@expanses/core';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { CategoryOptions } from './options';
import { expenseAncestors, formatPoints, loadCardPoints } from './useCardPoints';

export function RecommendPage() {
  const { database, ws } = useApp();
  const all = useAccounts().data ?? [];
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(isoDate());
  const [results, setResults] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function compare(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!categoryId) throw new Error('Choose a category');
      const amountMinor = parseMajor(amount, ws.baseCurrency);
      if (amountMinor <= 0) throw new Error('Amount must be greater than zero');
      const cards = all.filter((a) => a.subtype === 'credit_card' && a.archivedAt === null);
      const loaded = await Promise.all(cards.map((card) => loadCardPoints(database, ws, card, all, date)));
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
      setResults(recommendCards({ amountMinor, currency: ws.baseCurrency, originalCurrency: null, categoryId, description: merchant, occurredOn: date }, candidates, expenseAncestors(all)));
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
          <Field label={`Amount (${ws.baseCurrency})`}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
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
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              Compare cards
            </Button>
          </div>
        </form>
        <ErrorBox error={error} />
      </Card>

      {results && results.length === 0 && <Empty>No credit cards yet.</Empty>}
      {results?.map((r, i) => (
        <Card key={r.cardAccountId} className={cx(i === 0 && r.eligible && r.points > 0 && 'ring-2 ring-emerald-600')}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">
                {i === 0 && r.eligible && r.points > 0 && <span className="mr-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">Best</span>}
                {r.cardName}
              </div>
              {!r.eligible && <div className="text-xs text-slate-500">Card currency differs from this purchase</div>}
              {r.eligible && r.points === 0 && <div className="text-xs text-slate-500">No earn rule matches — set up rules on the card page</div>}
              {r.capHeadroom.map((h) => (
                <div key={h.ruleId} className="text-xs text-slate-500">
                  {h.ruleName}: {formatMinor(h.remainingMinor, ws.baseCurrency)} left this cycle
                </div>
              ))}
            </div>
            <div className="text-right">
              <div className="tabular font-semibold">{formatPoints(r.points)} pts</div>
              {r.valueMinor !== null && r.valueCurrency && (
                <div className="text-sm">
                  ≈ <Money minor={r.valueMinor} currency={r.valueCurrency} />
                </div>
              )}
              {r.effectiveRateBps !== null && <div className="text-xs text-slate-500">{(r.effectiveRateBps / 100).toFixed(2)}% back</div>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
