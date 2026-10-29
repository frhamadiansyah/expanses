import { isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { type EarmarkRow, type GoalRow, removeEarmark, saveEarmark } from '@expanses/db';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { addableAccounts, addedFromEarmarks, setAsideWrites } from './goal-form-model';
import { roomFor, setAsideHint } from './goal-cards';
import { useSetAsideViews } from './queries';

/**
 * The state behind Money set aside: the accounts added as rows, and the figure typed on each.
 *
 * Shared by the goal page's form and the saved goal's Set aside sheet, so the two cannot disagree about which
 * accounts may hold a goal's money, how much each can spare, or what a save writes.
 */
export function useSetAside(goal: GoalRow | undefined, earmarks: readonly EarmarkRow[]) {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const [added, setAdded] = useState<string[]>(() => addedFromEarmarks(earmarks, goal?.id));
  // Only what has been typed. What a row opens with is read at render, from the earmark and the account's own
  // currency, which is not known when this first runs: `accounts` may still be loading.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<string | null>(null);

  const eligible = moneyHolders(accounts.data ?? []).filter((account) => MONEY_SUBTYPES.includes(account.subtype));
  /**
   * A set-aside is in the account's own money, so the row is read and written in that currency.
   * (Typing `100,03` into a dollar row once met `IDR allows 0 decimal places`.)
   */
  const currencyOf = (account: { currency: string | null }) => account.currency ?? ws.baseCurrency;
  const earmarkOf = (accountId: string) => earmarks.find((earmark) => earmark.goalId === goal?.id && earmark.accountId === accountId);
  const textOf = (account: { id: string; currency: string | null }) => {
    const own = typed[account.id];
    if (own !== undefined) return own;
    const earmark = earmarkOf(account.id);
    return earmark ? minorToMajorString(earmark.amountMinor, currencyOf(account)) : '';
  };
  const rows = added.map((id) => eligible.find((account) => account.id === id)).filter((account): account is (typeof eligible)[number] => !!account);

  /** Writes the rows for a saved goal: a figure where there is one, and a letting go everywhere else. */
  async function write(goalId: string) {
    const writes = setAsideWrites(
      eligible.map((account) => account.id),
      added,
      (id) => {
        const account = eligible.find((row) => row.id === id)!;
        return textOf(account);
      },
    );
    for (const item of writes) {
      const account = eligible.find((row) => row.id === item.accountId)!;
      if (item.action === 'save') await saveEarmark(database, ws, { goalId, accountId: account.id, amountMinor: parseMajor(item.text, currencyOf(account)) });
      else if (earmarkOf(account.id)) await removeEarmark(database, ws, goalId, account.id);
    }
  }

  return {
    eligible,
    rows,
    addable: addableAccounts(eligible, added),
    currencyOf,
    earmarkOf,
    textOf,
    setText: (id: string, text: string) => setTyped((was) => ({ ...was, [id]: text })),
    typedText: (id: string) => typed[id],
    add: (id: string) => {
      setAdded((was) => (was.includes(id) ? was : [...was, id]));
      setFocus(id);
    },
    remove: (id: string) => {
      setAdded((was) => was.filter((row) => row !== id));
      setTyped((was) => {
        const { [id]: _gone, ...rest } = was;
        return rest;
      });
    },
    focus,
    write,
  };
}

export type SetAsideState = ReturnType<typeof useSetAside>;

const rowId = (accountId: string) => `set-aside-${accountId}`;

/** One account's row: its name left, the figure typed right, and a ✕ to take the row away. */
function SetAsideRow({ state, account, position }: GroupChild & { state: SetAsideState; account: SetAsideState['rows'][number] }) {
  const views = useSetAsideViews().data ?? {};
  // Today's balance, the one the views and the question read: a future-dated entry is not money here yet (ruling M4).
  const balances = useBalances(isoDate()).data ?? {};
  const currency = state.currencyOf(account);
  const room = roomFor(views[account.id]?.freeMinor ?? null, balances[account.id] ?? 0, state.earmarkOf(account.id)?.amountMinor ?? 0);
  let amount: number | null = null;
  try {
    const text = state.typedText(account.id);
    if (text !== undefined && text.trim() !== '') amount = parseMajor(text, currency);
  } catch {
    amount = null;
  }
  const free = setAsideHint(room, null, account.name, currency).text;
  const warning = setAsideHint(room, amount, account.name, currency);
  return (
    <div className="relative" data-testid="set-aside-row">
      <TextRow
        id={rowId(account.id)}
        position={position}
        label={account.name}
        info={free}
        hint={warning.warn ? <span className="text-[var(--ph-warn)]">{warning.text}</span> : undefined}
        value={state.textOf(account)}
        onChange={(e) => state.setText(account.id, e.target.value)}
        inputMode="decimal"
        placeholder={currency}
        className="pr-[30px]"
      />
      <button
        type="button"
        aria-label={`Remove ${account.name}`}
        onClick={() => state.remove(account.id)}
        className="ph-focus-inset absolute top-[6px] right-[4px] flex h-[34px] w-[30px] items-center justify-center text-[var(--ph-ink-3)]"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Money set aside: only the accounts added, each a row, and one row to add another. Adding opens a sheet of the
 * accounts not yet in the group and lands on the new row's amount.
 */
export function SetAsideGroup({ state, header = 'Money set aside' }: { state: SetAsideState; header?: string }) {
  const [choosing, setChoosing] = useState(false);
  const { focus } = state;
  const rowCount = state.rows.length;
  useEffect(() => {
    if (focus) document.getElementById(rowId(focus))?.focus();
  }, [focus, rowCount]);

  if (state.eligible.length === 0) {
    return <InsetGroup header={header} footer="No savings, cash or deposit account to set money aside in.">{[]}</InsetGroup>;
  }
  return (
    <>
      <InsetGroup header={header} info="From savings, cash or a deposit. Holdings are tagged on each purchase instead.">
        {[
          ...state.rows.map((account) => <SetAsideRow key={account.id} state={state} account={account} />),
          ...(state.addable.length > 0
            ? [<InsetRow key="add" label="Add an account" title="＋ Add an account" action onClick={() => setChoosing(true)} />]
            : []),
        ]}
      </InsetGroup>
      {choosing && (
        <Sheet title="Add an account" onClose={() => setChoosing(false)} grouped>
          <InsetGroup>
            {state.addable.map((account) => (
              <InsetRow
                key={account.id}
                title={account.name}
                chevron={false}
                onClick={() => {
                  setChoosing(false);
                  state.add(account.id);
                }}
              />
            ))}
          </InsetGroup>
        </Sheet>
      )}
    </>
  );
}

/** A saved goal's Set aside: the group alone, in a sheet whose ✓ saves it. The goal itself is not written again. */
export function SetAsideSheet({ goal, earmarks, onDone }: { goal: GoalRow; earmarks: readonly EarmarkRow[]; onDone: () => void }) {
  const state = useSetAside(goal, earmarks);
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await state.write(goal.id);
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Set aside" onClose={onDone} grouped confirm={{ label: 'Save', disabled: busy || state.eligible.length === 0, run: () => void save() }}>
      <ErrorBox error={error} />
      <SetAsideGroup state={state} />
    </Sheet>
  );
}
