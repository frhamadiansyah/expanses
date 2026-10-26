-- The full date a card's annual fee is charged on. The next charge is that date rolled on by whole years.
ALTER TABLE card_terms ADD COLUMN annual_fee_on TEXT CHECK (annual_fee_on IS NULL OR annual_fee_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
-- The year of the charge the owner waived (the bank agreed not to charge it), so that year's fee reads as waived.
ALTER TABLE card_terms ADD COLUMN annual_fee_waived_year INTEGER;
