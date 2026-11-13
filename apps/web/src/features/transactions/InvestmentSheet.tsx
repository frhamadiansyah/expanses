import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetSearchButton } from '../../app/Sheet';
import { cx } from '../../ui';
import { SearchPill } from '../../ui/native';
import { assetKindTile } from '../ownables/catalogue-view';
import { type BuyChoice, investmentSections } from './buy-in-form';
import { LIST, Marked } from './PaymentSheet';


/**
 * Trade's Investment list, drawn as the Paid with sheet is (owner, 13 Nov 2026): ⌕ in the header, the holdings under
 * their kind's heading — Bonds, Funds, Stocks, Gold — the chosen one in a filled circle, and each named with where it
 * is held. Buy lists every holding and ends with ＋ New investment; Sell only what still has units to sell.
 */
export function InvestmentSheet({
  choices,
  chosenAccountId,
  onPick,
  onNew,
  onClose,
}: {
  /** The tab's own holdings: `buyChoices(...).buys` or `.sells`. */
  choices: readonly BuyChoice[];
  chosenAccountId: string;
  onPick: (choice: BuyChoice) => void;
  /** Buy only: adds a holding not on the list yet. */
  onNew?: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [finding, setFinding] = useState(false);
  const sections = investmentSections(choices, search);
  const searching = search.trim() !== '';

  const row = (choice: BuyChoice) => {
    const picked = choice.accountId === chosenAccountId;
    // The drawing its kind wears on the Assets page, so each row says which kind of thing it is.
    const Glyph = assetKindTile('invest', choice.kind ?? '');
    return (
      <li key={choice.value}>
        <button
          type="button"
          aria-label={choice.label}
          aria-current={picked ? 'true' : undefined}
          onClick={() => {
            onPick(choice);
            onClose();
          }}
          className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
        >
          <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-ink-2)]">
            {picked ? (
              <span className="flex size-[30px] items-center justify-center rounded-full bg-[var(--ph-ink)] text-[var(--ph-surface)]">
                <Glyph size={15} />
              </span>
            ) : (
              <Glyph size={16} />
            )}
          </span>
          <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">
              <Marked text={choice.label} typed={search} />
            </span>
            {choice.heldAt ? (
              <span aria-hidden className="max-w-[45%] shrink-0 truncate text-[12.5px] text-[var(--ph-ink-3)]">
                <Marked text={choice.heldAt} typed={search} />
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

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
      label="Search Investment"
    />
  );

  return (
    <Sheet
      grouped
      tall
      title="Investment"
      onClose={onClose}
      closeHidden={finding}
      heading={finding ? searchField : undefined}
      action={
        <SheetSearchButton
          open={finding}
          onClick={() => {
            if (finding) setSearch('');
            setFinding((was) => !was);
          }}
        />
      }
    >
      <div onTouchMove={() => (document.activeElement as HTMLElement | null)?.blur()} data-testid="investment-sections">
        {sections.map((section) => (
          <section key={section.key} aria-label={section.title}>
            <h3 className="px-[14px] pt-[10px] pb-[6px] text-[12px] tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">{section.title}</h3>
            <ul className={LIST}>{section.rows.map(row)}</ul>
          </section>
        ))}
        {searching && sections.length === 0 ? (
          <p className="px-4 pt-3 text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing here matches “{search.trim()}”.</p>
        ) : null}
        {!searching && sections.length === 0 ? (
          <p className="px-4 pt-3 text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">No investments yet.</p>
        ) : null}
        {/* A group of its own at the foot, as Add account is under Paid with: inside the last kind it would read as adding gold. */}
        {onNew ? (
          <ul className={cx(LIST, 'mt-3')}>
            <li>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNew();
                }}
                className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
              >
                <span aria-hidden className="flex w-[34px] shrink-0 items-center justify-center text-[var(--ph-tint)]">
                  <Plus size={16} />
                </span>
                <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center pr-[13px]">
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-tint)]">New investment</span>
                </span>
              </button>
            </li>
          </ul>
        ) : null}
      </div>
    </Sheet>
  );
}
