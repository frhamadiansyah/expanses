import { describe, expect, it } from 'vitest';
import { buildRowOptions } from './QuickRowEditor';

// The page builds the row's choices while its queries are still loading, from empty lists. A cell typed into then
// finds nothing, and Enter drops what was typed without a word. The options say so, so the cells can wait.
describe('buildRowOptions readiness', () => {
  it('is ready by default', () => {
    expect(buildRowOptions([], []).ready).toBe(true);
  });

  it('says it is not ready while the page is still loading what it is built from', () => {
    expect(buildRowOptions([], [], () => true, {}, false).ready).toBe(false);
  });
});
