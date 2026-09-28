import { CreditCard, Landmark, Plus, Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { cx } from '../../ui';
import { type Segment, SegmentedControl } from '../../ui/native';
import type { PaymentOption } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Sheet } from '../../app/Sheet';
import { paymentKey, placeholderLabel } from './quick-row';
import type { FormDraft } from './tx-form';

/**
 * What one Paid with row is called.
 *
 * The digits are part of the name only when they are what tells two rows apart — an account carrying a
 * supplementary card offers one row per card, and "Mandiri Bonvoy" alone would name both. An account with a
 * single card is one choice, so its name is the account's: a name nobody has to read digits out of.
 */
export function paymentLabel(option: PaymentOption): string {
  return option.cardId ? `${option.accountName} ···· ${option.last4 ?? '????'}` : option.accountName;
}

/**
 * Whether a Paid with row answers what was typed: its name (with a card's last digits), whose it is, or its
 * currency — "bca", "7788", "andi", "usd". Nothing typed keeps every row.
 */
export function matchesPayment(option: PaymentOption, currency: string | null | undefined, typed: string): boolean {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return true;
  return [paymentLabel(option), option.holderName ?? '', currency ?? ''].some((text) => text.toLowerCase().includes(wanted));
}

/** What the Paid with row shows once something is chosen, or nothing when it is still empty. */
export function chosenPayment(options: readonly PaymentOption[], draft: FormDraft, placeholders: ReadonlySet<string> = new Set()): string {
  // A placeholder the row names reads as who paid (§4.4, final review minor 2).
  if (placeholders.has(draft.moneyId)) return placeholderLabel(options.find((option) => option.accountId === draft.moneyId)?.accountName ?? '');
  const found = options.find((option) => option.accountId === draft.moneyId && (option.cardId ?? '') === draft.cardId);
  return found ? paymentLabel(found) : (options.find((option) => option.accountId === draft.moneyId)?.accountName ?? '');
}

/**
 * Which account — and which card on it — paid: one list, for every screen that asks.
 *
 * It left `TransactionCard` when the edit sheet arrived. The sheet asks the same question of the same
 * `paymentOptions`, and a second copy of this list is a second place for a supplementary card to go missing
 * from — which is exactly the fault this branch has produced six times.
 */
/** Whether a row is a card — a card on an account, or a credit card account itself — rather than money held. */
export const isCardOption = (option: PaymentOption, account: AccountRow | undefined): boolean => Boolean(option.cardId) || account?.kind === 'liability';

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

export interface PaymentSection {
  key: 'accounts' | 'cards';
  title: string;
  options: PaymentOption[];
}

/**
 * What the sheet draws: Accounts, then Credit cards, each only when it has rows. A tab narrows to its own kind (none
 * narrows nothing); a search looks across both, whatever tab is open, since the one typed for may be on the other.
 */
export function paymentSections(options: readonly PaymentOption[], accounts: readonly AccountRow[], tab: PaymentTab | null, typed: string): PaymentSection[] {
  const searching = typed.trim() !== '';
  const currency = (option: PaymentOption) => accounts.find((a) => a.id === option.accountId)?.currency;
  const matching = options.filter((option) => matchesPayment(option, currency(option), typed));
  const card = (option: PaymentOption) => isCardOption(option, accounts.find((a) => a.id === option.accountId));
  const sections: PaymentSection[] = [
    { key: 'accounts', title: 'Accounts', options: matching.filter((option) => !card(option)) },
    { key: 'cards', title: 'Credit cards', options: matching.filter(card) },
  ];
  return sections.filter((section) => section.options.length > 0 && (searching || tab === null || tab === section.key));
}

/** The label with the typed words marked, as search in Mail marks them. */
function Marked({ text, typed }: { text: string; typed: string }) {
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

const LIST = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]';

export function PaymentSheet({
  title,
  options: allOptions,
  accounts,
  chosenAccountId = '',
  chosenCardId = '',
  cards = false,
  onPick,
  onClose,
  onAddAccount,
  placeholders = new Set<string>(),
}: {
  /** "Paid with", "Received into" or "From", as the mode names it. */
  title: string;
  options: readonly PaymentOption[];
  accounts: readonly AccountRow[];
  /** What is chosen now, which decides the tab the sheet opens on. */
  chosenAccountId?: string;
  chosenCardId?: string;
  /** Whether a card can answer this question — Paid with, not Received into — which is when the tabs are drawn. */
  cards?: boolean;
  onPick: (option: PaymentOption) => void;
  onClose: () => void;
  /** Offered at the foot of the list, for the account or card that is not on it yet: which kind the tab says. */
  onAddAccount?: (kind: PaymentTab) => void;
  /**
   * Placeholder accounts (§4.4): who paid, never a way to pay. One stays on the list only as the current value of a
   * purchase another member paid for, and reads "Paid by <name>"; any other is dropped here, whatever the caller passed.
   */
  placeholders?: ReadonlySet<string>;
}) {
  const options = allOptions.filter((option) => !placeholders.has(option.accountId) || option.accountId === chosenAccountId);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<PaymentTab>(() => openingPaymentTab(options, accounts, chosenAccountId, chosenCardId));
  const input = useRef<HTMLInputElement>(null);
  const searching = search.trim() !== '';
  // Tabs wherever a card can pay, even with no card yet: the Credit cards tab is where one is added.
  const tabbed = cards;
  const sections = paymentSections(options, accounts, tabbed ? tab : null, search);
  // Headings only where two kinds share the screen: a search across both.
  const headed = sections.length > 1;
  const adding: PaymentTab = tabbed ? tab : 'accounts';
  // The row already in Paid with: its icon sits in a filled circle, so the currencies stay where they are.
  const picked = options.find((option) => option.accountId === chosenAccountId && (option.cardId ?? '') === chosenCardId)
    ?? options.find((option) => option.accountId === chosenAccountId);

  const row = (option: PaymentOption) => {
    const account = accounts.find((a) => a.id === option.accountId);
    const Glyph = isCardOption(option, account) ? CreditCard : Landmark;
    const isPicked = option === picked;
    const label = placeholders.has(option.accountId) ? placeholderLabel(option.accountName) : paymentLabel(option);
    return (
      <li key={paymentKey(option.accountId, option.cardId)}>
        <button
          type="button"
          aria-label={label}
          aria-current={isPicked ? 'true' : undefined}
          onClick={() => {
            onPick(option);
            onClose();
          }}
          className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
        >
          <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-ink-2)]">
            {isPicked ? (
              <span className="flex size-[30px] items-center justify-center rounded-full bg-[var(--ph-ink)] text-[var(--ph-surface)]">
                <Glyph size={15} />
              </span>
            ) : (
              <Glyph size={16} />
            )}
          </span>
          <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">
              <Marked text={label} typed={search} />
            </span>
            <span aria-hidden className="shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">
              {[option.holderName, account?.currency].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const addRow = onAddAccount ? (
    <li key="add">
      <button
        type="button"
        onClick={() => {
          onClose();
          onAddAccount(adding);
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

  return (
    <Sheet grouped title={title} onClose={onClose}>
      {tabbed ? <SegmentedControl segments={TABS} value={tab} onChange={(key) => setTab(key as PaymentTab)} label={`${title}: which kind`} className="mb-3" /> : null}
      {/* Scrolling the list puts the keyboard away, as a native list does, so the rows it covered can be reached. */}
      <div onTouchMove={() => input.current?.blur()} data-testid="payment-sections">
        {sections.map((section, index) => (
          <section key={section.key} aria-label={section.title}>
            {headed ? (
              <h3 className="px-[14px] pt-[10px] pb-[6px] text-[12px] tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">{section.title}</h3>
            ) : null}
            <ul className={LIST}>
              {section.options.map(row)}
              {/* The way to add one is the list's own last row, drawn like the rows above it. */}
              {index === sections.length - 1 ? addRow : null}
            </ul>
          </section>
        ))}
        {sections.length === 0 && addRow ? <ul className={cx(LIST, 'mt-3')}>{addRow}</ul> : null}
        {searching && sections.length === 0 ? (
          <p className="px-4 pt-3 text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing here matches “{search.trim()}”.</p>
        ) : null}
        {!searching && sections.length === 0 ? (
          <p className="px-4 pt-3 text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{tab === 'cards' ? 'No credit cards yet.' : 'No accounts yet.'}</p>
        ) : null}
      </div>
      {/* The category picker's search, in the same place: pinned at the foot, where the thumb already is. */}
      <div className="sticky bottom-0 px-1 pt-2 pb-1">
        <label className="flex h-11 items-center gap-2 rounded-full bg-[var(--ph-surface)] px-4 shadow-[0_6px_20px_rgb(0_0_0/0.12)]">
          <Search size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
          <input
            ref={input}
            aria-label={`Search ${title}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-base text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]"
          />
          {searching ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch('');
                input.current?.focus();
              }}
              className="ph-focus flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-ink-3)] text-[var(--ph-surface)]"
            >
              <X size={11} strokeWidth={3} aria-hidden />
            </button>
          ) : null}
        </label>
      </div>
    </Sheet>
  );
}
