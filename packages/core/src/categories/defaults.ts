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
  { kind: 'expense', key: 'entertainment', name: 'Entertainment', children: children('entertainment', [['events', 'Movies & Events'], ['hobbies', 'Hobbies'], ['games', 'Games']]) },
  { kind: 'expense', key: 'travel', name: 'Travel', children: children('travel', [['flights', 'Flights'], ['hotels', 'Hotels'], ['activities', 'Activities']]) },
  { kind: 'expense', key: 'education', name: 'Education', children: children('education', [['courses', 'Courses'], ['books', 'Books']]) },
  { kind: 'expense', key: 'personal_care', name: 'Personal Care' },
  { kind: 'expense', key: 'gifts_donations', name: 'Gifts & Donations', children: children('gifts_donations', [['gifts', 'Gifts'], ['donations', 'Donations']]) },
  // Tax, customs, immigration, BPJS, and postal services — excluded from rewards by many card programs.
  { kind: 'expense', key: 'government', name: 'Government & Taxes' },
  // Business bills and invoicing payments — excluded from rewards by several card programs.
  { kind: 'expense', key: 'business', name: 'Business & Invoices' },
  { kind: 'expense', key: 'fees', name: 'Fees & Charges', children: children('fees', [['bank', 'Bank Fees'], ['card_annual', 'Card Annual Fee'], ['interest', 'Interest']]) },
  { kind: 'expense', key: 'other_expense', name: 'Other Expense' },
  { kind: 'income', key: 'income.salary', name: 'Salary' },
  { kind: 'income', key: 'income.bonus', name: 'Bonus' },
  { kind: 'income', key: 'income.investment', name: 'Investment Income' },
  { kind: 'income', key: 'income.cashback', name: 'Cashback & Rewards' },
  { kind: 'income', key: 'income.gifts', name: 'Gifts Received' },
  { kind: 'income', key: 'income.other', name: 'Other Income' },
];

export const DEFAULT_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  DEFAULT_CATEGORIES.flatMap((category) => [category.key, ...(category.children ?? []).map((child) => child.key)]),
);
