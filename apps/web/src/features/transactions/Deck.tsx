import { type ReactNode, useRef } from 'react';
import { cx } from '../../ui';

/**
 * Two charts as pages of one card, moved between by swiping sideways or by tapping a dot.
 *
 * A swipe is what the two charts already look like they want — a wallet card turned over — and the dots
 * are the only new furniture, so the card gains a second question without gaining a second switch.
 */
export function Deck({
  page,
  onPage,
  labels,
  frame = (pages) => pages,
  children,
}: {
  page: number;
  onPage?: (page: number) => void;
  labels: string[];
  /** Wraps the pages but not the dots, so a tap on the chart never lands on a dot's own button. */
  frame?: (pages: ReactNode) => ReactNode;
  children: ReactNode[];
}) {
  const deck = useRef<HTMLDivElement>(null);

  // The scroll is the truth: a swipe and a tapped dot both end up here.
  const onScroll = () => {
    const box = deck.current;
    if (!box || box.clientWidth === 0) return;
    const at = Math.round(box.scrollLeft / box.clientWidth);
    if (at !== page) onPage?.(at);
  };

  const go = (to: number) => {
    const box = deck.current;
    if (box) box.scrollTo({ left: to * box.clientWidth, behavior: 'smooth' });
    onPage?.(to);
  };

  return (
    <div>
      {frame(
        <div ref={deck} onScroll={onScroll} className="-mx-3 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="chart-deck">
          {children.map((child, index) => (
            // The charts are fixed in order, so their position is the only name they have.
            // biome-ignore lint/suspicious/noArrayIndexKey: the pages are positional
            <div key={index} className="w-full shrink-0 snap-center px-3">
              {child}
            </div>
          ))}
        </div>,
      )}
      {/*
       * The dots' own strip, kept whether the deck has one page or two.
       *
       * The card's height must not depend on which question it is showing: a reader who turns from what the money going
       * out is made of to what the money coming in is made of would otherwise watch the list below jump up by the
       * height of a control that had quietly gone. So the strip is furniture — the dots are drawn in it when there are
       * two pages to choose between, and it is left empty when there is only one.
       */}
      <div className="flex h-3 justify-center gap-1.5 pt-1.5">
        {labels.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-current={index === page}
            onClick={() => go(index)}
            className={cx('h-1.5 rounded-full transition-all', index === page ? 'w-4 bg-slate-400' : 'w-1.5 bg-slate-200')}
          />
        ))}
      </div>
    </div>
  );
}
