import { type CompareTarget, CURRENCIES, formatMinor, isoDate, mccName, parseMajor, type Recommendation, recommendCards, resolveMcc } from '@expanses/core';
import { mccSourcesFor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { CategoryOptions } from './options';
import { useProgramAccounts } from './card-queries';
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

  // An earning debit card competes for the same purchase, so it belongs in the comparison too.
  const earning = useProgramAccounts().data ?? new Set<string>();
  const cards = all.filter((a) => a.archivedAt === null && (a.subtype === 'credit_card' || earning.has(a.id)));
  const loadAll = (onDate: string) => Promise.all(cards.map((card) => loadCardPoints(database, ws, card, all, onDate)));
  const targets = useQuery({
    queryKey: ['recommend-targets', ws.workspaceId, cards.map((c) => c.id).join(',')],
    enabled: cards.length > 0,
    queryFn: async () => compareTargets((await loadAll(isoDate())).map((cp) => ({ programName: cp.program?.name ?? null, transferPartners: cp.transferPartners }))),
  });

  const mccSources = useQuery({ queryKey: ['mcc-sources', ws.workspaceId], queryFn: () => mccSourcesFor(database.db, ws) });
  const resolved = mccSources.data && categoryId ? resolveMcc(merchant, categoryId, { typed: null, ...mccSources.data }) : null;
  const resolvedFrom = resolved?.source === 'memory' ? 'you taught this merchant' : resolved?.source === 'bundled' ? 'typical for this merchant' : 'from the category';
  const merchantHint = resolved?.mcc
    ? `Compared as MCC ${resolved.mcc}${mccName(resolved.mcc) ? ` ${mccName(resolved.mcc)}` : ''} (${resolvedFrom}).`
    : 'Optional. Matches merchant keywords and merchant categories in your rules.';

  /**
   * The event is optional because the row that compares is a `type="button"` inside a real `<form>`: the form is
   * what keeps Enter in a field comparing, and the row is what a thumb presses.
   */
  async function compare(event?: FormEvent) {
    event?.preventDefault();
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
      const query = { amountMinor, currency: ws.baseCurrency, originalCurrency: spentIn || null, mcc: resolved?.mcc ?? null, categoryId, description: merchant, occurredOn: date };
      setResults({ target, list: recommendCards(query, candidates, expenseAncestors(all), target) });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Which card should I use?" />

      <form onSubmit={compare}>
        <InsetGroup header="What you are buying">
          <TextRow
            label={`Amount (${ws.baseCurrency})`}
            hint={spentIn ? `The ${ws.baseCurrency} amount billed after conversion.` : undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
          />
          <SelectRow
            label="Spent in"
            hint="Currency the merchant charges. Some cards earn more in certain currencies."
            value={spentIn}
            onChange={(e) => setSpentIn(e.target.value)}
          >
            <option value="">{ws.baseCurrency}</option>
            {CURRENCIES.filter((c) => c.code !== ws.baseCurrency).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </SelectRow>
          <SelectRow label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <CategoryOptions ownerWide accounts={all} kind="expense" />
          </SelectRow>
          <TextRow label="Merchant" hint={merchantHint} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Sushi Tei" />
          <TextRow label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectRow
            label="Compare in"
            hint="Value uses each card's redemption rate; a program converts through transfer partners."
            value={compareIn}
            onChange={(e) => setCompareIn(e.target.value)}
          >
            <option value={VALUE}>{ws.baseCurrency} value</option>
            {(targets.data ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>

        {/* The row is the action; the form around it is what makes Enter in a field compare as well. */}
        <InsetGroup>
          <InsetRow title="Compare cards" chevron={false} className={busy ? 'opacity-40' : undefined} onClick={() => !busy && void compare()} />
        </InsetGroup>
      </form>

      <ErrorBox error={error} />

      {results && results.list.length === 0 && <Empty>No credit cards yet.</Empty>}
      {results?.list.map((r, i) => {
        const { target } = results;
        const best = i === 0 && r.eligible && (target.kind === 'program' ? r.comparable && (r.compareUnits ?? 0) > 0 : r.points > 0);
        /*
         * One group per card, and no wrapping group around them all: a group is a `<section>`, and the specs find a
         * card by asking which section says its name. A section holding every card would answer for all of them.
         *
         * The caveat is the row's own second line rather than a separate element — a row is one line of title, one
         * of subtitle and one figure, and the caveat belongs to the card it is about.
         */
        const note = !r.eligible
          ? 'Card currency differs from this purchase'
          : r.points === 0
            ? 'No earn rule matches — set up rules on the card page'
            : target.kind === 'program' && !r.comparable
              ? `Can't reach ${target.program} from this card`
              : undefined;
        return (
          <InsetGroup key={r.cardAccountId}>
            <InsetRow
              title={
                <>
                  {best && <span className="mr-[6px] text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-tint)]">Best</span>}
                  {r.cardName}
                </>
              }
              subtitle={note}
              value={`${formatPoints(r.points)} pts`}
              chevron={false}
            />
            {target.kind === 'program' && r.eligible && (
              <InsetRow title={`In ${target.program}`} value={r.compareUnits !== null ? `≈ ${formatPoints(r.compareUnits)} ${target.program}` : '—'} chevron={false} />
            )}
            {target.kind === 'value' && r.valueMinor !== null && !!r.valueCurrency && (
              <InsetRow title="Worth at its best redemption" value={<Money minor={r.valueMinor} currency={r.valueCurrency} />} chevron={false} />
            )}
            {target.kind === 'value' && r.effectiveRateBps !== null && (
              <InsetRow title="Back on what you spend" value={`${(r.effectiveRateBps / 100).toFixed(2)}% back`} chevron={false} />
            )}
            {r.capHeadroom.map((h) => (
              <InsetRow key={h.ruleId} title={h.ruleName} subtitle="Left this cycle" value={formatMinor(h.remainingMinor, ws.baseCurrency)} chevron={false} />
            ))}
          </InsetGroup>
        );
      })}
    </div>
  );
}
