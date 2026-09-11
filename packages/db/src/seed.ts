export const SYSTEM_ACCOUNTS = [
  { key: 'opening_balance', name: 'Opening Balances' },
  { key: 'currency_exchange', name: 'Currency Exchange' },
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[number]['key'];

export interface SeedCategory {
  name: string;
  kind: 'expense' | 'income';
  children?: string[];
}

export const DEFAULT_CATEGORIES: SeedCategory[] = [
  { kind: 'expense', name: 'Food & Drink', children: ['Groceries', 'Dining Out', 'Coffee & Snacks'] },
  { kind: 'expense', name: 'Transport', children: ['Fuel', 'Ride Hailing', 'Parking & Tolls', 'Public Transport'] },
  { kind: 'expense', name: 'Shopping', children: ['Clothing', 'Electronics', 'Household'] },
  { kind: 'expense', name: 'Bills & Utilities', children: ['Electricity', 'Water', 'Internet & Phone', 'Subscriptions'] },
  { kind: 'expense', name: 'Housing', children: ['Rent', 'Maintenance'] },
  { kind: 'expense', name: 'Health', children: ['Medical', 'Pharmacy', 'Insurance'] },
  { kind: 'expense', name: 'Entertainment', children: ['Movies & Events', 'Hobbies', 'Games'] },
  { kind: 'expense', name: 'Travel', children: ['Flights', 'Hotels', 'Activities'] },
  { kind: 'expense', name: 'Education', children: ['Courses', 'Books'] },
  { kind: 'expense', name: 'Personal Care' },
  { kind: 'expense', name: 'Gifts & Donations' },
  { kind: 'expense', name: 'Fees & Charges', children: ['Bank Fees', 'Card Annual Fee', 'Interest'] },
  { kind: 'expense', name: 'Other Expense' },
  { kind: 'income', name: 'Salary' },
  { kind: 'income', name: 'Bonus' },
  { kind: 'income', name: 'Investment Income' },
  { kind: 'income', name: 'Cashback & Rewards' },
  { kind: 'income', name: 'Gifts Received' },
  { kind: 'income', name: 'Other Income' },
];
