# Card art for Wallet (approved drawings, 23 Oct 2026)

The drawn faces the owner approved for the Wallet stack. They are in the app: `apps/web/scripts/debit-art.mjs` cuts
each drawing in `cards.json` down to its art (no text, chip, mark or digits — `CardFace` prints those) and writes
`apps/web/src/features/cards/debit-art/faces.generated.ts`; which account gets which face, and the card tiers, are in
`debit-art/faces.ts`. Redraw here, then run the script.

- `wallet-card-art.html` — open in a browser: every face, with notes and the Wallet stack.
- `draw_cards.py` — draws them (`python3 draw_cards.py cards.json`); `cards.json` is its output, one SVG per key.
- `build_page.py` — builds the page from `cards.json` (paths inside point at the brainstorm folder it was made in).

Layout, the same for every face and as the app draws a credit card: the bank top-left, nothing top-right, chip and
contactless mark a third of the way down on the left, `•••• last4` and the holder at the bottom-left. No network mark.
Debit cards carry a chip; prepaid e-money cards only the contactless mark (holder line `E-MONEY`); e-wallets and
PayLater neither (`E-WALLET`, `PAYLATER`, a PayLater face shows no number).

Keys in `cards.json`:

- Debit: mandiri (+ gold, plat, mandiriprio), bca (+ bcagold, bcaplat, bcaprio), bsi (+ bsigold, bsiplat), bri, bni,
  btn, panin, sinarmas, muamalat, permata, ocbc, danamon, uob, dbs, jenius, blu, seabank, allo, krom, superbank, neo,
  cimb (+ cimbpref), maybank, jago
- E-wallets: ovo, shopeepay, gopay, dana, linkaja
- Prepaid e-money: emoney (Mandiri), flazz (BCA), brizzi (BRI), tapcash (BNI), jakcard (Bank DKI)
- PayLater: kredivo, akulaku, spaylater, gopaylater
- Credit (catalogue, deal with later): hsbc (Live+)

Logo marks are left out (bank emblems, Visa/Mastercard). Faces that lean on a brand's own shape, drawn at the owner's
request "as similar as you can": jago, dbs, seabank, allo, krom, shopeepay, gopay, dana, bcaprio's gold oval.

## Membership cards (approved 24 Oct 2026)

`membership/` — one finished SVG (340 × 214) per points programme and tier: the source of truth for the faces the
Points page draws. `apps/web/scripts/programme-art.mjs` keeps each drawing's `art` and `brand` layers (the programme's
name and tier word, top-left, final as drawn), drops its `print` layer (the placeholder MEMBER NAME and noughts — the app
keeps no member's name or number) with every definition only the print used, and writes
`apps/web/src/features/cards/programme-art/faces.generated.ts`, a lazy chunk. Which programme gets which card, by its
name, and the tiers each family has, are in `programme-art/programmes.ts`; the tier a programme is drawn at is its Card
tier (migration 0088), chosen in its Settings. Redraw here, then run the script.

- ALL Accor: `accor`, `accor-silver`, `accor-gold`, `accor-platinum` (Classic, Silver, Gold, Platinum)
- ANA Mileage Club: `ana`
- KrisFlyer: `krisflyer`, `krisflyer-silver`, `krisflyer-gold` (KrisFlyer, Elite Silver, Elite Gold)
- Asia Miles: `asiamiles`, `asiamiles-silver`, `asiamiles-gold`, `asiamiles-diamond` (Green, Silver, Gold, Diamond)
- Marriott Bonvoy: `bonvoy`, `bonvoy-silver`, `-gold`, `-platinum`, `-titanium`, `-ambassador` (Member to Ambassador Elite)
- GarudaMiles: `garudamiles`, `garudamiles-silver`, `-gold`, `-platinum` (Blue, Silver, Gold, Platinum)
- JAL Mileage Bank: `jmb`, `jmb-crystal`, `jmb-sapphire`, `jmb-diamond`
- Qatar Privilege Club: `privilegeclub`, `privilegeclub-silver`, `-gold`, `-platinum` (Burgundy, Silver, Gold, Platinum)

`credit-later/` — before/after redraws of eight catalogue credit cards (they keep their network mark and their name
top-right). Not approved yet; the owner will look at them later.
