/**
 * One drawn face's art, as `scripts/debit-art.mjs` cuts it from the approved drawings: the gradients it needs, the shapes
 * inside the card (a 340 × 214 viewBox), and what was read off the drawing for the print the app lays over it.
 */
export interface FaceArt {
  /** The gradients the art refers to, for the face's own `<defs>`. Ids are namespaced by the face that draws them. */
  defs: string;
  /** The background and pattern, in the card's own coordinates. */
  art: string;
  /** Whether the card's print is light on a dark ground or dark on a light one. */
  ink: 'light' | 'dark';
  /** The bank's name in its own colour, where the drawing did not print it in the ink. */
  bank?: string;
  /** The chip's metal on a debit card; absent on a face that carries no chip. */
  chip?: 'gold' | 'silver';
}
