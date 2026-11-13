import { CreditCard, Landmark, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { cx } from '../../ui';
import { OWNED_TOGETHER, SearchPill, type Segment, SegmentedControl, TreeLines, TreeStem, TwoPersonMark } from '../../ui/native';
import { currencyInfo, formatMinor, type MoneyAccountSubtype, type PaymentOption } from '@expanses/core';
import type { AccountRow, CardRow, PaidWithItem } from '@expanses/db';
import { Sheet, SheetSearchButton } from '../../app/Sheet';
import { type FormStep, NewCardForm } from '../ownables/AddDebtPage';
import { CashAccountForm } from '../ownables/CashAccountForm';
import { paymentKey, placeholderLabel } from './quick-row';
import type { FormDraft } from './tx-form';
import { useAccountNumberLast4, useWalletLast4 } from '../cards/card-queries';
import { assetKindTile } from '../ownables/catalogue-view';
import { useBalances } from '../../lib/queries';
import { accountTreeSections, isCardOption, openingParent, paymentLabel, type TreeRow } from './account-tree';

export { isCardOption, paymentLabel };

/**
 * Whether a Paid with row answers what was typed: its name (with a card's last digits), whose it is, or its
 * currency — "bca", "7788", "andi", "usd". Nothing typed keeps every row.
 */
export function matchesPayment(option: PaymentOption, currency: string | null | undefined, typed: string): boolean {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return true;
  return [paymentLabel(option), option.last4 ?? '', option.holderName ?? '', currency ?? ''].some((text) => text.toLowerCase().includes(wanted));
}

/** What the Paid with row shows once something is chosen, or nothing when it is still empty. */
export function chosenPayment(options: readonly PaymentOption[], draft: FormDraft, placeholders: ReadonlySet<string> = new Set()): string {
  // A placeholder the row names reads as who paid (§4.4, final review minor 2).
  if (placeholders.has(draft.moneyId)) return placeholderLabel(options.find((option) => option.accountId === draft.moneyId)?.accountName ?? '');
  const found = options.find((option) => option.accountId === draft.moneyId && (option.cardId ?? '') === draft.cardId);
  return found ? paymentLabel(found) : (options.find((option) => option.accountId === draft.moneyId)?.accountName ?? '');
}

/**
 * The row a purchase's own account and card stand on: the row naming that card, else the account's own row when it names
 * no card — an account with one card in use is one row, and a purchase saved naming that card is on it. A purchase on a
 * card since removed (`removed`) stands on none: neither another card on the account nor the one still in use paid.
 */
export function pickedPayment(options: readonly PaymentOption[], accountId: string, cardId: string, removed = false): PaymentOption | undefined {
  if (removed) return undefined;
  return (
    options.find((option) => option.accountId === accountId && (option.cardId ?? '') === cardId) ??
    options.find((option) => option.accountId === accountId && !option.cardId)
  );
}

/**
 * What Paid with reads on an older purchase made on a card since removed: the account, and the card's digits with
 * "removed card". It is the purchase's value, shown as it is, and never offered for another purchase.
 */
export function removedCardPayment(cards: readonly CardRow[], accounts: readonly AccountRow[], accountId: string, cardId: string): { value: string; caption: string } | null {
  const card = cardId ? cards.find((row) => row.id === cardId && row.accountId === accountId && row.archived) : undefined;
  if (!card) return null;
  return { value: accounts.find((account) => account.id === accountId)?.name ?? '', caption: `···· ${card.last4 ?? '????'} · removed card` };
}

export type PaymentTab = 'accounts' | 'cards';

/**
 * The tab Paid with opens on: the kind of what is chosen now — so someone who pays by card opens on their cards —
 * or Accounts when nothing is chosen yet.
 */
export function openingPaymentTab(options: readonly PaymentOption[], accounts: readonly AccountRow[], chosenAccountId: string, chosenCardId: string): PaymentTab {
  const chosen = options.find((option) => option.accountId === chosenAccountId && (option.cardId ?? '') === chosenCardId)
    ?? options.find((option) => option.accountId === chosenAccountId);
  if (!chosen) return 'accounts';
  return isCardOption(chosen, accounts.find((a) => a.id === chosen.accountId)) ? 'cards' : 'accounts';
}

/** A partner's shared items, under their name: "Rina's, shared" (joint net worth §7.1). */
export interface SharedPaymentSection {
  key: string;
  title: string;
  items: PaidWithItem[];
}

/** The group heading a partner's shared items sit under; an owner this device has no name for reads as the household's. */
export const sharedTitle = (ownerName: string | null): string => (ownerName ? `${ownerName}’s, shared` : 'Shared in the household');

/**
 * The partner's shared items Paid with offers (§7.1, D14), one section per owner after this person's own accounts: only
 * when the form's workspace is the net-worth group's (`groupWorkspaceBookId`), never in another. A tab narrows to its
 * own kind — a credit card on Credit cards, the rest on Accounts — and a search looks across both, as the own rows do.
 */
export function sharedPaymentSections(
  items: readonly PaidWithItem[],
  where: { formBookId: string; groupWorkspaceBookId: string | null | undefined; title?: (ownerName: string | null) => string },
  tab: PaymentTab | null,
  typed: string,
): SharedPaymentSection[] {
  const titleOf = where.title ?? sharedTitle;
  if (!where.groupWorkspaceBookId || where.formBookId !== where.groupWorkspaceBookId) return [];
  const wanted = typed.trim().toLowerCase();
  const onTab = (item: PaidWithItem) => wanted !== '' || tab === null || (item.subtype === 'credit_card' ? 'cards' : 'accounts') === tab;
  const matches = (item: PaidWithItem) => !wanted || [item.name, item.ownerName ?? '', item.currency].some((text) => text.toLowerCase().includes(wanted));
  const sections: SharedPaymentSection[] = [];
  for (const item of items) {
    if (!onTab(item) || !matches(item)) continue;
    let section = sections.find((s) => s.key === item.owner);
    if (!section) sections.push((section = { key: item.owner, title: titleOf(item.ownerName), items: [] }));
    section.items.push(item);
  }
  return sections;
}

/** The label with the typed words marked, as search in Mail marks them. */
export function Marked({ text, typed }: { text: string; typed: string }) {
  const wanted = typed.trim().toLowerCase();
  const at = wanted ? text.toLowerCase().indexOf(wanted) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-[color-mix(in_srgb,var(--ph-tint)_22%,transparent)] text-inherit">{text.slice(at, at + wanted.length)}</mark>
      {text.slice(at + wanted.length)}
    </>
  );
}

const TABS: readonly Segment[] = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'cards', label: 'Credit cards' },
];

/** One box of rows in the sheet's look, a hairline between rows; shared with the Investment sheet. */
export const LIST = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]';

export function PaymentSheet({
  title,
  options: allOptions,
  accounts,
  chosenAccountId = '',
  chosenCardId = '',
  chosenCardRemoved = false,
  cards = false,
  onPick,
  onClose,
  adding: addable,
  placeholders = new Set<string>(),
  footer,
  shared,
  leadCurrency,
}: {
  /** "Paid with", "Received into", "From" or "To", as the mode names it. */
  title: string;
  options: readonly PaymentOption[];
  accounts: readonly AccountRow[];
  /** What is chosen now, which decides the tab the sheet opens on. */
  chosenAccountId?: string;
  chosenCardId?: string;
  /** The chosen card was removed since: the purchase's value, which no row in the list stands for. */
  chosenCardRemoved?: boolean;
  /** Whether a card can answer this question — Paid with, not Received into — which is when the tabs are drawn. */
  cards?: boolean;
  onPick: (option: PaymentOption) => void;
  onClose: () => void;
  /**
   * Add account (or, on the Credit cards tab, Add credit card) at the foot of the list, for the one that is not on it
   * yet. It is a step inside this sheet — ‹ back, ✓ save — and what it makes is handed to `onAdded`, already picked.
   * `kinds` are the kinds of account this question can take, the first of them the one the form starts on.
   */
  adding?: { kinds: readonly MoneyAccountSubtype[]; onAdded: (accountId: string) => void };
  /**
   * Placeholder accounts (§4.4): who paid, never a way to pay. One stays on the list only as the current value of a
   * purchase another member paid for, and reads "Paid by <name>"; any other is dropped here, whatever the caller passed.
   */
  placeholders?: ReadonlySet<string>;
  /** A line under the list, such as where to go instead for what is not on it. */
  footer?: string;
  /** To: the From's currency, whose pocket is listed first within an account, so a same-currency move is one tap. */
  leadCurrency?: string | null;
  /**
   * Joint net worth §7.1: the partner's shared items that can pay, offered under "Rina's, shared" when the form's
   * workspace is the group's. `chosenItemId` is the one Paid with names now, which no own row then does.
   */
  shared?: {
    items: readonly PaidWithItem[];
    formBookId: string;
    groupWorkspaceBookId: string | null | undefined;
    chosenItemId: string | null;
    onPick: (item: PaidWithItem) => void;
    /** The heading over an owner's items: "Rina’s, shared" unless the caller says otherwise (Transfer, §7.2). */
    title?: (ownerName: string | null) => string;
  };
}) {
  /*
   * Every row carries the digits it is known by, shown beside its name and found by search: a card's own, else a bank
   * account's number (0080), else a wallet's phone. An account with one card used to show none, since its name alone
   * was enough to choose by — but the digits are how a statement or an alert names it. A pocket is known by its
   * account's digits when it has none of its own.
   */
  const numbers = useAccountNumberLast4().data;
  const phones = useWalletLast4().data;
  const balances = useBalances().data;
  const parentIdOf = (accountId: string) => accounts.find((a) => a.id === accountId)?.parentId ?? '';
  const digitsOf = (accountId: string) => numbers?.[accountId] ?? phones?.[accountId];
  const options = allOptions
    .filter((option) => !placeholders.has(option.accountId) || option.accountId === chosenAccountId)
    .map((option) => ({ ...option, last4: option.last4 ?? digitsOf(option.accountId) ?? digitsOf(parentIdOf(option.accountId)) ?? null }));
  const [search, setSearch] = useState('');
  // D of the search mockup: no field on screen until ⌕ in the header asks for one; it then takes the tabs' row.
  const [finding, setFinding] = useState(false);
  const [tab, setTab] = useState<PaymentTab>(() => openingPaymentTab(options, accounts, chosenAccountId, chosenCardId));
  const searching = search.trim() !== '';
  // Tabs wherever a card can pay, even with no card yet: the Credit cards tab is where one is added.
  const tabbed = cards;
  const sections = accountTreeSections(options, accounts, { tab: tabbed ? tab : null, typed: search, leadCurrency });
  const sharedSections = shared ? sharedPaymentSections(shared.items, shared, tabbed ? tab : null, search) : [];
  // Money is always under its kind's heading; Credit cards only where another kind shares the screen with it.
  const headed = (key: string) => key !== 'cards' || sections.length > 1 || sharedSections.length > 0;
  // One account open at a time: the one holding the chosen pocket opens by itself.
  const [open, setOpen] = useState<string | null>(() => openingParent(accountTreeSections(options, accounts, { tab: null, typed: '' }), chosenAccountId));
  const adding: PaymentTab = tabbed ? tab : 'accounts';
  // New account / New credit card: a step this sheet moves to, not a sheet stacked on it, and not a page away.
  const [making, setMaking] = useState<PaymentTab | null>(null);
  // The card form's own step — its search for the card — is one more step of this sheet, never a sheet on top of it.
  const [inner, setInner] = useState<FormStep | null>(null);
  const [kind, setKind] = useState<MoneyAccountSubtype>(() => addable?.kinds[0] ?? 'bank');
  const [canSave, setCanSave] = useState(false);
  const formId = useId();
  // The row already in Paid with: its icon sits in a filled circle, so the currencies stay where they are.
  const picked = shared?.chosenItemId
    ? undefined
    : pickedPayment(options, chosenAccountId, chosenCardId, chosenCardRemoved);

  const choose = (option: PaymentOption) => {
    onPick(option);
    onClose();
  };

  /** The row's lead: the kind of account it is, or a card; in a filled circle when it is the one chosen now. */
  const lead = (Glyph: typeof CreditCard, isPicked: boolean, stem = false) => (
    <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-ink-2)]">
      {isPicked ? (
        <span className="flex size-[30px] items-center justify-center rounded-full bg-[var(--ph-ink)] text-[var(--ph-surface)]">
          <Glyph size={15} />
        </span>
      ) : (
        <Glyph size={16} />
      )}
      {/* An open account's tree line starts under its icon and runs to the foot of the row, where a pocket picks it up. */}
      {stem ? <TreeStem depth={0} iconSize={16} /> : null}
    </span>
  );

  const glyphOf = (option: PaymentOption, account: AccountRow | undefined, parent: AccountRow | null) =>
    isCardOption(option, account) ? CreditCard : assetKindTile('liquid', (parent ?? account)?.subtype ?? '');

  /** A row that picks on tap: an account of one currency, a pocket offered alone or found by a search, a card. */
  const single = (option: PaymentOption, parent: AccountRow | null) => {
    const account = accounts.find((a) => a.id === option.accountId);
    const isPicked = option === picked;
    const label = placeholders.has(option.accountId) ? placeholderLabel(option.accountName) : paymentLabel(option);
    // A pocket reads as its account, its currency beside the digits — "Bank One Harian", "···· 2204 · USD".
    const name = placeholders.has(option.accountId) ? label : (parent?.name ?? option.accountName);
    return (
      <li key={paymentKey(option.accountId, option.cardId)}>
        <button
          type="button"
          aria-label={label}
          aria-current={isPicked ? 'true' : undefined}
          onClick={() => choose(option)}
          className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
        >
          {lead(glyphOf(option, account, parent), isPicked)}
          <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
            {/* The name may be cut short; the digits never are, so they stand apart from it, at the row's end. */}
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">
              <Marked text={name} typed={search} />
            </span>
            <span aria-hidden className="tabular shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">
              {[option.last4 ? `···· ${option.last4}` : null, option.holderName, account?.currency].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
      </li>
    );
  };

  /**
   * An account holding several currencies: its name, its digits and a chevron, and no currency of its own — tapping
   * it opens its pockets under it on the tree line, one per currency, each with what it holds. Tapping one picks it.
   */
  const parentRows = (row: Extract<TreeRow, { type: 'parent' }>) => {
    const isOpen = open === row.parent.id;
    const head = (
      <li key={`parent:${row.parent.id}`}>
        <button
          type="button"
          aria-label={row.parent.name}
          aria-expanded={isOpen}
          onClick={() => setOpen(isOpen ? null : row.parent.id)}
          className="ph-focus-inset relative flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
        >
          {lead(assetKindTile('liquid', row.parent.subtype), false, isOpen)}
          <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{row.parent.name}</span>
            {row.last4 ? <span aria-hidden className="tabular shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">{`···· ${row.last4}`}</span> : null}
            <span aria-hidden className={cx('w-[12px] shrink-0 text-center text-[17px] leading-none text-[var(--ph-chevron)] transition-transform', isOpen && 'rotate-90')}>
              {'›'}
            </span>
          </span>
        </button>
      </li>
    );
    if (!isOpen) return [head];
    return [
      head,
      ...row.pockets.map((option, index) => {
        const currency = accounts.find((a) => a.id === option.accountId)?.currency ?? '';
        const isPicked = option === picked;
        const held = balances?.[option.accountId];
        return (
          <li key={paymentKey(option.accountId, option.cardId)}>
            <button
              type="button"
              aria-label={option.accountName}
              aria-current={isPicked ? 'true' : undefined}
              onClick={() => choose(option)}
              className="ph-focus-inset relative flex w-full items-center gap-[10px] pl-[44px] text-left active:bg-[var(--ph-fill)]"
            >
              <TreeLines depth={1} tree={{ last: index === row.pockets.length - 1 }} />
              <span aria-hidden className="flex w-[24px] shrink-0 items-center justify-center text-[14px] leading-none">
                {isPicked ? (
                  <span className="flex size-[24px] items-center justify-center rounded-full bg-[var(--ph-ink)]">{currency ? currencyInfo(currency).flag : null}</span>
                ) : currency ? (
                  currencyInfo(currency).flag
                ) : null}
              </span>
              <span className="ph-row-body flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-[13px]">
                <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{currency}</span>
                {held !== undefined && currency ? (
                  <span aria-hidden className="tabular shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">
                    {formatMinor(held, currency)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      }),
    ];
  };

  const rowsOf = (row: TreeRow) => (row.type === 'parent' ? parentRows(row) : [single(row.option, row.parent)]);

  const sharedRow = (item: PaidWithItem) => {
    const Glyph = item.subtype === 'credit_card' ? CreditCard : Landmark;
    const isPicked = shared?.chosenItemId === item.itemId;
    return (
      <li key={`shared:${item.itemId}`}>
        <button
          type="button"
          aria-label={`${item.name}, ${(shared?.title ?? sharedTitle)(item.ownerName)}`}
          aria-current={isPicked ? 'true' : undefined}
          onClick={() => {
            shared?.onPick(item);
            onClose();
          }}
          className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
        >
          <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-ink-2)]">
            {/* Owned together (2026-11-13): the two-person mark on the glyph, in place of a "Joint" pill. */}
            <span className={cx('relative flex size-[30px] items-center justify-center rounded-full', isPicked && 'bg-[var(--ph-ink)] text-[var(--ph-surface)]')}>
              <Glyph size={isPicked ? 15 : 16} />
              {item.joint ? <TwoPersonMark /> : null}
            </span>
          </span>
          <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">
              <Marked text={item.name} typed={search} />
            </span>
            {item.joint ? <span className="sr-only">{OWNED_TOGETHER}</span> : null}
            <span aria-hidden className="shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">
              {item.currency}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const addRow = addable ? (
    <li key="add">
      <button
        type="button"
        onClick={() => {
          setCanSave(false);
          setMaking(adding);
        }}
        className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
      >
        <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-ink-2)]">
          <Plus size={16} />
        </span>
        <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center pr-[13px]">
          <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{adding === 'cards' ? 'Add credit card' : 'Add account'}</span>
        </span>
      </button>
    </li>
  ) : null;

  const searchField = (
    <SearchPill
      value={search}
      onChange={setSearch}
      onClose={() => {
        setSearch('');
        setFinding(false);
      }}
      compact
      placeholder="Search"
      label={`Search ${title}`}
    />
  );

  const stepBack = () => {
    setInner(null);
    setMaking(null);
  };
  const added = (accountId: string) => {
    addable?.onAdded(accountId);
    onClose();
  };
  // The form is the sheet's step; the header's ✓ submits it by id, so the browser still checks what it requires.
  const embedded = { formId, onCanSave: setCanSave, onStep: setInner };

  // One sheet for the list and for the step, so moving between them keeps whatever detent it was left at.
  return (
    <Sheet
      grouped
      tall
      title={inner ? inner.title : making === 'cards' ? 'New credit card' : making ? 'New account' : title}
      onClose={inner ? inner.back : making ? stepBack : onClose}
      // A search brings the keyboard, so its step stands at the large detent.
      expanded={inner !== null}
      {...(inner
        ? { back: { label: 'New credit card', run: inner.back } }
        : making
          ? {
              back: { label: title, run: stepBack },
              confirm: { label: 'Save', disabled: !canSave, run: () => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit() },
            }
          : {
              closeHidden: finding,
              heading: !tabbed && finding ? searchField : undefined,
              action: (
                <SheetSearchButton
                  open={finding}
                  onClick={() => {
                    if (finding) setSearch('');
                    setFinding((was) => !was);
                  }}
                />
              ),
            })}
    >
      {making === 'cards' ? (
        <NewCardForm embedded={embedded} onCreated={added} />
      ) : making && addable ? (
        <CashAccountForm item={kind} kinds={{ items: addable.kinds, onChange: setKind }} embedded={embedded} onCreated={added} />
      ) : (
      <>
      {/* One row of a fixed 32 px for the tabs or the search that replaces them, so opening the search moves no row
          below it. A sheet with no tabs takes the search in its header instead, in the title's place. */}
      {tabbed ? (
        <div className="mb-3 flex h-8 items-center">
          {finding ? <div className="w-full">{searchField}</div> : <SegmentedControl segments={TABS} value={tab} onChange={(key) => setTab(key as PaymentTab)} label={`${title}: which kind`} className="w-full" />}
        </div>
      ) : null}
      {/* Scrolling the list puts the keyboard away, as a native list does, so the rows it covered can be reached. */}
      <div onTouchMove={() => (document.activeElement as HTMLElement | null)?.blur()} data-testid="payment-sections">
        {sections.map((section, index) => (
          <section key={section.key} aria-label={section.title}>
            {headed(section.key) ? (
              <h3 className="px-[14px] pt-[10px] pb-[6px] text-[12px] tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">{section.title}</h3>
            ) : null}
            <ul className={LIST}>
              {section.rows.flatMap(rowsOf)}
              {/* The way to add a card is the list's own last row, drawn like the rows above it. */}
              {index === sections.length - 1 && section.key === 'cards' ? addRow : null}
            </ul>
          </section>
        ))}
        {/* Under kinds of account, Add account is a group of its own at the foot: inside the last kind it would read
            as adding one of that kind. */}
        {sections.at(-1)?.key !== 'cards' && addRow ? <ul className={cx(LIST, 'mt-3')}>{addRow}</ul> : null}
        {/* The partner's shared items, after one's own and the way to add one (§7.1): whose they are is the heading. */}
        {sharedSections.map((section) => (
          <section key={`shared:${section.key}`} aria-label={section.title}>
            <h3 className="px-[14px] pt-[10px] pb-[6px] text-[12px] tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">{section.title}</h3>
            <ul className={LIST}>{section.items.map(sharedRow)}</ul>
          </section>
        ))}
        {searching && sections.length === 0 && sharedSections.length === 0 ? (
          <p className="px-4 pt-3 text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing here matches “{search.trim()}”.</p>
        ) : null}
        {!searching && sections.length === 0 && sharedSections.length === 0 ? (
          <p className="px-4 pt-3 text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{tab === 'cards' ? 'No credit cards yet.' : 'No accounts yet.'}</p>
        ) : null}
        {footer ? <p className="px-4 pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p> : null}
      </div>
      </>
      )}
    </Sheet>
  );
}
