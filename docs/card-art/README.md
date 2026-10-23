# Card art for Wallet (approved drawings, 23 Oct 2026)

The drawn faces the owner approved for the Wallet stack, kept here until they are moved into the app.

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

`credit-later/` — before/after redraws of eight catalogue credit cards (they keep their network mark and their name
top-right). Not approved yet; the owner will look at them later.
