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
  { kind: 'expense', key: 'food', name: 'Food & Drink', children: children('food', [['groceries', 'Groceries'], ['dining', 'Dining Out'], ['coffee', 'Coffee & Snacks']]) },
  { kind: 'expense', key: 'transport', name: 'Transport', children: children('transport', [['fuel', 'Fuel'], ['ride_hailing', 'Ride Hailing'], ['parking_tolls', 'Parking & Tolls'], ['public', 'Public Transport']]) },
  { kind: 'expense', key: 'shopping', name: 'Shopping', children: children('shopping', [['clothing', 'Clothing'], ['electronics', 'Electronics'], ['household', 'Household']]) },
  { kind: 'expense', key: 'utilities', name: 'Bills & Utilities', children: children('utilities', [['electricity', 'Electricity'], ['water', 'Water'], ['gas', 'Gas'], ['internet_phone', 'Internet & Phone'], ['subscriptions', 'Subscriptions']]) },
  { kind: 'expense', key: 'housing', name: 'Housing', children: children('housing', [['rent', 'Rent'], ['maintenance', 'Maintenance'], ['real_estate', 'Real Estate']]) },
  { kind: 'expense', key: 'health', name: 'Health', children: children('health', [['medical', 'Medical'], ['pharmacy', 'Pharmacy'], ['insurance', 'Insurance']]) },
  { kind: 'expense', key: 'entertainment', name: 'Entertainment', children: children('entertainment', [['events', 'Movies & Events'], ['hobbies', 'Hobbies'], ['games', 'Games'], ['sports', 'Sports & Fitness']]) },
  { kind: 'expense', key: 'travel', name: 'Travel', children: children('travel', [['flights', 'Flights'], ['hotels', 'Hotels'], ['activities', 'Activities']]) },
  { kind: 'expense', key: 'education', name: 'Education', children: children('education', [['courses', 'Courses'], ['books', 'Books']]) },
  { kind: 'expense', key: 'personal_care', name: 'Personal Care' },
  { kind: 'expense', key: 'gifts_donations', name: 'Gifts & Donations', children: children('gifts_donations', [['gifts', 'Gifts'], ['donations', 'Donations']]) },
  // Tax, customs, immigration, BPJS, and postal services — excluded from rewards by many card programs.
  { kind: 'expense', key: 'government', name: 'Government & Taxes', children: children('government', [['final_tax', 'Final Tax']]) },
  // Business bills and invoicing payments — excluded from rewards by several card programs.
  { kind: 'expense', key: 'business', name: 'Business & Invoices' },
  { kind: 'expense', key: 'fees', name: 'Fees & Charges', children: children('fees', [['bank', 'Bank Fees'], ['card_annual', 'Card Annual Fee'], ['interest', 'Interest'], ['notification', 'Notification Fee'], ['statement', 'Statement Fee'], ['stamp_duty', 'Stamp Duty'], ['administration', 'Administration Fee']]) },
  { kind: 'expense', key: 'other_expense', name: 'Other Expense' },
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
  food: '5812',
  'food.dining': '5812',
  'food.groceries': '5411',
  // Indonesian coffee chains usually carry the fast food code.
  'food.coffee': '5814',
  'transport.fuel': '5541',
  'transport.ride_hailing': '4121',
  'transport.parking_tolls': '7523',
  'transport.public': '4111',
  shopping: '5311',
  'shopping.clothing': '5651',
  'shopping.electronics': '5732',
  'shopping.household': '5719',
  utilities: '4900',
  'utilities.electricity': '4900',
  'utilities.water': '4900',
  'utilities.gas': '4900',
  'utilities.internet_phone': '4814',
  'utilities.subscriptions': '5968',
  housing: '6513',
  'housing.rent': '6513',
  'housing.real_estate': '6513',
  'housing.maintenance': '1520',
  health: '8099',
  'health.medical': '8062',
  'health.pharmacy': '5912',
  'health.insurance': '6300',
  entertainment: '7999',
  'entertainment.events': '7832',
  'entertainment.hobbies': '5945',
  'entertainment.games': '5816',
  'entertainment.sports': '5941',
  travel: '4722',
  'travel.flights': '4511',
  'travel.hotels': '7011',
  'travel.activities': '7999',
  education: '8299',
  'education.courses': '8299',
  'education.books': '5942',
  personal_care: '7230',
  gifts_donations: '5947',
  'gifts_donations.gifts': '5947',
  'gifts_donations.donations': '8398',
  government: '9399',
  business: '7399',
};
