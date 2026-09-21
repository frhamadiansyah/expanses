// apps/web/scripts/check-bundle.mjs — run by `npm run build`. The ticker lists must never reach the entry chunk.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { checkLists, kb } from './bundle-lists.mjs';

const dir = new URL('../dist/assets/', import.meta.url);
const js = readdirSync(dir).filter((file) => file.endsWith('.js'));
const read = (file) => readFileSync(new URL(file, dir));
// The entry chunk is the one index.html loads, read from index.html rather than guessed from a file name.
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const entry = [...html.matchAll(/<script\b[^>]*>/g)]
  .map((tag) => tag[0])
  .filter((tag) => tag.includes('type="module"'))
  .map((tag) => /src="[^"]*\/assets\/([^"]+\.js)"/.exec(tag)?.[1])
  .filter(Boolean);
// Sentinels: a name each list carries and no line of the app's own code may contain.
const LISTS = [
  { name: 'IDX list', sentinel: 'Bank Central Asia', budget: 25_000, file: 'idx.json' },
  // 160 KB, not the first 150 KB (the owner's ruling, 2026-09-22): 11,746 ordinary US stocks and ETFs are ~150.2 KB
  // gzipped even after test issues, warrants, rights and units are dropped by the exchanges' flags. The list is never
  // cut below its real stocks and ETFs to fit; the budget moved instead. It still fails a list that doubles.
  { name: 'US list', sentinel: 'Apple Inc', budget: 160_000, file: 'us.json' },
];
const listDir = new URL('../../../packages/catalog/securities/', import.meta.url);
const rows = Object.fromEntries(LISTS.map((l) => [l.name, JSON.parse(readFileSync(new URL(l.file, listDir), 'utf8')).rows.length]));
for (const file of entry) console.log(`entry ${file}: ${kb(read(file).length)} (${kb(gzipSync(read(file)).length)} gzipped)`);
const chunks = js.map((file) => {
  const bytes = read(file);
  return { file, text: bytes.toString('utf8'), gzipped: gzipSync(bytes).length };
});
const { problems, warnings, lines } = checkLists({ entry, chunks, lists: LISTS, rows });
for (const line of lines) console.log(line);
for (const warning of warnings) console.warn(`warning: ${warning}`);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
