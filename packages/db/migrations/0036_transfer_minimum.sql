-- A first transfer can be larger than the step the partner moves in afterwards: Mandiri takes
-- 10.000 Livin'poin to open a conversion and 1.000 at a time after that. The step alone cannot
-- say this, since it would round every balance down to a multiple of 10.000.
ALTER TABLE transfer_partners ADD COLUMN minimum_points INTEGER CHECK (minimum_points > 0);
