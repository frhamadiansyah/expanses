const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Case-insensitive keyword or phrase match that must not touch letters or digits on either side. */
export function containsKeyword(description: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  const haystack = description.toLowerCase();
  let from = 0;
  let i: number;
  while ((i = haystack.indexOf(needle, from)) >= 0) {
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[i + needle.length])) return true;
    from = i + 1;
  }
  return false;
}
