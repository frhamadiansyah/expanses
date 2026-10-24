// apps/web/scripts/programme-art.mjs — cuts the approved membership card drawings (docs/card-art/membership/*.svg, one
// whole card per programme and tier) down to what the app draws of them, and writes them as
// src/features/cards/programme-art/faces.generated.ts.
//
// Each drawing is in three layers: `art` (the ground and pattern), `brand` (the programme's name and the tier's word,
// top-left — final, kept as drawn) and `print` (a placeholder embossed MEMBER NAME and noughts, bottom-left). The app
// keeps no member's name or number, so the print layer is dropped, with the hidden leftovers a drawing may carry
// (`display="none"` text) and every definition only the print used. What is left is split around the brand layer, so a
// face covered in a pile — whose band prints the programme's name over its top — can draw the art without it.
//
//   node scripts/programme-art.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../../../docs/card-art/membership/', import.meta.url);
const target = new URL('../src/features/cards/programme-art/faces.generated.ts', import.meta.url);

/** Where the element opening at `open` ends: just past the close that balances its own opens. */
function endOf(text, open) {
  const tag = /^<([a-zA-Z]+)/.exec(text.slice(open))[1];
  const end = text.indexOf('>', open);
  if (text[end - 1] === '/') return end + 1;
  let depth = 1;
  let cursor = end + 1;
  while (depth > 0) {
    const nextOpen = text.indexOf(`<${tag}`, cursor);
    const nextClose = text.indexOf(`</${tag}>`, cursor);
    if (nextClose < 0) throw new Error(`<${tag}> at ${open} never closes`);
    if (nextOpen >= 0 && nextOpen < nextClose && /[\s>/]/.test(text[nextOpen + tag.length + 1])) {
      // A self-closing element of the same tag opens nothing.
      const openEnd = text.indexOf('>', nextOpen);
      if (text[openEnd - 1] !== '/') depth += 1;
      cursor = openEnd + 1;
    } else {
      depth -= 1;
      cursor = nextClose + tag.length + 3;
    }
  }
  return cursor;
}

/** The top-level elements of a fragment, each as its whole text. */
function elements(fragment) {
  const out = [];
  let at = 0;
  for (;;) {
    const open = fragment.indexOf('<', at);
    if (open < 0) return out;
    const end = endOf(fragment, open);
    out.push(fragment.slice(open, end));
    at = end;
  }
}

/** The fragment with every element whose opening tag matches `opening` taken out, children and all. */
function without(text, opening) {
  let out = text;
  for (;;) {
    const match = opening.exec(out);
    if (!match) return out;
    out = out.slice(0, match.index) + out.slice(endOf(out, match.index));
  }
}

/** The ids a fragment refers to: `url(#…)` and `href="#…"`. */
const refsOf = (text) => new Set([...text.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]));

/** Whether a hex colour prints light on its ground (white, cream) or dark (navy, brown). */
function inkOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? 'light' : 'dark';
}

const files = readdirSync(source)
  .filter((file) => file.endsWith('.svg'))
  .sort();
const faces = {};
for (const file of files) {
  const key = file.slice(0, -'.svg'.length);
  const svg = readFileSync(new URL(file, source), 'utf8');
  for (const unsafe of ['`', '${', '\\']) if (svg.includes(unsafe)) throw new Error(`${file}: has ${unsafe}, which a template string would read`);
  const inner = /^\s*<svg\b[^>]*>(.*)<\/svg>\s*$/s.exec(svg)?.[1];
  if (!inner) throw new Error(`${file}: not one <svg>`);
  // Newlines only ever sit between elements in these drawings, never inside a text: dropping them draws the same.
  let body = inner.replace(/>\s*\n\s*</g, '><').trim();
  if (!body.includes('data-layer="print"') || !body.includes('data-layer="brand"')) throw new Error(`${file}: no print or brand layer`);
  body = without(body, /<g data-layer="print"/);
  body = without(body, /<text\b[^>]*\bdisplay="none"/);

  const defsMatch = /<defs>(.*?)<\/defs>/s.exec(body);
  if (!defsMatch) throw new Error(`${file}: no defs`);
  const drawing = body.slice(0, defsMatch.index) + body.slice(defsMatch.index + defsMatch[0].length);
  const brandAt = drawing.indexOf('<g data-layer="brand"');
  const brandEnd = endOf(drawing, brandAt);
  const under = drawing.slice(0, brandAt);
  const brand = drawing.slice(brandAt, brandEnd);
  const over = drawing.slice(brandEnd);

  // Only the definitions the drawing still uses, each once: the print's emboss filters go with the print.
  const definitions = [];
  const seen = new Set();
  for (const element of elements(defsMatch[1])) {
    const id = /^<[a-zA-Z]+\b[^>]*?\bid="([^"]+)"/.exec(element)?.[1];
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    definitions.push({ id, element });
  }
  const used = refsOf(drawing);
  for (let grew = true; grew; ) {
    grew = false;
    for (const { id, element } of definitions) {
      if (!id || !used.has(id)) continue;
      for (const ref of refsOf(element)) if (!used.has(ref)) (used.add(ref), (grew = true));
    }
  }
  const missing = [...used].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`${file}: refers to ${missing.join(', ')}, defined nowhere`);
  const defs = definitions
    .filter(({ id }) => !id || used.has(id))
    .map(({ element }) => element)
    .join('');

  const ink = /<text\b[^>]*?\bfill="(#[0-9a-fA-F]{6})"/.exec(brand)?.[1];
  if (!ink) throw new Error(`${file}: no brand ink`);
  // Numbers are kept as drawn: debit-art's number trimming empties a "0.0" (an opacity of nothing reads as 1), and the
  // chunk is fetched once, gzipped, where those characters cost next to nothing.
  faces[key] = { defs, under, brand, over, ink: inkOf(ink) };
}

// The markup is written between backticks, not JSON-escaped: it is all double quotes, and none of it is a backtick.
const field = ([name, value]) => `${name}: ${typeof value === 'string' && value.includes('"') ? `\`${value}\`` : JSON.stringify(value)}`;
const lines = Object.entries(faces).map(([key, face]) => `  '${key}': { ${Object.entries(face).map(field).join(', ')} },`);
writeFileSync(
  target,
  `// Generated by scripts/programme-art.mjs from docs/card-art/membership — do not edit by hand.
import type { ProgrammeArt } from './programme-art';

export const FACES: Record<string, ProgrammeArt> = {
${lines.join('\n')}
};
`,
);
const total = Object.values(faces).reduce((sum, face) => sum + face.defs.length + face.under.length + face.brand.length + face.over.length, 0);
console.log(`${Object.keys(faces).length} faces, ${Math.round(total / 1024)} KB of art`);
