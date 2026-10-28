-- "Value per point" of a points programme: what one point (mile) is worth, in the workspace's base currency, so a
-- balance can show "≈ money" without going through a card's redemption options.
--
-- A single point is often worth less than one minor unit (Rp 0,5; $0.0125), so the figure is a scaled integer: minor
-- units times 10 000 per point. Rp 110 per point is 1 100 000; Rp 0,5 is 5 000. Null, the default, means none is set,
-- and the app then falls back to the best redemption option of the card earning here, as it did before this column.
--
-- Read and written by name, never through the drizzle table, as 0088's tier is: a database stopped before this column
-- reads and writes programmes as it did. point_programmes does not travel between devices, so neither does this.
ALTER TABLE point_programmes ADD COLUMN value_per_point_e4 INTEGER;
