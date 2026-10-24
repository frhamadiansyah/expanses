import { useState } from 'react';

/**
 * Asking twice, in place: the first tap arms, the second confirms, and walking away (blur) disarms.
 *
 * The one mechanism behind both ways a delete is asked for — the receipt's `TwoTapDelete` and a swipe's round
 * action — so neither can drift into deleting on a single tap. The state lives in the component that draws the
 * button, so it dies with it: a swiped row draws its actions only while open, and closing it forgets the arming.
 */
export function useTwoTap(onConfirm: () => void) {
  const [armed, setArmed] = useState(false);
  return {
    armed,
    onBlur: () => setArmed(false),
    onClick: () => (armed ? onConfirm() : setArmed(true)),
  };
}
