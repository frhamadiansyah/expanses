-- Issuers cap how much converts in a window, and some pay a reduced ratio past the cap
-- rather than refusing the transfer. Both belong to the partner: Maybank's ceiling runs
-- over a year, everyone else's over a month, and the reduced ratio differs per partner.
ALTER TABLE transfer_partners ADD COLUMN cap_window TEXT CHECK (cap_window IN ('month', 'year'));
ALTER TABLE transfer_partners ADD COLUMN cap_points INTEGER CHECK (cap_points > 0);
ALTER TABLE transfer_partners ADD COLUMN cap_partner_units INTEGER CHECK (cap_partner_units > 0);
ALTER TABLE transfer_partners ADD COLUMN cap_shared INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transfer_partners ADD COLUMN beyond_points INTEGER CHECK (beyond_points > 0);
ALTER TABLE transfer_partners ADD COLUMN beyond_partner_units INTEGER CHECK (beyond_partner_units > 0);
