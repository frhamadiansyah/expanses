import { RouterProvider, useNavigate, useRouter } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { cx } from '../ui';
import { FormPanelContext } from '../ui/native/form-panel-context';
import { DeskNotices } from './DeskNotices';
import { createBaseRouter } from './router';
import { edgeToEdge } from './sidebar-model';
import { isPanelForm } from './form-panel-model';

/*
 * A Mac form as a panel on the right (option C, owner 2026-11-23). The form keeps its own address and is drawn by the
 * app's router inside the panel; the page under it is the page it was opened from, drawn by a router of its own
 * (`createBaseRouter`) so it is the real page — it scrolls, its rows open — and is not dimmed. Whatever that page goes
 * to is handed to the app's router, which leaves the form.
 */

/** The page under the panel, at `href`, laid out as Layout lays that page out. */
function BasePage({ href }: { href: string }) {
  const main = useRouter();
  const base = useMemo(() => createBaseRouter(href), [href]);
  const path = href.split(/[?#]/)[0] ?? href;
  const own = edgeToEdge(path, false, /[?&]account=/.test(href));
  useEffect(() => {
    let first: string | null = null;
    return base.subscribe('onResolved', ({ toLocation }) => {
      // Its first arrival (a redirect included) is where it is; anything after is the page being used.
      if (first === null) {
        first = toLocation.href;
        return;
      }
      if (toLocation.href === first) return;
      // Only while the form is up: once the app has left it (a save, ✕), the page under it is on its way out, and what it
      // does then (a peek letting go of the row a save just replaced) is not the person's doing.
      if (!isPanelForm(main.state.location.pathname)) return;
      void main.navigate({ href: toLocation.href });
      // The page stays the page under the panel: a form it opens (its own Edit, say) is drawn in the panel, never under it.
      void base.navigate({ href: first, replace: true });
    });
  }, [base, main]);
  return (
    <div className={own ? 'mk w-full' : 'desk-column mk mk-col w-full max-w-[1000px] pb-8'} data-testid="panel-base-page">
      {!own && <DeskNotices column />}
      {own ? <RouterProvider router={base} /> : <div className="mk-col-body">{<RouterProvider router={base} />}</div>}
    </div>
  );
}

/** The panel itself: the form scrolls inside it; its foot holds Cancel and the form's primary button. */
function Panel({ baseHref, children }: { baseHref: string; children: ReactNode }) {
  const navigate = useNavigate();
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ foot, close: () => void navigate({ href: baseHref }) }), [foot, navigate, baseHref]);
  // Esc closes as ✕ does (a form that asks before it drops what was typed still asks); Return in a field saves.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const panel = event.currentTarget;
    if (event.key === 'Escape') {
      panel.querySelector<HTMLButtonElement>('[data-panel-close]')?.click();
      return;
    }
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && !event.shiftKey && target.tagName === 'INPUT' && !target.closest('[role="combobox"],[role="listbox"],[aria-expanded="true"]')) {
      const primary = panel.querySelector<HTMLButtonElement>('[data-panel-primary]');
      if (primary && !primary.disabled) {
        event.preventDefault();
        primary.click();
      }
    }
  };
  return (
    <FormPanelContext.Provider value={value}>
      {/* Not a dialog: the page beside it stays in use (and a form's sheet-only styling stays the sheet's). */}
      <aside
        aria-label="Form"
        data-testid="form-panel"
        onKeyDown={onKeyDown}
        className="mk mk-panel fixed top-[var(--desk-bar)] right-[14px] bottom-[14px] z-30 flex w-[410px] max-w-[calc(100vw-28px)] flex-col overflow-hidden rounded-[22px] bg-[var(--mk-panel)] shadow-[var(--mk-panel-shadow)]"
      >
        <div className="mk-panel-body min-h-0 flex-1 overflow-y-auto px-[22px] pt-[20px] pb-[12px]">{children}</div>
        <div ref={setFoot} data-testid="form-panel-foot" className={cx('flex shrink-0 items-center justify-end gap-[10px] px-[22px] pb-[16px] empty:hidden', 'pt-[10px]')} />
      </aside>
    </FormPanelContext.Provider>
  );
}

/** The form at the app's address in the panel, over the page it was opened from. */
export function FormPanelHost({ baseHref, children }: { baseHref: string; children: ReactNode }) {
  return (
    <>
      <BasePage href={baseHref} />
      <Panel baseHref={baseHref}>{children}</Panel>
    </>
  );
}
