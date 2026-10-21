-- The last four digits of a bank account's number, as statements, SMS and WhatsApp alerts name it ("rek ****1234").
-- A bank's cards already keep their own digits on cards.last4, so these are the account's, on the account itself.
ALTER TABLE accounts ADD COLUMN number_last4 TEXT CHECK (number_last4 IS NULL OR (length(number_last4) = 4 AND number_last4 GLOB '[0-9][0-9][0-9][0-9]'));
