# Income categories: three renames + one new (owner-approved 2026-11-16)

Final built-in income list (order as shown):
1. Salary, wage, or pay   (key income.salary — label renamed from "Salary")
2. Bonus and benefits     (key income.bonus — from "Bonus")
3. Investment Income      (unchanged)
4. Realized Gains         (unchanged)
5. Cashback & Rewards     (unchanged)
6. Gifts, awards, and grants (key income.gifts — from "Gifts Received")
7. Side business and selling (NEW, new key e.g. income.side_business)
8. Other Income           (unchanged)

Rules (see memory: renaming a LABEL is safe, renaming a KEY breaks card rules; ensureCategoryKeys adds missing defaults by systemKey but never renames):
- Change labels in packages/core/src/categories/defaults.ts; add the new default (icon/colour in the same family as other income rows).
- Existing workspaces: migration 0117 (check main's latest first) renames the three categories ONLY where system_key matches AND the current name still equals the old default (never overwrite a name the owner changed). The new category reaches existing workspaces through ensureCategoryKeys — verify it does, including shared/Family workspaces, and that the partner's phone gets the same result (both run the same migration; if category names are synced entities, make sure the rename does not create a conflict or a stale value on an older phone — report what an older build shows).
- Keys stay. Nothing else renamed. Transactions keep their category.
- Grep for hard-coded "Salary", "Bonus", "Gifts Received" in app code, tests, e2e helpers, email/SMS capture parsers (capture may map "gaji" → salary by key — keep keys) and update test expectations.
- No "you"/"your". Invented fixtures.
- Tests: migration test (renamed when default, kept when user-renamed, new category present after ensureCategoryKeys), core defaults/catalog tests, db tests touching categories, web vitest categories/transactions, affected e2e (category pickers with "Salary" etc.). tsc core/db/web.
