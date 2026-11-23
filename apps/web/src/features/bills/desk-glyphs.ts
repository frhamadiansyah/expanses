import { createLucideIcon } from 'lucide-react';

/*
 * v1's bare "!" and "?" for a stat tile's round icon (Bills' Late, Review's Waiting and Missing something). Lucide draws
 * them only inside a circle or a triangle, and the tile's round icon is the circle already.
 */
export const Bang = createLucideIcon('DeskBang', [
  ['path', { d: 'M12 5v9', key: 'bang-line' }],
  ['path', { d: 'M12 19h.01', key: 'bang-dot' }],
]);

export const Question = createLucideIcon('DeskQuestion', [
  ['path', { d: 'M8.6 8.4a3.5 3.5 0 0 1 6.8 1.1c0 2.3-3.4 3.2-3.4 5', key: 'question-hook' }],
  ['path', { d: 'M12 19h.01', key: 'question-dot' }],
]);
