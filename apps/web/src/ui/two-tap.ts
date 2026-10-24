import { useState } from 'react';

/**
 * Asking twice, in place: the first tap arms, the second confirms, and walking away (blur) disarms.
 *
 * The mechanism behind the receipt's `TwoTapDelete`, kept apart so a second way of asking cannot drift into
 * deleting on a single tap. The state lives in the component that draws the button, so it dies with it. (A swipe's
 * Delete does not ask: it acts, and its list's Undo toast holds the delete back until the toast has gone.)
 */
export function useTwoTap(onConfirm: () => void) {
  const [armed, setArmed] = useState(false);
  return {
    armed,
    onBlur: () => setArmed(false),
    onClick: () => (armed ? onConfirm() : setArmed(true)),
  };
}
