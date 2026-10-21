-- The default sets' categories (Holiday, Newborn, Renovation) were made with no icon, and a set's category has no key
-- to borrow one from, so each drew the unknown mark. Each takes its icon by name — only where none was ever chosen,
-- and only for a top-level category that belongs to a set, so a category the owner named the same way elsewhere is
-- left alone.
UPDATE accounts
SET icon = CASE name
  WHEN 'Flights' THEN 'plane'
  WHEN 'Lodging' THEN 'bed'
  WHEN 'Activities' THEN 'map-pin'
  WHEN 'Transport' THEN 'train-front'
  WHEN 'Meals' THEN 'utensils'
  WHEN 'Shopping' THEN 'shopping-bag'
  WHEN 'Souvenirs' THEN 'gift'
  WHEN 'Miscellaneous' THEN 'circle-ellipsis'
  WHEN 'Business H' THEN 'briefcase'
  WHEN 'Intercity' THEN 'bus'
  WHEN 'Photo' THEN 'camera'
  WHEN 'Postpartum' THEN 'heart-pulse'
  WHEN 'Sleeping' THEN 'bed'
  WHEN 'Feeding' THEN 'milk'
  WHEN 'Diapering' THEN 'baby'
  WHEN 'Bathing' THEN 'bath'
  WHEN 'Clothing' THEN 'shirt'
  WHEN 'Medical' THEN 'stethoscope'
  WHEN 'Weaning' THEN 'apple'
  WHEN 'Travelling' THEN 'car'
  WHEN 'Playing' THEN 'blocks'
  WHEN 'Vaccination' THEN 'syringe'
  WHEN 'Design & Planning' THEN 'notebook-pen'
  WHEN 'Structural Construction' THEN 'hard-hat'
  WHEN 'Cabinetry & Hardware' THEN 'hammer'
  WHEN 'Home Appliances' THEN 'microwave'
  WHEN 'Installation & Labor' THEN 'wrench'
  WHEN 'Plumbing Fixtures' THEN 'shower-head'
  WHEN 'Flooring & Tiles' THEN 'paint-bucket'
  WHEN 'Lighting & Sockets' THEN 'lightbulb'
  WHEN 'Landscape' THEN 'plant-pot'
END
WHERE icon IS NULL
  AND kind = 'expense'
  AND parent_id IS NULL
  AND id IN (SELECT category_account_id FROM category_set_members)
  AND name IN ('Flights', 'Lodging', 'Activities', 'Transport', 'Meals', 'Shopping', 'Souvenirs', 'Miscellaneous', 'Business H', 'Intercity', 'Photo', 'Postpartum', 'Sleeping', 'Feeding', 'Diapering', 'Bathing', 'Clothing', 'Medical', 'Weaning', 'Travelling', 'Playing', 'Vaccination', 'Design & Planning', 'Structural Construction', 'Cabinetry & Hardware', 'Home Appliances', 'Installation & Labor', 'Plumbing Fixtures', 'Flooring & Tiles', 'Lighting & Sockets', 'Landscape');
