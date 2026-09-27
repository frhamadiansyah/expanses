import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../index';
import type { CornerAction } from './title';

/** The compact bar's own height under the status bar: iOS's 44 pt navigation bar. */
const BAR = 44;

/**
 * Whether a title has scrolled under the status bar and the compact bar that stands in for it: the moment its
 * last line is behind the glass. Watched with an IntersectionObserver, never a scroll listener.
 *
 * Off inside a sheet — a sheet scrolls in a box of its own, and a bar over the whole screen would sit on top of
 * it — and off on a wide screen, where the title is a header rather than the header.
 */
export function useScrolledPast(ref: RefObject<HTMLElement | null>, enabled = true, pinned = false): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return;
    if (el.closest('[role="dialog"]')) return;
    if (window.matchMedia?.('(min-width: 768px)').matches) return;
    // The status bar's height is only known to CSS, so a probe as tall as it says what it is.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const inset = probe.offsetHeight;
    probe.remove();
    // Pinned, the bar is the title itself held in place, so it takes over the moment the title starts to move;
    // folded, it waits until the big title is gone under the bar.
    const observer = pinned
      ? new IntersectionObserver(([entry]) => setPast(entry ? entry.intersectionRatio < 1 && entry.boundingClientRect.top < inset : false), {
          rootMargin: `-${inset}px 0px 0px 0px`,
          threshold: [0, 1],
        })
      : new IntersectionObserver(([entry]) => setPast(entry ? !entry.isIntersecting && entry.boundingClientRect.top < inset + BAR : false), {
          rootMargin: `-${inset + BAR}px 0px 0px 0px`,
        });
    observer.observe(el);
    return () => {
      observer.disconnect();
      setPast(false);
    };
  }, [ref, enabled, pinned]);
  // While the bar is up it carries the status bar's glass itself, so the shell's strip stands down.
  useEffect(() => {
    if (!past) return;
    document.documentElement.dataset.compactBar = '';
    return () => {
      delete document.documentElement.dataset.compactBar;
    };
  }, [past]);
  return past;
}

/**
 * The bar a page's big title folds into once it scrolls under the clock: glass over the status bar and 44 pt
 * under it, the page's name small and centred, and its corner actions as plain glyphs — option C of the
 * large-title mockup. A pushed page keeps its way back at the left.
 *
 * Hidden from assistive tech: every control on it is a second copy of one in the title, which is still on the
 * page, so a screen reader meets each action once.
 */
export function CompactBar({
  title,
  back,
  onBack,
  backTo,
  backParams,
  backSearch,
  actions,
  overflow,
}: {
  title: string;
  back?: string;
  onBack?: () => void;
  backTo?: LinkProps['to'];
  backParams?: LinkProps['params'];
  backSearch?: LinkProps['search'];
  actions: CornerAction[];
  overflow: CornerAction[];
}) {
  const [menu, setMenu] = useState<CornerAction[] | null>(null);
  const plain = 'flex h-[44px] min-w-[36px] items-center justify-center text-[var(--ph-ink)] disabled:opacity-40';
  const glyph = (action: CornerAction): ReactNode => action.glyph;
  const tap = (action: CornerAction) => {
    if (action.menu) setMenu((was) => (was === action.menu ? null : (action.menu ?? null)));
    else action.run?.();
  };
  const button = (action: CornerAction) =>
    action.to && !action.menu ? (
      <Link key={action.key} to={action.to} params={action.params} search={action.search} tabIndex={-1} className={plain}>
        {glyph(action)}
      </Link>
    ) : (
      <button key={action.key} type="button" tabIndex={-1} disabled={action.disabled} onClick={() => tap(action)} className={plain}>
        {glyph(action)}
      </button>
    );
  return createPortal(
    <div
      aria-hidden
      className="ph-edge-glass pointer-events-none fixed inset-x-0 top-0 z-[29] md:hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="pointer-events-auto relative flex items-center gap-2 px-3" style={{ height: BAR }}>
        <div className="flex flex-1 items-center">
          {back &&
            (backTo ? (
              <Link to={backTo} params={backParams} search={backSearch} tabIndex={-1} className={plain}>
                <ChevronLeft size={24} aria-hidden />
              </Link>
            ) : (
              <button type="button" tabIndex={-1} onClick={onBack} className={plain}>
                <ChevronLeft size={24} aria-hidden />
              </button>
            ))}
        </div>
        <span className="min-w-0 max-w-[55%] truncate text-center text-[17px] font-semibold text-[var(--ph-ink)]">{title}</span>
        <div className="flex flex-1 items-center justify-end gap-1">
          {actions.map(button)}
          {overflow.length > 0 &&
            button({
              key: 'more',
              label: 'More',
              glyph: <span className="text-[18px] leading-none">⋯</span>,
              menu: overflow,
            })}
        </div>
        {menu && (
          <>
            <span className="fixed inset-0" onClick={() => setMenu(null)} role="presentation" />
            <span className="absolute top-full right-3 mt-[4px] block w-max max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl bg-[var(--ph-surface)] shadow-xl ring-1 ring-[var(--ph-hair)]">
              {menu.map((item) => {
                const line = (
                  <>
                    {item.glyph ? (
                      <span className={cx('flex shrink-0 items-center', item.destructive ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]')}>
                        {item.glyph}
                      </span>
                    ) : null}
                    <span className="flex-1">{item.label}</span>
                  </>
                );
                const cls = cx(
                  'flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm whitespace-nowrap',
                  item.destructive ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink)]',
                );
                return item.to ? (
                  <Link
                    key={item.key}
                    to={item.to}
                    params={item.params}
                    search={item.search}
                    tabIndex={-1}
                    onClick={() => setMenu(null)}
                    className={cls}
                  >
                    {line}
                  </Link>
                ) : (
                  <button
                    key={item.key}
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      setMenu(null);
                      item.run?.();
                    }}
                    className={cls}
                  >
                    {line}
                  </button>
                );
              })}
            </span>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A section's title held where it stands: once the page moves, a copy of the title row — the same 30 px name at
 * the left and the same round corner buttons at the right, in the same places — is pinned over the page on glass,
 * so nothing in the header shrinks or shifts as the page scrolls under it. The corner buttons it draws are the
 * caller's, so they open what they always open.
 */
export function PinnedTitleBar({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      aria-hidden
      className="ph-edge-glass pointer-events-none fixed inset-x-0 top-0 z-[29] md:hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="pointer-events-auto mx-auto max-w-4xl px-4 pb-[8px]">{children}</div>
    </div>,
    document.body,
  );
}
