export interface DefaultCategoryChild {
  key: string;
  name: string;
}

export interface DefaultCategory {
  /** Stable identifier catalogue rules reference; never shown to users. */
  key: string;
  name: string;
  kind: 'expense' | 'income';
  children?: DefaultCategoryChild[];
}

const children = (parent: string, list: [key: string, name: string][]): DefaultCategoryChild[] =>
  list.map(([key, name]) => ({ key: `${parent}.${key}`, name }));

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { kind: 'expense', key: 'utilities', name: 'Utilities', children: children('utilities', [['electricity', 'Electricity'], ['internet_provider', 'Internet provider'], ['mobile_phone', 'Mobile phone'], ['water_sanitation', 'Water & sanitation'], ['sewer_waste', 'Sewer & waste'], ['gas_energy', 'Gas & energy']]) },
  { kind: 'expense', key: 'household', name: 'Household', children: children('household', [['groceries', 'Groceries'], ['supplies', 'Supplies']]) },
  { kind: 'expense', key: 'food_beverage', name: 'Food and beverage', children: children('food_beverage', [['takeaways', 'Takeaways'], ['restaurants', 'Restaurants'], ['cafe_dessert', 'Cafe & dessert'], ['home_catering', 'Home catering'], ['school_catering', 'School catering']]) },
  { kind: 'expense', key: 'transportation', name: 'Transportation', children: children('transportation', [['vehicle_maintenance', 'Vehicle maintenance'], ['fuel_cost', 'Fuel cost'], ['parking_tolls', 'Parking & tolls'], ['ride_hailing', 'Ride hailing'], ['public_transport', 'Public transport'], ['auto_repair', 'Auto repair']]) },
  { kind: 'expense', key: 'property', name: 'Property', children: children('property', [['housing_rent', 'Housing rent'], ['house_maintenance', 'House maintenance'], ['community_security', 'Community & security'], ['home_services', 'Home services'], ['decor_furnishings', 'Decor & furnishings'], ['repair_improvements', 'Repair & improvements'], ['real_estate', 'Real estate']]) },
  { kind: 'expense', key: 'health_care', name: 'Health care', children: children('health_care', [['supplements', 'Supplements'], ['outpatient_care', 'Outpatient care'], ['pharmacy', 'Pharmacy'], ['vision_dental_care', 'Vision & dental care'], ['accident_emergency', 'Accident & emergency'], ['general_check_up', 'General check-up']]) },
  { kind: 'expense', key: 'protection', name: 'Protection', children: children('protection', [['health_insurance', 'Health insurance'], ['life_insurance', 'Life insurance'], ['critical_insurance', 'Critical insurance'], ['auto_insurance', 'Auto insurance']]) },
  { kind: 'expense', key: 'education', name: 'Education', children: children('education', [['administration', 'Administration'], ['tuition_fees', 'Tuition fees'], ['parent_association', 'Parent association'], ['after_school_club', 'After school club'], ['field_trip_activities', 'Field trip activities'], ['performances', 'Performances'], ['shuttle_bus', 'Shuttle bus'], ['text_books_supplies', 'Text books & supplies'], ['courses_lessons', 'Courses/lessons'], ['pocket_money', 'Pocket money']]) },
  { kind: 'expense', key: 'personal_care', name: 'Personal care', children: children('personal_care', [['self_development', 'Self development'], ['grooming_haircuts', 'Grooming & haircuts'], ['sports_fitness', 'Sports & fitness'], ['spa_wellness', 'Spa & wellness'], ['dry_clean_laundry', 'Dry clean & laundry'], ['counselling_therapy', 'Counselling & therapy']]) },
  { kind: 'expense', key: 'entertainment', name: 'Entertainment', children: children('entertainment', [['subscriptions', 'Subscriptions'], ['movies', 'Movies'], ['recreation', 'Recreation'], ['games', 'Games'], ['concert_events', 'Concert & events'], ['craft_hobbies', 'Craft & hobbies']]) },
  { kind: 'expense', key: 'shopping', name: 'Shopping', children: children('shopping', [['clothing', 'Clothing'], ['electronics', 'Electronics'], ['toys', 'Toys'], ['books', 'Books']]) },
  { kind: 'expense', key: 'donation', name: 'Donation', children: children('donation', [['obligation', 'Obligation'], ['dependant', 'Dependant'], ['charity', 'Charity']]) },
  { kind: 'expense', key: 'gift_giving', name: 'Gift giving', children: children('gift_giving', [['birthday', 'Birthday'], ['relatives', 'Relatives'], ['wedding', 'Wedding'], ['newborn', 'Newborn'], ['funeral', 'Funeral'], ['celebration', 'Celebration']]) },
  { kind: 'expense', key: 'government_taxes', name: 'Government & taxes', children: children('government_taxes', [['estimated_tax', 'Estimated tax'], ['land_building_tax', 'Land & building tax'], ['motor_vehicle_tax', 'Motor vehicle tax']]) },
  { kind: 'expense', key: 'miscellaneous', name: 'Miscellaneous', children: children('miscellaneous', [['postal_service', 'Postal service'], ['professional_fee', 'Professional fee'], ['fine_penalty', 'Fine/penalty'], ['documentation', 'Documentation'], ['interest', 'Interest'], ['fees_charges', 'Fees & charges'], ['membership_fee', 'Membership fee']]) },
  { kind: 'expense', key: 'travel', name: 'Travel', children: children('travel', [['flights', 'Flights'], ['hotels', 'Hotels'], ['activities', 'Activities']]) },
  { kind: 'expense', key: 'business', name: 'Business & Invoices' },
  { kind: 'income', key: 'income.salary', name: 'Salary' },
  { kind: 'income', key: 'income.bonus', name: 'Bonus' },
  { kind: 'income', key: 'income.investment', name: 'Investment Income' },
  { kind: 'income', key: 'income.realized_gains', name: 'Realized Gains' },
  { kind: 'income', key: 'income.cashback', name: 'Cashback & Rewards' },
  { kind: 'income', key: 'income.gifts', name: 'Gifts Received' },
  { kind: 'income', key: 'income.other', name: 'Other Income' },
];

export const DEFAULT_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  DEFAULT_CATEGORIES.flatMap((category) => [category.key, ...(category.children ?? []).map((child) => child.key)]),
);

/**
 * Typical merchant category code for purchases in each default category, used when a purchase has no typed or
 * remembered MCC. Users can override them per workspace.
 */
export const DEFAULT_CATEGORY_MCCS: Readonly<Record<string, string>> = {
  'donation.charity': '8398',
  education: '8299',
  'education.text_books_supplies': '5942',
  'education.tuition_fees': '8299',
  entertainment: '7999',
  'entertainment.craft_hobbies': '5945',
  'entertainment.games': '5816',
  'entertainment.movies': '7832',
  'entertainment.subscriptions': '5968',
  food_beverage: '5812',
  'food_beverage.cafe_dessert': '5814',
  'food_beverage.restaurants': '5812',
  gift_giving: '5947',
  government_taxes: '9399',
  health_care: '8099',
  'health_care.outpatient_care': '8062',
  'health_care.pharmacy': '5912',
  'household.groceries': '5411',
  'household.supplies': '5719',
  personal_care: '7230',
  'personal_care.sports_fitness': '5941',
  property: '6513',
  'property.house_maintenance': '1520',
  'property.housing_rent': '6513',
  'property.real_estate': '6513',
  'protection.health_insurance': '6300',
  shopping: '5311',
  'shopping.clothing': '5651',
  'shopping.electronics': '5732',
  'transportation.fuel_cost': '5541',
  'transportation.parking_tolls': '7523',
  'transportation.public_transport': '4111',
  'transportation.ride_hailing': '4121',
  utilities: '4900',
  'utilities.electricity': '4900',
  'utilities.gas_energy': '4900',
  'utilities.internet_provider': '4814',
  'utilities.mobile_phone': '4814',
  'utilities.water_sanitation': '4900',
  business: '7399',
  travel: '4722',
  'travel.activities': '7999',
  'travel.flights': '4511',
  'travel.hotels': '7011',
};
