import { MCC_NAMES } from '@expanses/core';

const ENTRIES = Object.entries(MCC_NAMES).map(([code, name]) => ({ code, name, text: name.toLowerCase() }));

/** MCCs whose code starts with the typed digits, or whose name contains every typed word. */
export function searchMccs(query: string, limit = 20): { code: string; name: string }[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const words = text.split(/\s+/);
  const matches = /^\d+$/.test(text) ? ENTRIES.filter((entry) => entry.code.startsWith(text)) : ENTRIES.filter((entry) => words.every((word) => entry.text.includes(word)));
  return matches.slice(0, limit).map(({ code, name }) => ({ code, name }));
}

/** A merchant pattern suggested from a purchase description: its first words, without store numbers or separators. */
export function suggestPattern(description: string): string {
  return description
    .toLowerCase()
    .replace(/[*_/\\|#]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !/\d/.test(word))
    .slice(0, 3)
    .join(' ')
    .trim();
}
