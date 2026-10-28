import { type ReactNode, useCallback, useEffect, useRef } from 'react';

export interface HeroSlide {
  key: string;
  label: string;
  node: ReactNode;
}

/**
 * A row of full-width cards that snap under a swipe, with a dot per card below. The active card is the parent's state
 * (`active`), read from the scroll position as it settles, so the list under the hero can follow it. The dots are
 * buttons named for their card, so a card can be reached without swiping. Every card is as tall as the tallest, and
 * none peeks at the edge: each fills the width.
 */
export function HeroSwipe({ label, slides, active, onActive }: { label: string; slides: readonly HeroSlide[]; active: number; onActive: (index: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  // The card a tap on a dot is scrolling to: scroll events on the way there must not report the cards passed.
  const heading = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const indexAt = useCallback(() => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return 0;
    return Math.min(slides.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
  }, [slides.length]);

  const onScroll = () => {
    const index = indexAt();
    if (heading.current !== null) {
      if (index !== heading.current) return;
      heading.current = null;
    }
    if (index !== active) onActive(index);
  };

  const go = (index: number) => {
    const el = scroller.current;
    onActive(index);
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.current = reduce ? null : index;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => (heading.current = null), 700);
    el.scrollTo({ left: index * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="w-full md:max-w-2xl">
      <div
        ref={scroller}
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        data-testid="hero-swipe"
        className="ph-focus flex w-full snap-x snap-mandatory items-stretch overflow-x-auto overscroll-x-contain rounded-[11px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <div
            key={slide.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${slide.label}, ${index + 1} of ${slides.length}`}
            aria-hidden={index === active ? undefined : true}
            data-testid={`hero-slide-${slide.key}`}
            className="@container flex w-full shrink-0 snap-start snap-always flex-col"
          >
            {slide.node}
          </div>
        ))}
      </div>
      <div className="flex justify-center" data-testid="hero-dots">
        {slides.map((slide, index) => (
          <button
            key={slide.key}
            type="button"
            aria-label={slide.label}
            aria-current={index === active ? 'true' : undefined}
            onClick={() => go(index)}
            className="ph-focus flex h-8 w-6 items-center justify-center"
          >
            <span aria-hidden className={`block h-[6px] w-[6px] rounded-full ${index === active ? 'bg-[var(--ph-ink)]' : 'bg-[var(--ph-chevron)]'}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
