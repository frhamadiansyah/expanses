/**
 * What a waiting row still needs, in the words its hover and a screen reader say: "date & a payment method". The
 * keys stay as `draftNeeds` and `readQuick` push them ('paid with' among them); only the words read change.
 */
const WORDS: Readonly<Record<string, string>> = { 'paid with': 'a payment method' };

export function needWords(needs: readonly string[]): string {
  return needs.map((need) => WORDS[need] ?? need).join(' & ');
}
