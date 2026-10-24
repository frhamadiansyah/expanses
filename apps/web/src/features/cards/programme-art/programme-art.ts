/**
 * One membership card's drawing, as `scripts/programme-art.mjs` cuts it from the approved faces (docs/card-art/membership):
 * everything but the placeholder print, in the card's own 340 × 214 coordinates. The drawing is split around its brand
 * layer — the programme's name and the tier's word, top-left — so a card covered in a pile, whose band prints the
 * programme's name there, can leave it out. `under + brand + over` is the whole face; `under + over` the face without its
 * brand. Neither half is a whole element on its own (a clip group can open in `under` and close in `over`): they are only
 * ever drawn joined.
 */
export interface ProgrammeArt {
  /** The gradients, filters, masks and clips the drawing refers to. Ids are namespaced by the face that draws them. */
  defs: string;
  under: string;
  brand: string;
  over: string;
  /** Whether the brand is printed light on a dark ground or dark on a light one: the band's print follows it. */
  ink: 'light' | 'dark';
}
