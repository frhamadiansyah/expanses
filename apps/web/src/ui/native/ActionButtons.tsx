import { type LinkProps, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { TAP } from './metrics';

/**
 * What a money account's page does, under its figure: up to three round buttons, each a glyph in the tint on the
 * list's own white and a word under it — the row a bank's app draws beneath a balance.
 *
 * Each one is a real link when it goes somewhere (a new transaction, the Move screen) and a real button when it
 * opens something in place (a deposit's Break early sheet), so a desktop keeps its middle-click and a spec can tell
 * the two apart by role. The accessible name is the word under the circle; the glyph is decoration.
 */
export interface RoundAction {
  key: string;
  label: string;
  glyph: ReactNode;
  to?: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  run?: () => void;
  testId?: string;
}

/**
 * The row of them. Equal columns whatever the count, so one action sits where the first of three would and the
 * words under the circles line up across every account's page. Nothing is drawn when there is nothing to do.
 */
export function ActionButtons({ actions }: { actions: RoundAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mb-[20px] grid w-full grid-cols-3 gap-2 md:max-w-sm" role="group" aria-label="Actions">
      {actions.map((action) => {
        const face = (
          <>
            <span
              aria-hidden
              className="flex items-center justify-center rounded-full bg-[var(--ph-surface)] text-[var(--ph-tint)]"
              style={{ width: TAP, height: TAP }}
            >
              {action.glyph}
            </span>
            <span className="text-[12.5px] leading-[16px] font-medium text-[var(--ph-ink-2)]">{action.label}</span>
          </>
        );
        const shell = 'ph-focus flex min-w-0 flex-col items-center gap-[6px] rounded-xl py-[2px] text-center';
        return action.to ? (
          <Link key={action.key} to={action.to} params={action.params} search={action.search} className={shell} data-testid={action.testId}>
            {face}
          </Link>
        ) : (
          <button key={action.key} type="button" onClick={action.run} className={shell} data-testid={action.testId}>
            {face}
          </button>
        );
      })}
    </div>
  );
}
