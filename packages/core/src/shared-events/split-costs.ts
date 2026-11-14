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
 * Split costs when an event is shared, before anyone touches the Share sheet's switch: off (one pot) only on the
 * household's own way in — "Shared with <partner>", the household's share list — and on everywhere else. Who joins by an
 * invite is not known when it is shared, and anyone with the app may: one pot is never started for them unasked.
 */
export function defaultSplitCosts(input: { householdShare: boolean }): boolean {
  return !input.householdShare;
}
