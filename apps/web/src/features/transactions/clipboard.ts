/*
 * The right-click menu's Copy and Paste (owner 2026-11-25): what ⌘C and ⌘V do, from a menu line. The Mac app's web
 * view copies what is selected — the blue cells' hidden box holds their words, selected — so Copy asks for the
 * browser's own copy when the clipboard cannot be written to; Paste reads the clipboard when it may (the web view may
 * ask first), and does nothing when it may not: ⌘V still pastes.
 */

export function copyToClipboard(text: string) {
  if (!text) return;
  const fallback = () => {
    try {
      document.execCommand('copy');
    } catch {
      // Nothing more to try: ⌘C still copies.
    }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
}

export async function pasteFromClipboard(paste: (text: string) => void) {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text) paste(text);
  } catch {
    // Not allowed here: ⌘V pastes.
  }
}
