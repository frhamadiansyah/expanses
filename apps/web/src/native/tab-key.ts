/**
 * Tab and ⇧Tab in the Mac app.
 *
 * The Mac app's web view (WKWebView under Mac Catalyst) hands a Tab key press to the page like any browser — a
 * `keydown` with `key: 'Tab'` reaches the focused field and the page's own handlers — but then does nothing with it:
 * focus stays in the field. Only ⌥Tab moves it (seen in a Debug Mac build, 24 Nov 2026: Tab and ⇧Tab arrive, nothing
 * prevents them, and the Date cell keeps focus; ⌥Tab goes on to the Note cell). So on the Mac the page moves focus
 * itself: once a plain Tab or ⇧Tab has been through every handler and none of them took it (`defaultPrevented`), the
 * next or previous field in the browser's own Tab order takes focus, and the key is marked as handled so the web view
 * cannot also act on it.
 *
 * Installed only in the Mac app (`main.tsx`). In a browser and on the iPhone, Tab is left to the web view, which moves
 * focus already. The order is a browser's sequential focus order: positive `tabindex` first, then the rest in page
 * order; disabled, hidden, inert and `tabindex="-1"` elements left out; one stop per radio group. Past the last field
 * it goes round to the first.
 *
 * Not reached from here: a date field (`type="date"`). Focused on the Mac, it opens the web view's own date picker
 * (WKDatePickerPopoverController), which takes the keyboard — a Tab there never reaches the page, as with a click.
 */

/** One place Tab can stop: a node and its `tabIndex`, listed in page order. */
export interface TabStop<T> {
  node: T;
  tabIndex: number;
}

/**
 * The stop Tab (or ⇧Tab, `backward`) goes to from `current`, in a browser's order: stops with a positive `tabIndex`
 * first, ascending (page order among equals), then those at 0 in page order, going round past either end. `current`
 * may be listed with a negative `tabIndex` (a `tabindex="-1"` element that has focus): it then counts from its place
 * in the page, as a browser does. `usable` is asked only of the stops on the way, so the page's whole list is not
 * measured on every press. Null when there is nowhere to go.
 */
export function nextTabStop<T>(stops: readonly TabStop<T>[], current: T | null, backward: boolean, usable: (node: T) => boolean = () => true): T | null {
  const at = current === null ? -1 : stops.findIndex((stop) => stop.node === current);
  const order = stops
    .map((stop, index) => ({ ...stop, index }))
    .filter((stop) => stop.tabIndex >= 0 || stop.index === at)
    .sort((a, b) => rank(a.tabIndex) - rank(b.tabIndex) || a.index - b.index);
  const here = order.findIndex((stop) => stop.index === at);
  const step = backward ? -1 : 1;
  // From nowhere, the first stop (⇧Tab: the last) is the first one tried.
  const start = here === -1 ? (backward ? order.length : -1) : here;
  for (let i = 1; i <= order.length; i++) {
    const stop = order[(((start + step * i) % order.length) + order.length) % order.length]!;
    if (stop.index !== at && stop.tabIndex >= 0 && usable(stop.node)) return stop.node;
  }
  return null;
}

/** A positive tabindex comes before the 0s; a focused -1 sits among the 0s, where its place in the page puts it. */
const rank = (tabIndex: number) => (tabIndex > 0 ? tabIndex : Number.MAX_SAFE_INTEGER);

/** The key press this file moves focus for: Tab or ⇧Tab alone, not while an input method is composing. */
export function isPlainTab(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'defaultPrevented'>): boolean {
  return event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && !event.defaultPrevented;
}

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Text-like inputs: a browser selects what they hold when Tab lands in them. */
const SELECTS_ON_TAB = new Set(['text', 'search', 'tel', 'url', 'email', 'password', 'number']);

function canStop(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if (element.matches(':disabled')) return false;
  if (element instanceof HTMLInputElement && element.type === 'hidden') return false;
  if (element.closest('[inert]')) return false;
  if (typeof element.checkVisibility === 'function') {
    if (!element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true } as CheckVisibilityOptions)) return false;
  } else if (element.getClientRects().length === 0) return false;
  if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
    // One stop per group: the checked one, or the first when none is.
    const group = [...(element.form ?? element.ownerDocument).querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
      (radio) => radio.name === element.name && radio.form === element.form,
    );
    const checked = group.find((radio) => radio.checked);
    return checked ? checked === element : group[0] === element;
  }
  return true;
}

/**
 * Every element Tab might stop at, in page order, with its `tabIndex`; the focused element among them even where Tab
 * itself would not stop (with -1 then), so the next stop is counted from where it sits.
 */
function tabStops(doc: Document, active: Element | null): TabStop<HTMLElement>[] {
  const stops: TabStop<HTMLElement>[] = [];
  let placed = false;
  for (const element of doc.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (element === active) placed = true;
    stops.push({ node: element, tabIndex: element === active && !canStop(element) ? -1 : element.tabIndex });
  }
  if (!placed && active instanceof HTMLElement && active !== doc.body && active !== doc.documentElement) {
    const after = stops.findIndex((stop) => active.compareDocumentPosition(stop.node) & Node.DOCUMENT_POSITION_FOLLOWING);
    stops.splice(after === -1 ? stops.length : after, 0, { node: active, tabIndex: -1 });
  }
  return stops;
}

/** Moves focus for one key press, as a browser would; true when it did (the key is then marked as handled). */
export function moveFocusForTab(event: KeyboardEvent, doc: Document = document): boolean {
  if (!isPlainTab(event)) return false;
  const active = doc.activeElement;
  const next = nextTabStop(tabStops(doc, active), active instanceof HTMLElement ? active : null, event.shiftKey, canStop);
  if (!next) return false;
  event.preventDefault();
  next.focus();
  if (next instanceof HTMLInputElement && SELECTS_ON_TAB.has(next.type)) next.select();
  return true;
}

/**
 * Listens at the window, after every handler of the page has had the key (React's listen on its root, inside the
 * window): what a cell or a list already did with Tab — moved focus itself, taken a choice and left the move to the
 * browser — stands. Returns the way to stop listening.
 */
export function installTabKey(win: Window = window): () => void {
  const listener = (event: KeyboardEvent) => {
    moveFocusForTab(event, win.document);
  };
  win.addEventListener('keydown', listener);
  return () => win.removeEventListener('keydown', listener);
}
