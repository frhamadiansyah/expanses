import { formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, postTransaction } from '@expanses/db';
import { ArrowUpDown } from 'lucide-react';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN, TextRow } from '../../ui/native';
import { useCanHold } from '../goals/queries';
import { doorOfForm, postForDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { formToPost, settledAmount } from '../transactions/tx-form';
import { ratesForSave } from '../transactions/tx-save';
import { currencyName, figureFace, figureFromTyped, moveDescription, moveDraft, moveView, pocketsOf, swapPockets, withPockets } from './pockets';
import { MovePocketRow } from './MovePocketRow';
import { useHeldRates } from './queries';

export function MovePage() {
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts();
  if (!accounts.isSuccess) return <div className={SCREEN}>Loading…</div>;
  const parent = accounts.data.find((a) => a.id === accountId);
  const pockets = pocketsOf(accountId, accounts.data);
  if (!parent || pockets.length < 2)
    return (
      <div className={SCREEN}>
        <LargeTitle title="Move between pockets" back="Wallet" backTo="/wallet" />
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
  const router = useRouter();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  // A step back in the history, not a new visit to the account: a link would stack the account page again on top of this
  // one, and the account's ✕ would then step back into this page instead of out to Wallet.
  const back = () => (router.history.canGoBack() ? router.history.back() : void navigate({ to: '/accounts/$accountId', params: { accountId: parent.id } }));
  const balances = useBalances().data ?? {};
  const [draft, setDraft] = useState(() => moveDraft(ws.bookId ?? '', pockets[0]!, pockets[1]!));
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const from = pockets.find((p) => p.id === draft.moneyId)!;
  const to = pockets.find((p) => p.id === draft.toId)!;
  const held = useHeldRates([from.currency!, to.currency!], draft.occurredOn);
  const view = moveView(draft, accounts, ws.baseCurrency, held.data?.rates ?? {});
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
      await postTransaction(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      await navigate({ to: '/accounts/$accountId', params: { accountId: parent.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const choice = (p: AccountRow) => ({ id: p.id, name: currencyName(p.currency!), available: formatMinor(balances[p.id] ?? 0, p.currency!) });
  const choices = pockets.map(choice);
  // A rate row asked for the old pair; the new pair asks again on Save if it needs one.
  const choose = (patch: { moneyId?: string; toId?: string }) => {
    setNeedsRate(null);
    setDraft((d) => withPockets(d, patch));
  };

  return (
    <div className={SCREEN}>
      <LargeTitle title="Move between pockets" back={parent.name} onBack={back} />
      <ErrorBox error={error} />
      {/* Layout B (owner, 17 Nov 2026): one box, the two pockets its rows, the ⇅ on the hairline between them. */}
      <InsetGroup className="!mb-[22px]">
        <MovePocketRow
          word="From"
          current={choice(from)}
          choices={choices}
          onPick={(id) => choose({ moneyId: id })}
          figure={{
            'aria-label': `Leaves ${view.leaves.currency}`,
            value: figureFace(view.leaves.value, view.leaves.currency),
            onChange: (e) => set({ amount: figureFromTyped(e.target.value, view.leaves.currency) }),
            onBlur: () => settle('amount', view.leaves.value, view.leaves.currency),
          }}
        />
        <MovePocketRow
          word="To"
          current={choice(to)}
          choices={choices}
          onPick={(id) => choose({ toId: id })}
          onLine={
            <button
              type="button"
              aria-label="Swap"
              onClick={() => {
                setNeedsRate(null);
                setDraft(swapPockets);
              }}
              className="ph-focus ph-tap flex h-[32px] w-[32px] items-center justify-center rounded-full border-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-surface)] text-[var(--ph-ink-2)]"
            >
              <ArrowUpDown size={15} aria-hidden />
            </button>
          }
          figure={
            view.arrives
              ? {
                  'aria-label': `Arrives ${view.arrives.currency}`,
                  value: figureFace(view.arrives.value, view.arrives.currency),
                  onChange: (e) => set({ toAmount: figureFromTyped(e.target.value, view.arrives!.currency) }),
                  onBlur: () => settle('toAmount', view.arrives!.value, view.arrives!.currency),
                }
              : null
          }
        />
      </InsetGroup>
      <InsetGroup>
        <ReadOnlyRow
          label="Rate"
          value={view.rateText}
          info="The bank’s rate, worked out from the two figures typed."
        />
        <TextRow label="Date" type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />
        {needsRate && (
          <TextRow label={`Rate: ${ws.baseCurrency} per 1 ${needsRate}`} value={draft.manualRate} onChange={(e) => set({ manualRate: e.target.value })} inputMode="decimal" />
        )}
      </InsetGroup>
      {setAside.node}
      <InsetGroup>
        <InsetRow title="Move" action onClick={() => !busy && setAside.ready && void save()} className={busy || !setAside.ready ? 'opacity-40' : undefined} />
      </InsetGroup>
    </div>
  );
}
