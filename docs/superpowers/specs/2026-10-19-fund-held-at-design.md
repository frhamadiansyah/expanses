# Mutual funds: where they are held

Status: agreed in outline with the owner on 2026-10-19; not planned or built. To follow the add-asset redesign
(`feat/asset-form`).

## Why

A mutual fund (reksadana) is bought through somewhere: a securities broker (Mandiri Sekuritas), a bank (Bank Mandiri)
or a fund platform (Bibit). Today a fund holding cannot say where. The owner also holds **the same fund at two places
at once**, and each place has its own units, purchases and account, while the fund's price (NAV) is one figure.

Listed shares already work this way: one holding per broker, grouped under the share (`securities` +
`holding_links.broker_account_id`, the "Held at broker" list on a broker's page). Funds should follow the same shape
rather than a second one.

## Goals

- A fund holding says where it is held: one of the owner's accounts (broker cash, bank, platform), or a typed name for a
  place with no account in the app.
- The same fund at two places is two holdings grouped under one fund: a total, and each place below it.
- NAV is entered (or later fetched) once per fund and values every holding of it.
- Where it is held fills the tax report's **Nama institusi** for that holding.
- Buy/Sell on a holding pays from, and into, the account it is held at by default.

## Non-goals

- Fetching NAVs from any site. Prices stay typed until an open source is found (see the "commercial, no scraping" rule).
- Changing how listed shares work.
- Moving units between places (a transfer between platforms). If needed, a sell at one and a buy at the other.

## Anti-goals

- Units, cost or purchases mixed across places. Selling at Bibit must never touch the Mandiri units.
- Typing the same NAV twice for one fund.

## Shape (as agreed)

```
Assets › Investments
│ Sucorinvest Equity Fund        Rp 48.200.000 │  ← the fund, total of its holdings
│   Mandiri Sekuritas    1.200 units  Rp 30,1jt │
│   Bibit                  720 units  Rp 18,1jt │
```

On the fund's add form and its Edit screen:

```
│ Name                        Required   │
│ Held at          Mandiri Sekuritas  ›  │  ← one of your accounts, or a name typed in
```

- **Held at, an account:** stored as the holding's existing `holding_links.broker_account_id`. The holding then appears on
  that account's page, and Buy/Sell default to it. Nama institusi is filled from the account (still editable).
- **Held at, a typed name:** no link; the name goes to Nama institusi only.
- **Adding a fund already held:** the add flow offers the existing fund and asks only the new place, as the ticker flow
  does for a share already held at another broker.
- **Tax report:** one row per holding (per place), each with its own Nama institusi and account number. The owner's
  understanding; to be checked against a real SPT before building.
- **Also:** government bonds / ORI held at a bank have the same question and should take the same Held at row.

## Known facts about the code today

- `securities.kind` allows `share | etf | other`. A fund needs a kind of its own (`fund`) or uses `other`; a new kind
  is a CHECK change, i.e. a table rebuild.
- Fund prices live per holding account in `prices` (`account_id`). A shared NAV means a fund's price lives on its
  security (as `security_prices` does for shares), and existing per-account fund prices are carried over.
- `FundTradeSheet` buys and sells by amount at the last NAV and already asks which account the money comes from.

## Left to the builder / open

- Whether a fund gets its own security kind or `other`, and the migration for it (next free number after 0074).
- How existing fund holdings are moved onto a security: one security per existing holding, merged only when the owner
  says two are the same fund.
- Which account kinds the Held at list offers (broker cash, bank, e-wallet/platform), and the order.
- Builder check not yet run on this document.
