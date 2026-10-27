import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A hero that slides: each card takes the whole width, and the dots under
 * it say which page is showing. Swiping, the dots and the arrow keys all move it; the page under it follows `page`.
 */
export function HeroSlider({
  pages,
  names,
  page,
  onPage,
  label,
}: {
  pages: ReactNode[];
  names: string[];
  page: number;
  onPage: (page: number) => void;
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  // Where a dot or key sent the track: scroll events on the way there must not say the page is somewhere between.
  const heading = useRef<number | null>(null);

  const leftOf = useCallback((index: number) => {
    const el = track.current;
    if (!el) return 0;
    const max = el.scrollWidth - el.clientWidth;
    return pages.length > 1 ? (max * index) / (pages.length - 1) : 0;
  }, [pages.length]);

  const go = useCallback(
    (index: number) => {
      const el = track.current;
      const next = Math.max(0, Math.min(pages.length - 1, index));
      onPage(next);
      if (!el) return;
      // Already there: no scroll will come to end the wait.
      if (Math.abs(el.scrollLeft - leftOf(next)) < 2) return;
      heading.current = next;
      el.scrollTo({ left: leftOf(next), behavior: reduced() ? 'auto' : 'smooth' });
      // A track already there fires no scroll: do not wait on one.
      window.setTimeout(() => {
        if (heading.current === next) heading.current = null;
      }, 800);
    },
    [leftOf, onPage, pages.length],
  );

  // Opening on the page that was last shown: no animation, before the first paint.
  useLayoutEffect(() => {
    const el = track.current;
    if (el && page > 0) el.scrollLeft = leftOf(page);
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A resize moves the stops: stay on the page that is showing. Only a change of width counts, never the first look.
  const shown = useRef(page);
  shown.current = page;
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.scrollLeft = leftOf(shown.current);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [leftOf]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    if (heading.current !== null) {
      if (Math.abs(el.scrollLeft - leftOf(heading.current)) > 2) return;
      heading.current = null;
    }
    const index = Math.round((el.scrollLeft / max) * (pages.length - 1));
    if (index !== page) onPage(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(page + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(page - 1);
    }
  };

  return (
    <div className="md:max-w-2xl" data-testid="hero-slider">
      <div
        ref={track}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        onTouchStart={() => (heading.current = null)}
        onWheel={() => (heading.current = null)}
        onKeyDown={onKeyDown}
        className="ph-focus flex snap-x snap-mandatory gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ overscrollBehaviorX: 'contain' }}
      >
        {pages.map((card, index) => (
          <div
            key={names[index]}
            role="group"
            aria-roledescription="slide"
            aria-label={names[index]}
            aria-hidden={index === page ? undefined : true}
            className="w-full shrink-0 snap-start"
          >
            {card}
          </div>
        ))}
      </div>
      <div role="group" aria-label="Page" className="flex justify-center" style={{ marginBottom: 12 }}>
        {names.map((name, index) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            aria-current={index === page ? 'true' : undefined}
            onClick={() => go(index)}
            className="ph-focus flex h-8 w-6 items-center justify-center"
          >
            <span aria-hidden className={`block h-[7px] w-[7px] rounded-full ${index === page ? 'bg-[var(--ph-ink)]' : 'bg-[var(--ph-track)]'}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
