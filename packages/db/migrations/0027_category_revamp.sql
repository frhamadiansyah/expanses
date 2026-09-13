/*
 * The category revamp. Every key is derived from its node, so a key no longer contradicts where the
 * category sits. Renaming and re-parenting keep each account id, so budgets, recurring bills, event
 * plans and every posted transaction stay attached to the category they always pointed at.
 *
 * Travel and Business keep their old keys: they leave the monthly tree only when category sets
 * arrive, and card rules name them today.
 */
CREATE TEMP TABLE category_revamp (new_key TEXT NOT NULL, name TEXT NOT NULL, parent_key TEXT, old_key TEXT, sort INTEGER NOT NULL);

INSERT INTO category_revamp (new_key, name, parent_key, old_key, sort) VALUES
  ('utilities', 'Utilities', NULL, 'utilities', 0),
  ('utilities.electricity', 'Electricity', 'utilities', 'utilities.electricity', 1),
  ('utilities.internet_provider', 'Internet provider', 'utilities', 'utilities.internet_phone', 2),
  ('utilities.mobile_phone', 'Mobile phone', 'utilities', NULL, 3),
  ('utilities.water_sanitation', 'Water & sanitation', 'utilities', 'utilities.water', 4),
  ('utilities.sewer_waste', 'Sewer & waste', 'utilities', NULL, 5),
  ('utilities.gas_energy', 'Gas & energy', 'utilities', 'utilities.gas', 6),
  ('household', 'Household', NULL, NULL, 7),
  ('household.groceries', 'Groceries', 'household', 'food.groceries', 8),
  ('household.supplies', 'Supplies', 'household', 'shopping.household', 9),
  ('food_beverage', 'Food and beverage', NULL, 'food', 10),
  ('food_beverage.takeaways', 'Takeaways', 'food_beverage', NULL, 11),
  ('food_beverage.restaurants', 'Restaurants', 'food_beverage', 'food.dining', 12),
  ('food_beverage.cafe_dessert', 'Cafe & dessert', 'food_beverage', 'food.coffee', 13),
  ('food_beverage.home_catering', 'Home catering', 'food_beverage', NULL, 14),
  ('food_beverage.school_catering', 'School catering', 'food_beverage', NULL, 15),
  ('transportation', 'Transportation', NULL, 'transport', 16),
  ('transportation.vehicle_maintenance', 'Vehicle maintenance', 'transportation', NULL, 17),
  ('transportation.fuel_cost', 'Fuel cost', 'transportation', 'transport.fuel', 18),
  ('transportation.parking_tolls', 'Parking & tolls', 'transportation', 'transport.parking_tolls', 19),
  ('transportation.ride_hailing', 'Ride hailing', 'transportation', 'transport.ride_hailing', 20),
  ('transportation.public_transport', 'Public transport', 'transportation', 'transport.public', 21),
  ('transportation.auto_repair', 'Auto repair', 'transportation', NULL, 22),
  ('property', 'Property', NULL, 'housing', 23),
  ('property.housing_rent', 'Housing rent', 'property', 'housing.rent', 24),
  ('property.house_maintenance', 'House maintenance', 'property', 'housing.maintenance', 25),
  ('property.community_security', 'Community & security', 'property', NULL, 26),
  ('property.home_services', 'Home services', 'property', NULL, 27),
  ('property.decor_furnishings', 'Decor & furnishings', 'property', NULL, 28),
  ('property.repair_improvements', 'Repair & improvements', 'property', NULL, 29),
  ('property.real_estate', 'Real estate', 'property', 'housing.real_estate', 30),
  ('health_care', 'Health care', NULL, 'health', 31),
  ('health_care.supplements', 'Supplements', 'health_care', NULL, 32),
  ('health_care.outpatient_care', 'Outpatient care', 'health_care', 'health.medical', 33),
  ('health_care.pharmacy', 'Pharmacy', 'health_care', 'health.pharmacy', 34),
  ('health_care.vision_dental_care', 'Vision & dental care', 'health_care', NULL, 35),
  ('health_care.accident_emergency', 'Accident & emergency', 'health_care', NULL, 36),
  ('health_care.general_check_up', 'General check-up', 'health_care', NULL, 37),
  ('protection', 'Protection', NULL, NULL, 38),
  ('protection.health_insurance', 'Health insurance', 'protection', 'health.insurance', 39),
  ('protection.life_insurance', 'Life insurance', 'protection', NULL, 40),
  ('protection.critical_insurance', 'Critical insurance', 'protection', NULL, 41),
  ('protection.auto_insurance', 'Auto insurance', 'protection', NULL, 42),
  ('education', 'Education', NULL, 'education', 43),
  ('education.administration', 'Administration', 'education', NULL, 44),
  ('education.tuition_fees', 'Tuition fees', 'education', 'education.courses', 45),
  ('education.parent_association', 'Parent association', 'education', NULL, 46),
  ('education.after_school_club', 'After school club', 'education', NULL, 47),
  ('education.field_trip_activities', 'Field trip activities', 'education', NULL, 48),
  ('education.performances', 'Performances', 'education', NULL, 49),
  ('education.shuttle_bus', 'Shuttle bus', 'education', NULL, 50),
  ('education.text_books_supplies', 'Text books & supplies', 'education', 'education.books', 51),
  ('education.courses_lessons', 'Courses/lessons', 'education', NULL, 52),
  ('education.pocket_money', 'Pocket money', 'education', NULL, 53),
  ('personal_care', 'Personal care', NULL, 'personal_care', 54),
  ('personal_care.self_development', 'Self development', 'personal_care', NULL, 55),
  ('personal_care.grooming_haircuts', 'Grooming & haircuts', 'personal_care', NULL, 56),
  ('personal_care.sports_fitness', 'Sports & fitness', 'personal_care', 'entertainment.sports', 57),
  ('personal_care.spa_wellness', 'Spa & wellness', 'personal_care', NULL, 58),
  ('personal_care.dry_clean_laundry', 'Dry clean & laundry', 'personal_care', NULL, 59),
  ('personal_care.counselling_therapy', 'Counselling & therapy', 'personal_care', NULL, 60),
  ('entertainment', 'Entertainment', NULL, 'entertainment', 61),
  ('entertainment.subscriptions', 'Subscriptions', 'entertainment', 'utilities.subscriptions', 62),
  ('entertainment.movies', 'Movies', 'entertainment', 'entertainment.events', 63),
  ('entertainment.recreation', 'Recreation', 'entertainment', NULL, 64),
  ('entertainment.games', 'Games', 'entertainment', 'entertainment.games', 65),
  ('entertainment.concert_events', 'Concert & events', 'entertainment', NULL, 66),
  ('entertainment.craft_hobbies', 'Craft & hobbies', 'entertainment', 'entertainment.hobbies', 67),
  ('shopping', 'Shopping', NULL, 'shopping', 68),
  ('shopping.clothing', 'Clothing', 'shopping', 'shopping.clothing', 69),
  ('shopping.electronics', 'Electronics', 'shopping', 'shopping.electronics', 70),
  ('shopping.toys', 'Toys', 'shopping', NULL, 71),
  ('shopping.books', 'Books', 'shopping', NULL, 72),
  ('donation', 'Donation', NULL, NULL, 73),
  ('donation.obligation', 'Obligation', 'donation', NULL, 74),
  ('donation.dependant', 'Dependant', 'donation', NULL, 75),
  ('donation.charity', 'Charity', 'donation', 'gifts_donations.donations', 76),
  ('gift_giving', 'Gift giving', NULL, 'gifts_donations.gifts', 77),
  ('gift_giving.birthday', 'Birthday', 'gift_giving', NULL, 78),
  ('gift_giving.relatives', 'Relatives', 'gift_giving', NULL, 79),
  ('gift_giving.wedding', 'Wedding', 'gift_giving', NULL, 80),
  ('gift_giving.newborn', 'Newborn', 'gift_giving', NULL, 81),
  ('gift_giving.funeral', 'Funeral', 'gift_giving', NULL, 82),
  ('gift_giving.celebration', 'Celebration', 'gift_giving', NULL, 83),
  ('government_taxes', 'Government & taxes', NULL, 'government', 84),
  ('government_taxes.estimated_tax', 'Estimated tax', 'government_taxes', 'government.final_tax', 85),
  ('government_taxes.land_building_tax', 'Land & building tax', 'government_taxes', NULL, 86),
  ('government_taxes.motor_vehicle_tax', 'Motor vehicle tax', 'government_taxes', NULL, 87),
  ('miscellaneous', 'Miscellaneous', NULL, 'other_expense', 88),
  ('miscellaneous.postal_service', 'Postal service', 'miscellaneous', NULL, 89),
  ('miscellaneous.professional_fee', 'Professional fee', 'miscellaneous', NULL, 90),
  ('miscellaneous.fine_penalty', 'Fine/penalty', 'miscellaneous', NULL, 91),
  ('miscellaneous.documentation', 'Documentation', 'miscellaneous', NULL, 92),
  ('miscellaneous.interest', 'Interest', 'miscellaneous', 'fees.interest', 93),
  ('miscellaneous.fees_charges', 'Fees & charges', 'miscellaneous', 'fees', 94),
  ('miscellaneous.membership_fee', 'Membership fee', 'miscellaneous', 'fees.card_annual', 95);

/* 1. Carry each key a workspace already holds to its new spelling. */
UPDATE accounts
   SET system_key = (SELECT r.new_key FROM category_revamp r WHERE r.old_key = accounts.system_key)
 WHERE subtype = 'category'
   AND system_key IN (SELECT old_key FROM category_revamp WHERE old_key IS NOT NULL);

/* 2. Create whatever the workspace does not have yet, once per workspace. */
INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
SELECT lower(hex(randomblob(16))), w.id, NULL, 'expense', 'category', r.name, NULL, NULL, 'derived', r.new_key, r.sort, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM category_revamp r
  CROSS JOIN workspaces w
 WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.workspace_id = w.id AND a.system_key = r.new_key);

/* 3. Put every category under the parent the new tree gives it. */
UPDATE accounts
   SET parent_id = (
         SELECT p.id
           FROM accounts p
           JOIN category_revamp r ON r.new_key = accounts.system_key
          WHERE p.workspace_id = accounts.workspace_id
            AND p.system_key = r.parent_key
       )
 WHERE subtype = 'category'
   AND system_key IN (SELECT new_key FROM category_revamp WHERE parent_key IS NOT NULL);

UPDATE accounts
   SET parent_id = NULL
 WHERE subtype = 'category'
   AND system_key IN (SELECT new_key FROM category_revamp WHERE parent_key IS NULL);

/* 4. The names and the order the owner designed. */
UPDATE accounts
   SET name = (SELECT r.name FROM category_revamp r WHERE r.new_key = accounts.system_key),
       sort_order = (SELECT r.sort FROM category_revamp r WHERE r.new_key = accounts.system_key)
 WHERE subtype = 'category'
   AND system_key IN (SELECT new_key FROM category_revamp);

DROP TABLE category_revamp;
