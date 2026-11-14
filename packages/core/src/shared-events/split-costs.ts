import type { SplitInput } from './split';

/*
 * Split costs, a shared trip's switch (owner, 14 Nov 2026). Off is "one pot": a couple's trip paid from one purse, where
 * nobody owes anybody. Spending recorded while it is off puts the whole amount on its payer — paid and share alike — so
 * every balance stays at zero and the event's arithmetic (`sharesOf`, `balances`) needs no second case. A split already
 * recorded is never rewritten by the switch: off hides it, on shows it again.
 */

/** The split of spending recorded with Split costs off: the payer alone, the whole of it. */
export function onePotSplit(payerPersonId: string): SplitInput {
  return { mode: 'equal', people: [payerPersonId] };
}

/** Whether a split is the payer's alone (one pot): nobody else's share in it. */
export function isOnePotSplit(split: SplitInput, payerPersonId: string): boolean {
  const people = split.mode === 'equal' ? split.people : split.shares.filter((s) => s.minor !== 0).map((s) => s.personId);
  return people.length === 1 && people[0] === payerPersonId;
}

/**
 * Split costs when an event is shared: off when the only others are the household (the partner) — a household with no
 * names without the app beside it, or names that are all the household's — and on when anyone else is named, or when
 * there is no household to share it with. Names match without case or outer spaces.
 */
export function defaultSplitCosts(input: { names: readonly string[]; household: readonly string[] }): boolean {
  const household = new Set(input.household.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (household.size === 0) return true;
  return input.names.map((name) => name.trim().toLowerCase()).filter(Boolean).some((name) => !household.has(name));
}
