import { evaluateAmount, formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, exchangeResultOf, postTransaction } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { exchangeResultLine } from '../../lib/withdrawal-rate';
import { useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { useCanHold } from '../goals/queries';
import { doorOfForm, postForDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { useTransferPreview } from '../transactions/transfer-preview';
import { formToPost, type MoneyFieldSpec, settledAmount } from '../transactions/tx-form';
import { ratesForSave } from '../transactions/tx-save';
import { bankRateText, currencyName, moveDescription, moveDraft, moveView, pocketsOf, withPockets } from './pockets';
import { useHeldRates } from './queries';

/** Only reached once `moveView` has read both figures (it returns a cost only then): not a second reader. */
const evaluateOrZero = (field: MoneyFieldSpec) => evaluateAmount(field.value, field.currency) ?? 0;

export function MovePage() {
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts();
  if (!accounts.isSuccess) return <div className={SCREEN}>Loading…</div>;
  const parent = accounts.data.find((a) => a.id === accountId);
  const pockets = pocketsOf(accountId, accounts.data);
  if (!parent || pockets.length < 2)
    return (
      <div className={SCREEN}>
        <LargeTitle title="Move between pockets" back="Accounts" backTo="/accounts" />
        <Empty>This account has fewer than two pockets.</Empty>
      </div>
    );
  return <MoveBody parent={parent} pockets={pockets} accounts={accounts.data} />;
}

/**
 * An ordinary transfer between two pockets. Nothing here reads a figure or builds a line: `moveView` draws from the
 * kit's field records, and the save is the Transfer tab's own `formToPost` → `ratesForSave` → `postTransaction`.
 * It is a transfer door like the Transfer tab (set-aside ruling I5): silent unless the move takes more than is free in
 * the pocket it leaves, and then it asks the same question, "Move the promise" or "No — borrowing".
 */
function MoveBody({ parent, pockets, accounts }: { parent: AccountRow; pockets: AccountRow[]; accounts: AccountRow[] }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const balances = useBalances().data ?? {};
  const [draft, setDraft] = useState(() => moveDraft(ws.bookId ?? '', pockets[0]!, pockets[1]!));
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  /** The gain or loss the ledger recorded, kept only when it is not the one the screen showed (R15, spec §10.3 of pockets). */
  const [recorded, setRecorded] = useState<number | null>(null);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const from = pockets.find((p) => p.id === draft.moneyId)!;
  const to = pockets.find((p) => p.id === draft.toId)!;
  const held = useHeldRates([from.currency!, to.currency!], draft.occurredOn);
  const view = moveView(draft, accounts, ws.baseCurrency, held.data?.rates ?? {});
  // Withdrawal rate §7: the Rate against the market, and out of a foreign pocket its cost and gain or loss.
  const preview = useTransferPreview(draft, accounts, null);
  const rateDate = draft.occurredOn > isoDate() ? isoDate() : draft.occurredOn;
  const canHold = useCanHold();
  const post = useMemo(() => postForDoor(draft, accounts), [draft, accounts]);
  const door = post ? doorOfForm(draft, post, accounts, canHold) : null;
  const setAside = useSetAside(door, { toName: to.name });

  const settle = (which: 'amount' | 'toAmount', value: string, currency: string) => {
    const text = settledAmount(value, currency);
    if (text !== null && text !== value) set({ [which]: text });
  };

  async function save() {
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const final = { ...draft, description: moveDescription(parent, from, to) };
      const post = formToPost(final, accounts);
      if (post.kind !== 'post') throw new Error('A move between pockets is a plain transfer');
      const ratesToBase = await ratesForSave({ database, ws, draft: final, post, accounts, rateDate, needsRate, resolveRates, onMissing: setNeedsRate, where: 'Rate' });
      const id = await postTransaction(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      // What arrived is valued at the day's rate the save fetched, which need not be the one on screen. When the gain or
      // loss the ledger now holds differs from the one shown, say so instead of leaving the screen's figure standing.
      if (preview.gainLossBaseMinor !== null) {
        const gainLoss = await exchangeResultOf(database, id);
        if (gainLoss !== preview.gainLossBaseMinor) {
          setRecorded(gainLoss);
          return;
        }
      }
      await navigate({ to: '/accounts/$accountId', params: { accountId: parent.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // Valued by currency code: an account has one open pocket per currency, so the code names the pocket and a test
  // can choose it without knowing an id. `idOf` turns it back into the pocket the draft holds.
  const option = (p: AccountRow) => (
    <option key={p.id} value={p.currency!}>
      {`${currencyName(p.currency!)} · ${formatMinor(balances[p.id] ?? 0, p.currency!)} available`}
    </option>
  );
  const idOf = (code: string) => pockets.find((p) => p.currency === code)!.id;
  // A rate row asked for the old pair; the new pair asks again on Save if it needs one.
  const choose = (patch: { moneyId?: string; toId?: string }) => {
    setNeedsRate(null);
    setDraft((d) => withPockets(d, patch));
  };

  if (recorded !== null) {
    const line = exchangeResultLine(recorded, ws.baseCurrency);
    return (
      <div className={SCREEN}>
        <LargeTitle title="Moved" back={parent.name} backTo="/accounts/$accountId" backParams={{ accountId: parent.id }} />
        <InsetGroup header="Recorded" footer={`The move was recorded at the rates for ${rateDate}, not the ones the screen showed, so this is the result the ledger holds.`}>
          <InsetRow testId="recorded-spread" title={line.title} value={`${line.figure} (${line.note})`} valueTone="ink" chevron={false} />
        </InsetGroup>
        <InsetGroup>
          <InsetRow title="Done" chevron={false} onClick={() => void navigate({ to: '/accounts/$accountId', params: { accountId: parent.id } })} />
        </InsetGroup>
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Move between pockets" back={parent.name} backTo="/accounts/$accountId" backParams={{ accountId: parent.id }} />
      <ErrorBox error={error} />
      <InsetGroup>
        <SelectRow label="From" value={from.currency!} onChange={(e) => choose({ moneyId: idOf(e.target.value) })}>
          {pockets.map(option)}
        </SelectRow>
        <SelectRow label="To" value={to.currency!} onChange={(e) => choose({ toId: idOf(e.target.value) })}>
          {pockets.map(option)}
        </SelectRow>
        <TextRow
          label={`Leaves ${view.leaves.currency}`}
          value={view.leaves.value}
          onChange={(e) => set({ amount: e.target.value })}
          onBlur={() => settle('amount', view.leaves.value, view.leaves.currency)}
          inputMode="decimal"
        />
        {view.arrives && (
          <TextRow
            label={`Arrives ${view.arrives.currency}`}
            value={view.arrives.value}
            onChange={(e) => set({ toAmount: e.target.value })}
            onBlur={() => settle('toAmount', view.arrives!.value, view.arrives!.currency)}
            inputMode="decimal"
          />
        )}
        <ReadOnlyRow label="Rate" value={preview.rateText ?? bankRateText(view.bankRate, view.leaves.currency, view.arrives?.currency ?? view.leaves.currency)} />
        <TextRow label="Date" type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />
        {needsRate && (
          <TextRow label={`Rate: ${ws.baseCurrency} per 1 ${needsRate}`} value={draft.manualRate} onChange={(e) => set({ manualRate: e.target.value })} inputMode="decimal" />
        )}
      </InsetGroup>
      {preview.result && (
        <InsetGroup
          footer={
            preview.stale
              ? `At the last-known ${[view.leaves.currency, view.arrives?.currency].filter(Boolean).join(', ')} rates: moving it fetches the day’s rates and records the result at those, which may differ.`
              : `Cost is what ${formatMinor(evaluateOrZero(view.leaves), view.leaves.currency)} cost when it came in, oldest first; what arrives is valued at the day’s rate.`
          }
        >
          <InsetRow testId="exchange-cost" title="Cost" value={preview.costText ?? '—'} valueTone="ink" chevron={false} />
          <InsetRow
            testId="spread"
            title={preview.stale ? `${preview.result.title} (last known)` : preview.result.title}
            value={`${preview.result.figure} (${preview.result.note})`}
            valueTone="ink"
            chevron={false}
          />
        </InsetGroup>
      )}
      {setAside.node}
      <InsetGroup>
        <InsetRow title="Move it" chevron={false} onClick={() => !busy && setAside.ready && void save()} className={busy || !setAside.ready ? 'opacity-40' : undefined} />
      </InsetGroup>
    </div>
  );
}
