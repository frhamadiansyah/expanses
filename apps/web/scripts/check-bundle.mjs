// apps/web/scripts/check-bundle.mjs — run by `npm run build`. The ticker lists must never reach the entry chunk.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dir = new URL('../dist/assets/', import.meta.url);
const js = readdirSync(dir).filter((file) => file.endsWith('.js'));
const read = (file) => readFileSync(new URL(file, dir));
const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;
// The entry chunk is the one index.html loads, read from index.html rather than guessed from a file name.
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const entry = [...html.matchAll(/<script\b[^>]*>/g)]
  .map((tag) => tag[0])
  .filter((tag) => tag.includes('type="module"'))
  .map((tag) => /src="[^"]*\/assets\/([^"]+\.js)"/.exec(tag)?.[1])
  .filter(Boolean);
// Sentinels: a name each list carries and no line of the app's own code may contain.
const LISTS = [
  { name: 'IDX list', sentinel: 'Bank Central Asia', budget: 25_000 },
  // 160 KB, not the first 150 KB (the owner's ruling, 2026-09-22): 11,746 ordinary US stocks and ETFs are ~150.2 KB
  // gzipped even after test issues, warrants, rights and units are dropped by the exchanges' flags. The list is never
  // cut below its real stocks and ETFs to fit; the budget moved instead. It still fails a list that doubles.
  { name: 'US list', sentinel: 'Apple Inc', budget: 160_000 },
];
const problems = [];
if (entry.length !== 1) problems.push(`expected one entry chunk in index.html, found ${entry.join(', ') || 'none'}`);
for (const file of entry) console.log(`entry ${file}: ${kb(read(file).length)} (${kb(gzipSync(read(file)).length)} gzipped)`);
for (const list of LISTS) {
  const holders = js.filter((file) => read(file).includes(list.sentinel));
  if (holders.length !== 1) problems.push(`${list.name}: expected in exactly one chunk of its own, found in ${holders.join(', ') || 'none'}`);
  for (const file of holders) {
    if (entry.includes(file)) problems.push(`${list.name} is inside the entry chunk ${file}`);
    const size = gzipSync(read(file)).length;
    console.log(`${list.name} ${file}: ${kb(size)} gzipped (budget ${kb(list.budget)})`);
    if (size > list.budget) problems.push(`${list.name} is ${kb(size)} gzipped, over its ${kb(list.budget)} budget`);
  }
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
