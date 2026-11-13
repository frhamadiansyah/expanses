# Household sharing, simplified — brief (owner-approved 2026-11-13)

Mockup: `docs/mockups/2026-11-13-sharing-simplified.html` (sections 1–3, D in section 5, ①a + ② + ③ in section 6). Read it first, and render it.

## Owner's rulings
- Two ideas only. **Shared** (one switch; off = Private): the partner sees it — an account/asset/debt's balance in household Net worth, a goal saved for together, an event planned together. **Owned together** (Joint), accounts and cards only, only when Shared is on: the partner also sees its rows and can pay from it / add to it.
- Joint is shown as **D: a small two-person mark (👥) on the account's icon** — no "Joint" pill/badge anywhere in the list.
- On the "Shared with Andi" list, Joint is changed by **tapping a shared account's icon** (①a): toggles the mark, a short Undo bar confirms ("BCA 0917 owned together 👥 · Undo"). No sheet (the Shared switch must never be repeated). Turning Joint OFF asks first (③ copy). Tapping the icon of a non-shared account does nothing (or a one-line hint).
- In an account's/card's Settings: "Shared with <name>" switch, then "Owned together 👥 · <name> also sees its rows and can pay from it" switch, shown only when Shared is on. Turning Shared off turns Owned together off too (one confirm).
- Goals and events: only the "Shared with <name>" switch.

## Setup (3 steps instead of two flows)
1. Family › Share: Name + "Create invite". Lede: "Budgets, bills and transactions in Family will be shared. Accounts, goals and events stay private until switched on in step 3."
2. Invite: code, Send, Copy (as today).
3. When the partner joins: **"Shared with <name>"** — Accounts & cards, Goals, Events in ONE list, plus "Assets & debts (n) ›". Later / Done.
- The separate Net worth setup (tax-filing question, Invite, partner's Confirm/Review) goes away from this path: sharing the first account starts the net-worth group by itself. The tax-filing question moves to the tax report (Coretax) where it matters; default for a new group = filed separately. Existing groups keep their mode. Don't break One tax ID households (locked "Shared" rows keep working).
- Partner's phone: no extra review step for net worth.

## After setup
- Family › Share: Members · "Shared with <name> · N items ›" · "Invite someone" · "Stop sharing Family". Nothing else.
- Every place that switches sharing today (AssetSettingsPage, CardSettingsPage, loans/debts pages, add forms, NetWorthItemsPage, GoalForm, EventSettingsPage, Share page Events rows, ShareListPage) uses the same words and the same two switches; remove duplicates.

## Scope limits (this drop)
- Events: keep today's event-sharing mechanism (its own invite code / Share-Leave). The list shows a switch; turning it on runs today's share path. "Shared event through Family without a code" is NOT in this drop (owner may ask later).
- No change to what syncs or how; reuse existing share actions (`ShareWithHousehold`, share-list.ts, goal-sharing, net-worth-sharing). If a step needs a sync/data change, stop and report.
- No "you"/"your" in UI copy. Invented fixtures only.

## Tests
Web unit for share-list model (one list incl. goals, Owned together only when Shared, off-confirm, Shared off clears Joint), e2e for setup steps 1–3 and the icon tap + Undo (phone and desktop), update existing sharing e2e (sharing.spec.ts, phone-share-list) to the new words. tsc core/db/web; vitest web sharing/networth/goals/events; db tests if any repo changes. Two-phone check that partner sees the same as before for the same choices.
