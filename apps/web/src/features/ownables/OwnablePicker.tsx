import { assetFamily, type OwnableFamily, type OwnableFlow } from '@expanses/core';
import { Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { usePhone } from '../../app/use-phone';
import { cx } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, SearchField, SearchPill } from '../../ui/native';
import { type HandOverRow, MORE_ROW_ID, type PickerRow, pickerRows } from './catalogue-view';

/**
 * Where the circle at the top left goes, named: the list this screen was opened from. A screen reached from two
 * places cannot just say "Back" — and when there is still a step to undo inside this screen, Back does that first.
 */
const BACK_TO: Record<OwnableFlow, string> = { account: 'Accounts', asset: 'Assets', debt: 'Liabilities' };

/**
 * Two levels and a search box: the family, then the thing, the way the category picker already works.
 *
 * The same component serves all three flows because they differ only in which rows they draw — the catalogue
 * answers that — and in the form that follows, which the caller passes in as children.
 *
 * A phone gets one screen at a time: the list, then the form, with a Back button that undoes exactly one step.
 * A wider screen keeps the list where it is and puts the form beside it, so choosing again is one click rather
 * than a click and a Back; desktop is never given the phone's smaller version of the same screen.
 */
export function OwnablePicker({
  flow,
  title,
  searchPlaceholder,
  moreHint,
  chosen,
  onChoose,
  handOver = [],
  children,
}: {
  flow: OwnableFlow;
  /** The screen's own heading — "New account", "New asset", "New debt". */
  title: string;
  searchPlaceholder: string;
  /** The sentence above the "Something else" list, given the open family's name to put in it. */
  moreHint?: (familyLabel: string) => ReactNode;
  /** The item id whose form is open, or null while nobody has chosen. */
  chosen: string | null;
  onChoose: (id: string | null) => void;
  handOver?: HandOverRow[];
  /** The chosen item's form. */
  children?: ReactNode;
}) {
  const phone = usePhone();
  const router = useRouter();
  const [query, setQuery] = useState('');
  /*
   * On a phone the search box stands down and a corner takes its place, the way Cashflow's does: the field is in the
   * bar where a thumb already is, and the list below it never loses its first row to a control nobody is using.
   */
  const [showSearch, setShowSearch] = useState(false);
  const [family, setFamily] = useState<OwnableFamily | null>(null);
  const [more, setMore] = useState(false);

  const searching = query.trim() !== '';
  const rows = pickerRows({ flow, query, family: family ?? undefined, more });

  /**
   * One step back: out of the form, out of a search, out of "Something else", out of a family. Nothing else moves.
   *
   * A typed query is a step of its own, above the family it hides: without that, Back on a search result looks
   * broken — it would drop the family underneath while the results, which do not depend on it, stayed put.
   */
  const back = () => {
    if (chosen) onChoose(null);
    else if (showSearch) {
      setQuery('');
      setShowSearch(false);
    } else if (searching) setQuery('');
    else if (more) setMore(false);
    else if (family) setFamily(null);
  };
  const canGoBack = Boolean(chosen || showSearch || searching || more || family);

  function choose(id: string) {
    if (id === MORE_ROW_ID) {
      setMore(true);
      return;
    }
    // A family row opens that family; anything else is a thing, and opens its form.
    if (flow === 'asset' && !searching && !family && !more) {
      setFamily(id as OwnableFamily);
      return;
    }
    onChoose(id);
  }

  /*
   * The one sentence the list still carries: what "Something else" is showing. It belongs to the group, so it is
   * the group's footer — the kit's own place for it — rather than a paragraph floating under a card. A search
   * narrows the list to what was typed, and the sentence is not about that, so it stands down while one runs.
   *
   * The group has no header. Three flows wear this one list, and the name in the bar above it already says which
   * list this is, so a second name over the box was the screen introducing itself twice.
   */
  const listFooter = searching ? undefined : more && family && moreHint ? moreHint(assetFamily(family).label) : undefined;

  const list = (
    <>
      {/* The box is a wide screen's: a phone gives the bar a corner instead, and the field takes the name's place. */}
      {!phone && (
        <div className="mb-[12px]">
          <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
        </div>
      )}
      {/* The list is the answer to what is typed above it, so a screen reader hears it change, not only sees it. */}
      <div aria-live="polite">
        <InsetGroup footer={listFooter}>
          {rows.length > 0 ? (
            rows.map((row) => <PickerInsetRow key={row.id} row={row} onClick={() => choose(row.id)} />)
          ) : (
            <InsetRow title={`Nothing here matches “${query.trim()}”.`} chevron={false} />
          )}
        </InsetGroup>
      </div>
      {handOver.length > 0 && !searching && !family && (
        <InsetGroup>
          {handOver.map((row) => {
            // A typed `Link` wherever the picker it hands over to has been built, so the router checks the path at
            // compile time; the rest stay a plain push until their route exists, which navigates just the same.
            const to = typedHandOver(row.to);
            return to ? <PickerInsetRow key={row.id} row={row} to={to} /> : <PickerInsetRow key={row.id} row={row} onClick={() => router.history.push(row.to)} />;
          })}
        </InsetGroup>
      )}
    </>
  );

  return (
    <div className={SCREEN}>
      {/*
       * A subpage's bar: the circle names the list this came from, and one tap undoes one step of this screen first.
       * Searching takes the name's place rather than the list's first row.
       */}
      <PushedTitle
        title={more ? 'Something else' : title}
        back={BACK_TO[flow]}
        onBack={() => (canGoBack ? back() : router.history.back())}
        field={
          phone && showSearch ? (
            <SearchPill
              value={query}
              onChange={setQuery}
              onClose={() => {
                setQuery('');
                setShowSearch(false);
              }}
              placeholder={searchPlaceholder}
            />
          ) : undefined
        }
        actions={
          phone
            ? [{ key: 'search', label: 'Search', glyph: <Search size={20} aria-hidden />, pressed: showSearch, run: () => setShowSearch((was) => !was) }]
            : []
        }
      />
      {/* One screen at a time on a phone; both at once on anything wider, the list on the left. */}
      <div className={cx('gap-6', chosen ? 'md:grid md:grid-cols-2 md:items-start' : '')}>
        <div className={cx(phone && chosen && 'hidden')}>{list}</div>
        {chosen && <div className={cx(phone ? '' : 'mt-4 md:mt-0')}>{children}</div>}
      </div>
    </div>
  );
}

/**
 * A choice, as a row: the emoji that names its family, what it is, the line under it, and a chevron.
 *
 * The kit draws the circle behind the emoji in its own neutral fill. The family's tint was a Tailwind class,
 * and `iconColour` wants a colour — reading one from the other would mean a second copy of the tint table, so
 * the emoji, which is what actually identifies the family, carries it alone.
 */
function PickerInsetRow({ row, onClick, to }: { row: PickerRow; onClick?: () => void; to?: TypedHandOver }) {
  // The row's kind, drawn in the kit's own circle: one stroke, in the ink the circle already sets.
  const Glyph = row.icon;
  return <InsetRow icon={<Glyph size={16} aria-hidden />} title={row.label} subtitle={row.sub} chevron onClick={onClick} to={to} />;
}

/** The pickers that exist as routes today. A hand-over anywhere else falls back to a push until its route lands. */
const TYPED_HAND_OVER = ['/accounts/new', '/net-worth/assets/new', '/debts/new'] as const;
type TypedHandOver = (typeof TYPED_HAND_OVER)[number];
const typedHandOver = (to: string): TypedHandOver | null => TYPED_HAND_OVER.find((path) => path === to) ?? null;

