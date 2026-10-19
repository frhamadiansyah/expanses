-- A sell from a holding tracked by money (a mutual fund) keeps the money it took out, fixed when it was saved, so an
-- earlier entry changed later never rewrites a profit already booked (spec 2026-10-19-fund-by-amount). Null for every
-- sell tracked by units, whose cost is still the average cost of the units it sold.
ALTER TABLE investment_trades ADD COLUMN basis_minor INTEGER CHECK (basis_minor IS NULL OR basis_minor >= 0);
