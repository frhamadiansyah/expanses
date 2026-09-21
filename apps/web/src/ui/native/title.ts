/**
 * What a large title's corner does with more actions than it has corners.
 *
 * Two circular buttons is the iOS limit on the right of a title, and the app today answers that pressure by
 * turning actions into underlined text links until the header is a sentence. The rule instead: the corner holds
 * two buttons, and when there are more than two to hold, the second of them becomes a `…`.
 */

import type { LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export interface CornerAction {
  key: string;
  /** The accessible name. Corner buttons carry a glyph, never a word, so this is all a screen reader gets. */
  label: string;
  destructive?: boolean;
  /** The glyph inside the circle. A corner button never carries a word — that is what the `…` menu is for. */
  glyph?: ReactNode;
  run?: () => void;
  /** True while the action cannot be taken: the corner dims and refuses, instead of failing when it is tapped. */
  disabled?: boolean;
  /**
   * Where the action goes, when it goes somewhere.
   *
   * An action that is a journey is drawn as a link, so a desktop keeps the middle-click and the new tab it has
   * today. `run` is for the actions that do something instead; an action gives one or the other, never both.
   */
  to?: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
}

/** Two buttons on the right, counting the `…` itself. */
export const CORNER_MAX = 2;

export interface CornerPlan {
  /** Drawn as circular buttons, in order. */
  inline: CornerAction[];
  /** Behind the `…`. Empty when everything fitted, in which case no `…` is drawn at all. */
  overflow: CornerAction[];
}

/**
 * Split actions into the ones with a corner of their own and the ones behind the `…`.
 *
 * The `…` occupies one of the `max` slots, so three actions become one button and a menu of two — not two
 * buttons and a menu, which would be three buttons on a phone's right corner.
 */
export function planCornerActions(actions: readonly CornerAction[], max = CORNER_MAX): CornerPlan {
  if (actions.length <= max) return { inline: [...actions], overflow: [] };
  return { inline: actions.slice(0, max - 1), overflow: actions.slice(max - 1) };
}

/**
 * The line above a large title: `‹ Name`, naming where back goes.
 *
 * It names the destination rather than saying "Back", because on a screen reached from two places "Back" is the
 * one thing it cannot tell you.
 */
export function backLabel(destination: string): string {
  return `‹ ${destination}`;
}

/**
 * How many characters a 30 px / 800 large title holds on one line of a 390 pt phone, gutters taken off.
 *
 * Measured, not guessed: the 358 px column holds about twenty of the app's own letters at that weight.
 */
export const LARGE_TITLE_FITS = 20;

/**
 * Whether a one-line large title steps down a size to keep its name whole.
 *
 * A name a person typed — "BCA KrisFlyer Visa Signature" — is the one thing on the screen that must be read whole,
 * and at 30 px it breaks across two lines on a phone. iOS keeps a large title to one line, so a long one steps
 * down to 22 px, which holds it; anything longer still is cut with an ellipsis rather than wrapped, and the whole
 * name stays the heading's accessible name and its tooltip.
 */
export function titleSteps(title: string): boolean {
  return title.length > LARGE_TITLE_FITS;
}
