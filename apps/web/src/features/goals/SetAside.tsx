import { formatMinor, isoDate, parseGroupedMajor, sheetSectionOf } from '@expanses/core';
import { type AccountRow, type EarmarkRow, type GoalRow, removeEarmark, saveEarmark, viaBaseMinor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useBalances, useInvalidateAll, useStoredRates } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, ROW_PAD_X, ROW_PAD_Y, RowIcon, rowHeight, type TreePlace, TreeLines } from '../../ui/native';
import { KeyboardStrip } from '../../ui/native/KeyboardStrip';
import { NESTED_ICON, nestedPad } from '../../ui/native/metrics';
import { assetKindTile } from '../ownables/catalogue-view';
import { setAsideWrites } from './goal-form-model';
import { roomFor } from './goal-cards';
import { useSetAsideViews } from './queries';
import {
  amountNow,
  type BarSlot,
  canSaveSetAside,
  currencySign,
  fillText,
  isOver,
  setAsideBar,
  setAsideLists,
  stillNeeded,
  typedText,
} from './set-aside-list';

/**
 * The state behind Set aside: every account that can hold the goal's money, the figure typed on each, and which row
 * is being typed in.
 *
 * Shared by the goal form's Funding sheet and the saved goal's Set aside sheet, so the two cannot disagree about which
 * accounts may hold a goal's money, how much each can spare, or what a save writes.
 */
export function useSetAside(goal: GoalRow | undefined, earmarks: readonly EarmarkRow[]) {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const views = useSetAsideViews().data ?? {};
  // Today's balance, the one the views and the question read: a future-dated entry is not money here yet (ruling M4).
  const balances = useBalances(isoDate()).data ?? {};
  // Only what has been typed. What a row opens with is read at render, from the earmark and the account's own
  // currency, which is not known when this first runs: `accounts` may still be loading.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<string | null>(null);

  const all = accounts.data ?? [];
  const eligible = moneyHolders(all).filter((account) => MONEY_SUBTYPES.includes(account.subtype));
  /**
   * A set-aside is in the account's own money, so the row is read and written in that currency.
   * (Typing `100,03` into a dollar row once met `IDR allows 0 decimal places`.)
   */
  const currencyOf = (account: { currency: string | null }) => account.currency ?? ws.baseCurrency;
  const goalCurrency = goal?.currency ?? ws.baseCurrency;
  const earmarkOf = (accountId: string) => earmarks.find((earmark) => earmark.goalId === goal?.id && earmark.accountId === accountId);
  const heldOf = (accountId: string) => Math.max(0, earmarkOf(accountId)?.amountMinor ?? 0);
  const roomOf = (accountId: string) => roomFor(views[accountId]?.freeMinor ?? null, balances[accountId] ?? 0, earmarkOf(accountId)?.amountMinor ?? 0);
  const byId = (id: string) => eligible.find((account) => account.id === id);

  // The day's rates this device already holds, for comparing and adding up in the goal's money. Nothing is fetched:
  // opening a sheet is not a request to a rate server.
  const storedRates = useStoredRates();
  const currencies = [...new Set([goalCurrency, ...eligible.map(currencyOf)])].filter((code) => code !== ws.baseCurrency).sort();
  const rates = useQuery({
    queryKey: ['set-aside-rates', ws.workspaceId, ws.baseCurrency, currencies.join(','), isoDate()],
    queryFn: () => storedRates(currencies, isoDate()),
  }).data?.rates ?? {};
  const inGoal = (minor: number, currency: string) => viaBaseMinor(minor, currency, goalCurrency, ws.baseCurrency, rates);
  const fromGoal = (minor: number, currency: string) => viaBaseMinor(minor, goalCurrency, currency, ws.baseCurrency, rates);

  const textOf = (account: { id: string; currency: string | null }) => {
    const own = typed[account.id];
    if (own !== undefined) return own;
    const held = heldOf(account.id);
    return held > 0 ? fillText(held, currencyOf(account)) : '';
  };
  const amountOf = (account: { id: string; currency: string | null }) => amountNow(typed[account.id], heldOf(account.id), currencyOf(account));
  const overOf = (account: { id: string; currency: string | null }) => isOver(typed[account.id], roomOf(account.id), heldOf(account.id), currencyOf(account));

  const parents = new Map(all.map((account) => [account.id, account.name]));
  const listed = eligible.map((account) => ({
    ...account,
    currency: currencyOf(account),
    parentId: account.parentId,
    parentName: account.parentId ? (parents.get(account.parentId) ?? null) : null,
  }));
  const lists = setAsideLists(listed, { heldMinor: heldOf, roomMinor: roomOf, inGoal });

  /** What the goal still needs counting every row's figure but `exceptId`'s, from what it needed as saved. */
  const neededWithout = (baseNeeded: number | null, exceptId: string | null) =>
    stillNeeded(
      baseNeeded,
      eligible.filter((account) => account.id !== exceptId).map((account) => ({ amountMinor: amountOf(account), heldMinor: heldOf(account.id), currency: currencyOf(account) })),
      inGoal,
    );

  /** Writes the rows for a saved goal: a figure where one was typed, and a letting go where a row was emptied. */
  async function write(goalId: string) {
    const ids = eligible.map((account) => account.id);
    const writes = setAsideWrites(ids, ids, (id) => textOf(byId(id)!));
    for (const item of writes) {
      const account = byId(item.accountId)!;
      // A row never typed in keeps what it holds: nothing to write, and nothing for another phone to hear.
      if (typed[account.id] === undefined) continue;
      if (item.action === 'save') await saveEarmark(database, ws, { goalId, accountId: account.id, amountMinor: parseGroupedMajor(item.text, currencyOf(account)) });
      else if (earmarkOf(account.id)) await removeEarmark(database, ws, goalId, account.id);
    }
  }

  return {
    eligible,
    currencyOf,
    goalCurrency,
    earmarkOf,
    heldOf,
    roomOf,
    textOf,
    amountOf,
    overOf,
    /** Any row asking for more than it can hold: Save waits. */
    over: !canSaveSetAside(eligible.map((account) => ({ over: overOf(account) }))),
    /** Every account's figure as it stands, for the form's Funding row. */
    entries: eligible.map((account) => ({ currency: currencyOf(account), minor: amountOf(account) })),
    lists,
    inGoal,
    fromGoal,
    neededWithout,
    setText: (id: string, raw: string) => {
      const account = byId(id);
      setTyped((was) => ({ ...was, [id]: account ? typedText(raw, currencyOf(account)) : raw }));
    },
    typedText: (id: string) => typed[id],
    focus,
    setFocus,
    write,
  };
}

export type SetAsideState = ReturnType<typeof useSetAside>;

const rowId = (accountId: string) => `set-aside-${accountId}`;

const TEXT = 'text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]';

/** A money account's circle: the drawing Net worth gives its kind, as on Funded by. */
function AccountGlyph({ subtype }: { subtype: AccountRow['subtype'] }) {
  const Glyph = assetKindTile(sheetSectionOf({ code: null, subtype }), subtype);
  return <Glyph size={16} aria-hidden />;
}

/** The hairline above a row, inset as the kit's rows inset theirs. */
function Hairline({ left }: { left: number }) {
  return <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left, right: ROW_PAD_X }} />;
}

/** A multicurrency account's own name over its currencies: nothing to type, since the money is in the currencies. */
function ParentLine({ name, subtype, position }: GroupChild & { name: string; subtype: AccountRow['subtype'] }) {
  return (
    <div className="relative" data-testid="set-aside-parent">
      {position?.separator && <Hairline left={ROW_PAD_X + 28 + 10} />}
      <div className="flex items-center gap-[10px]" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <RowIcon>
          <AccountGlyph subtype={subtype} />
        </RowIcon>
        <span className={cx('min-w-0 flex-1 truncate text-[var(--ph-ink)]', TEXT)}>{name}</span>
      </div>
    </div>
  );
}

/**
 * One account, one line: its name left and its figure right, typed in place. What the goal holds there reads in ink;
 * an account new to the goal shows what it has free in the placeholder's grey, in the same "Rp …" so the digits line
 * up. A tap anywhere on the line puts the caret in the figure.
 */
function AmountLine({
  state,
  account,
  title,
  depth = 0,
  tree,
  subtype,
  slots,
  position,
}: GroupChild & {
  state: SetAsideState;
  account: { id: string; name: string; currency: string };
  /** What the line reads: the account's name, or a currency's code under its account. */
  title: string;
  depth?: number;
  tree?: TreePlace;
  subtype: AccountRow['subtype'];
  /** The bar's slots while this line is typed in; drawn under the line on a wide screen, where there is no keyboard to ride. */
  slots: readonly BarSlot[];
}) {
  const field = useRef<HTMLInputElement>(null);
  const { currency } = account;
  const focused = state.focus === account.id;
  const value = state.textOf(account);
  const held = state.heldOf(account.id);
  const over = state.overOf(account);
  const filled = value !== '';
  const placeholder = focused ? '' : formatMinor(held > 0 ? 0 : Math.max(0, state.roomOf(account.id)), currency);
  const ink = over ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink)]';
  const left = depth > 0 ? nestedPad(depth) : ROW_PAD_X + 28 + 10;
  return (
    <div className="relative" data-testid="set-aside-row" data-over={over ? 'true' : undefined}>
      {position?.separator && <Hairline left={left} />}
      <div
        className="flex cursor-text items-center gap-[10px]"
        style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px ${ROW_PAD_Y}px ${depth > 0 ? nestedPad(depth) : ROW_PAD_X}px` }}
        onClick={(event) => {
          if (event.target !== field.current) field.current?.focus();
        }}
      >
        {tree && depth > 0 && <TreeLines depth={depth} tree={tree} />}
        {depth === 0 && (
          <RowIcon>
            <AccountGlyph subtype={subtype} />
          </RowIcon>
        )}
        <label htmlFor={rowId(account.id)} className={cx('min-w-0 shrink truncate', depth > 0 ? 'text-[15px] leading-[20px]' : TEXT, focused ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-ink)]')}>
          {title}
        </label>
        <span className="flex min-w-0 flex-1 items-baseline justify-end">
          {(focused || filled) && (
            <span aria-hidden className={cx('tabular shrink-0 whitespace-pre', TEXT, ink)}>
              {currencySign(currency)}
            </span>
          )}
          <span className="relative inline-grid min-w-[1ch]">
            <span aria-hidden className={cx('tabular invisible col-start-1 row-start-1 px-[1px] whitespace-pre', TEXT)}>
              {value || placeholder || ' '}
            </span>
            <input
              ref={field}
              id={rowId(account.id)}
              aria-label={account.name}
              aria-invalid={over || undefined}
              value={value}
              placeholder={placeholder}
              inputMode="decimal"
              autoComplete="off"
              onChange={(e) => state.setText(account.id, e.target.value)}
              onFocus={() => state.setFocus(account.id)}
              onBlur={() => state.setFocus((now) => (now === account.id ? null : now))}
              className={cx('tabular absolute inset-0 w-full min-w-0 bg-transparent p-0 text-right outline-none placeholder:text-[var(--ph-ink-3)]', TEXT, ink)}
            />
          </span>
        </span>
      </div>
      {focused && slots.length > 0 && <WideBar slots={slots} onFill={(text) => state.setText(account.id, text)} />}
    </div>
  );
}

/**
 * The bar on a wide screen: no keyboard comes up there for it to ride, so the same slots sit under the line being typed
 * in. Held off the field's focus as the phone's bar is: a press here never takes the caret away.
 */
function WideBar({ slots, onFill }: { slots: readonly BarSlot[]; onFill: (text: string) => void }) {
  return (
    <div role="listbox" aria-label="Set aside figures" className="hidden border-t-[0.5px] border-[var(--ph-hair)] md:flex" style={{ marginLeft: ROW_PAD_X, marginRight: ROW_PAD_X }}>
      {slots.map((slot, i) => (
        <Fragment key={slot.key}>
          {i > 0 && <span aria-hidden className="my-[8px] w-[0.5px] shrink-0 bg-[var(--ph-hair)]" />}
          <button
            type="button"
            role="option"
            aria-selected={false}
            aria-label={slot.label}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => slot.fill !== null && onFill(slot.fill)}
            className={cx('ph-focus-inset flex min-w-0 flex-1 flex-col items-center justify-center px-2 py-[6px] text-center', slot.fill !== null && 'active:bg-[var(--ph-fill)]')}
          >
            <span className={cx('tabular w-full truncate text-[14px] leading-[18px]', slot.warn ? 'text-[var(--ph-warn)]' : slot.fill === null ? 'text-[var(--ph-ink-2)]' : 'text-[var(--ph-ink)]')}>{slot.title}</span>
            <span className={cx('w-full truncate text-[11px] leading-[14px]', slot.warn ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink-3)]')}>{slot.detail}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Set aside, typed in the list (owner, 14 Nov): the accounts already in the goal, then the ones that can add to it with
 * what each has free. Every line is typed into in place, and the line being typed in gets a bar over the keyboard —
 * all free, half, what the goal still needs — that a tap puts in.
 */
export function SetAsideGroup({
  state,
  inHeader,
  neededMinor = null,
}: {
  state: SetAsideState;
  /** The first group's header: the goal's name ("In Hajj 2030"), or what the form calls cash. */
  inHeader: string;
  /** What the goal still needs as saved, in its money; null with no target (a goal being made), and the bar leaves it out. */
  neededMinor?: number | null;
}) {
  const subtypeOf = new Map(useAccounts().data?.map((account) => [account.id, account.subtype]) ?? []);
  const focused = state.focus ? state.eligible.find((account) => account.id === state.focus) : undefined;
  const slots = focused
    ? setAsideBar({
        currency: state.currencyOf(focused),
        goalCurrency: state.goalCurrency,
        heldMinor: state.heldOf(focused.id),
        roomMinor: state.roomOf(focused.id),
        typed: state.typedText(focused.id),
        neededMinor: state.neededWithout(neededMinor, focused.id),
        inGoal: state.inGoal,
        fromGoal: state.fromGoal,
      })
    : [];

  if (state.eligible.length === 0) {
    return <InsetGroup header={inHeader} footer="No savings, cash or deposit account to set money aside in.">{[]}</InsetGroup>;
  }

  const lines = (list: SetAsideState['lists']['inGoal']) =>
    list.map((line) => {
      if (line.type === 'parent') return <ParentLine key={line.key} name={line.name} subtype={subtypeOf.get(line.parentId) ?? 'bank'} />;
      const { account } = line;
      return (
        <AmountLine
          key={line.key}
          state={state}
          account={account}
          title={line.type === 'pocket' ? line.code : account.name}
          depth={line.type === 'pocket' ? 1 : 0}
          tree={line.type === 'pocket' ? { last: line.last } : undefined}
          subtype={account.subtype}
          slots={state.focus === account.id ? slots : []}
        />
      );
    });

  const { inGoal, canAdd } = state.lists;
  return (
    <>
      {inGoal.length > 0 && <InsetGroup header={inHeader}>{lines(inGoal)}</InsetGroup>}
      {canAdd.length > 0 && (
        <InsetGroup header="Can add" trailing="Free">
          {lines(canAdd)}
        </InsetGroup>
      )}
      {inGoal.length === 0 && canAdd.length === 0 && <InsetGroup header={inHeader} footer="Nothing free to set aside in savings, cash or a deposit.">{[]}</InsetGroup>}
      {focused && (
        <KeyboardStrip
          label="Set aside figures"
          cells={slots.map((slot) => ({
            key: slot.key,
            label: slot.label,
            title: slot.warn ? <span className="text-[var(--ph-warn)]">{slot.title}</span> : slot.title,
            detail: slot.detail,
            onPick: () => {
              if (slot.fill !== null) state.setText(focused.id, slot.fill);
            },
          }))}
        />
      )}
    </>
  );
}

/** A saved goal's Set aside: the list alone, in a sheet whose Save writes it. The goal itself is not written again. */
export function SetAsideSheet({ goal, earmarks, neededMinor = null, onDone }: { goal: GoalRow; earmarks: readonly EarmarkRow[]; neededMinor?: number | null; onDone: () => void }) {
  const state = useSetAside(goal, earmarks);
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy || state.over) return;
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
    <Sheet title="Set aside" onClose={onDone} grouped confirm={{ label: 'Save', disabled: busy || state.eligible.length === 0 || state.over, run: () => void save() }}>
      <ErrorBox error={error} />
      <SetAsideGroup state={state} inHeader={`In ${goal.name}`} neededMinor={neededMinor} />
    </Sheet>
  );
}
