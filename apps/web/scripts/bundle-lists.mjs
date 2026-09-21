// apps/web/scripts/bundle-lists.mjs — the rules check-bundle.mjs applies, kept pure so a test can hold them.

export const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;

/**
 * Each ticker list must sit in exactly one chunk of its own, outside the entry chunk, under its budget. A list with no
 * rows yet (the IDX list, until the exchange's file arrives) is pending: a warning, never a failure — its sentinel is
 * in no chunk because the list is empty, not because it leaked. Its check turns on by itself once rows exist.
 */
export function checkLists({ entry, chunks, lists, rows }) {
  const problems = [];
  const warnings = [];
  const lines = [];
  if (entry.length !== 1) problems.push(`expected one entry chunk in index.html, found ${entry.join(', ') || 'none'}`);
  for (const list of lists) {
    if ((rows[list.name] ?? 0) === 0) {
      warnings.push(`${list.name}: pending — the list has no rows yet, so its check waits for them`);
      continue;
    }
    const holders = chunks.filter((c) => c.text.includes(list.sentinel));
    for (const c of holders) if (entry.includes(c.file)) problems.push(`${list.name} is inside the entry chunk ${c.file}`);
    if (holders.length !== 1) problems.push(`${list.name}: expected in exactly one chunk of its own, found in ${holders.map((c) => c.file).join(', ') || 'none'}`);
    for (const c of holders) {
      lines.push(`${list.name} ${c.file}: ${kb(c.gzipped)} gzipped (budget ${kb(list.budget)})`);
      if (c.gzipped > list.budget) problems.push(`${list.name} is ${kb(c.gzipped)} gzipped, over its ${kb(list.budget)} budget`);
    }
  }
  return { problems, warnings, lines };
}
