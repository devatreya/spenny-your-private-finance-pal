/**
 * schema.ts
 * Defines the unified transaction data shape, category schema, and types
 */

export type Category =
  | "Food"
  | "Transport"
  | "Shopping"
  | "Housing"
  | "Utilities"
  | "Health"
  | "Travel"
  | "Entertainment"
  | "Subscriptions"
  | "Cash"
  | "Fees/Interest"
  | "Transfers"
  | "Income"
  | "Unknown";

export type Subcategory = {
  Food: "Groceries" | "Eating out" | "Coffee" | "Alcohol";
  Transport: "Fuel" | "Rideshare" | "Public transport" | "Parking" | "Taxi";
  Shopping: "Clothing" | "Electronics" | "Home" | "Personal care" | "General";
  Housing: "Rent" | "Mortgage" | "Maintenance";
  Utilities: "Electricity" | "Water" | "Gas" | "Internet" | "Mobile" | "Shared bills";
  Health: "Medical" | "Pharmacy" | "Fitness" | "Insurance";
  Travel: "Flights" | "Accommodation" | "Activities";
  Entertainment: "Movies" | "Games" | "Events" | "Hobbies";
  Subscriptions: "Streaming" | "Software" | "Membership" | "News";
  Cash: "ATM Withdrawal";
  "Fees/Interest": "Bank fees" | "Interest charges" | "Overdraft" | "Foreign exchange";
  Transfers: "Friends" | "Savings" | "Investment" | "Other accounts";
  Income: "Salary" | "Refund" | "Reimbursement" | "Other";
  Unknown: "Uncategorized";
};

export interface Transaction {
  id: string;
  date: string; // ISO format
  amount: number; // Negative for expenses, positive for income
  currency: string;
  merchant_raw: string;
  merchant_canonical: string;
  category: Category;
  subcategory?: Subcategory[Category];
  confidence: number; // 0-1
  notes?: string; // Why we classified it this way
  mcc?: string; // Merchant Category Code (if available)
  description?: string; // Additional description from statement
  source?: string; // Which file this came from
}

export interface ParsedStatement {
  filename: string;
  transactions: Transaction[];
  metadata?: {
    accountNumber?: string; // Redacted/masked
    statementPeriod?: {
      start: string;
      end: string;
    };
    currency?: string;
  };
}

export interface MerchantMetadata {
  canonical_name: string;
  category: Category;
  subcategory?: Subcategory[Category];
  aliases?: string[]; // Known variations
  confidence: number;
}

export interface CategoryConfig {
  category: Category;
  subcategories: string[];
  keywords?: string[]; // For fallback matching
  examples?: string[]; // For LLM context
}

export const CATEGORY_CONFIG: Record<Category, CategoryConfig> = {
  Food: {
    category: "Food",
    subcategories: ["Groceries", "Eating out", "Coffee", "Alcohol"],
    keywords: ["restaurant", "cafe", "supermarket", "grocery", "food", "dining"],
    examples: ["Tesco", "Sainsbury's", "McDonald's", "Starbucks", "Pizza Hut"],
  },
  Transport: {
    category: "Transport",
    subcategories: ["Fuel", "Rideshare", "Public transport", "Parking", "Taxi"],
    keywords: ["uber", "lyft", "taxi", "petrol", "gas", "station", "parking", "tfl"],
    examples: ["Shell", "BP", "Uber", "Transport for London", "National Rail"],
  },
  Shopping: {
    category: "Shopping",
    subcategories: ["Clothing", "Electronics", "Home", "Personal care", "General"],
    keywords: ["amazon", "shop", "store", "retail", "clothing"],
    examples: ["Amazon", "H&M", "Zara", "Apple Store", "Boots"],
  },
  Housing: {
    category: "Housing",
    subcategories: ["Rent", "Mortgage", "Maintenance"],
    keywords: ["rent", "mortgage", "landlord", "estate", "property"],
    examples: ["Monthly rent payment", "Mortgage payment"],
  },
  Utilities: {
    category: "Utilities",
    subcategories: ["Electricity", "Water", "Gas", "Internet", "Mobile", "Shared bills"],
    keywords: ["electric", "water", "gas", "broadband", "internet", "mobile", "phone"],
    examples: ["British Gas", "Thames Water", "EE", "Virgin Media"],
  },
  Health: {
    category: "Health",
    subcategories: ["Medical", "Pharmacy", "Fitness", "Insurance"],
    keywords: ["pharmacy", "chemist", "doctor", "hospital", "gym", "fitness"],
    examples: ["Boots Pharmacy", "PureGym", "Bupa", "NHS"],
  },
  Travel: {
    category: "Travel",
    subcategories: ["Flights", "Accommodation", "Activities"],
    keywords: ["airline", "hotel", "booking", "airbnb", "flight", "airport"],
    examples: ["British Airways", "Booking.com", "Airbnb", "Ryanair"],
  },
  Entertainment: {
    category: "Entertainment",
    subcategories: ["Movies", "Games", "Events", "Hobbies"],
    keywords: ["cinema", "theater", "game", "concert", "event", "ticket"],
    examples: ["Odeon", "Vue Cinema", "Ticketmaster", "Steam"],
  },
  Subscriptions: {
    category: "Subscriptions",
    subcategories: ["Streaming", "Software", "Membership", "News"],
    keywords: ["subscription", "monthly", "membership"],
    examples: ["Netflix", "Spotify", "Disney+", "Apple Music", "Amazon Prime"],
  },
  Cash: {
    category: "Cash",
    subcategories: ["ATM Withdrawal"],
    keywords: ["atm", "cash", "withdrawal", "dispense"],
    examples: ["ATM", "Cash withdrawal"],
  },
  "Fees/Interest": {
    category: "Fees/Interest",
    subcategories: ["Bank fees", "Interest charges", "Overdraft", "Foreign exchange"],
    keywords: ["fee", "charge", "interest", "overdraft", "penalty"],
    examples: ["Bank charges", "Interest payment", "Overdraft fee"],
  },
  Transfers: {
    category: "Transfers",
    subcategories: ["Friends", "Savings", "Investment", "Other accounts"],
    keywords: ["transfer", "payment to", "from"],
    examples: ["Transfer to John Smith", "Savings account transfer"],
  },
  Income: {
    category: "Income",
    subcategories: ["Salary", "Refund", "Reimbursement", "Other"],
    keywords: ["salary", "wage", "refund", "reimbursement", "payment received"],
    examples: ["Monthly salary", "Tax refund", "Expense reimbursement"],
  },
  Unknown: {
    category: "Unknown",
    subcategories: ["Uncategorized"],
    keywords: [],
    examples: [],
  },
};

export const KNOWN_MERCHANTS: Record<string, MerchantMetadata> = {
  // Food - Groceries
  tesco: {
    canonical_name: "Tesco",
    category: "Food",
    subcategory: "Groceries",
    aliases: ["tesco stores", "tesco express", "tesco metro"],
    confidence: 0.95,
  },
  sainsburys: {
    canonical_name: "Sainsbury's",
    category: "Food",
    subcategory: "Groceries",
    aliases: ["sainsbury", "sainsburys local"],
    confidence: 0.95,
  },
  asda: {
    canonical_name: "Asda",
    category: "Food",
    subcategory: "Groceries",
    confidence: 0.95,
  },
  aldi: {
    canonical_name: "Aldi",
    category: "Food",
    subcategory: "Groceries",
    confidence: 0.95,
  },
  lidl: {
    canonical_name: "Lidl",
    category: "Food",
    subcategory: "Groceries",
    confidence: 0.95,
  },
  waitrose: {
    canonical_name: "Waitrose",
    category: "Food",
    subcategory: "Groceries",
    confidence: 0.95,
  },
  morrisons: {
    canonical_name: "Morrisons",
    category: "Food",
    subcategory: "Groceries",
    confidence: 0.95,
  },
  // Food - Eating out
  mcdonalds: {
    canonical_name: "McDonald's",
    category: "Food",
    subcategory: "Eating out",
    aliases: ["mcdonald", "mcdonalds"],
    confidence: 0.95,
  },
  kfc: {
    canonical_name: "KFC",
    category: "Food",
    subcategory: "Eating out",
    confidence: 0.95,
  },
  subway: {
    canonical_name: "Subway",
    category: "Food",
    subcategory: "Eating out",
    confidence: 0.9,
  },
  nandos: {
    canonical_name: "Nando's",
    category: "Food",
    subcategory: "Eating out",
    aliases: ["nandos"],
    confidence: 0.95,
  },
  pizzahut: {
    canonical_name: "Pizza Hut",
    category: "Food",
    subcategory: "Eating out",
    aliases: ["pizza hut"],
    confidence: 0.95,
  },
  dominos: {
    canonical_name: "Domino's",
    category: "Food",
    subcategory: "Eating out",
    aliases: ["dominos pizza"],
    confidence: 0.95,
  },
  starbucks: {
    canonical_name: "Starbucks",
    category: "Food",
    subcategory: "Coffee",
    confidence: 0.95,
  },
  costa: {
    canonical_name: "Costa Coffee",
    category: "Food",
    subcategory: "Coffee",
    aliases: ["costa coffee"],
    confidence: 0.95,
  },
  pret: {
    canonical_name: "Pret A Manger",
    category: "Food",
    subcategory: "Eating out",
    aliases: ["pret a manger"],
    confidence: 0.95,
  },
  // Transport
  shell: {
    canonical_name: "Shell",
    category: "Transport",
    subcategory: "Fuel",
    confidence: 0.95,
  },
  bp: {
    canonical_name: "BP",
    category: "Transport",
    subcategory: "Fuel",
    confidence: 0.95,
  },
  esso: {
    canonical_name: "Esso",
    category: "Transport",
    subcategory: "Fuel",
    confidence: 0.95,
  },
  uber: {
    canonical_name: "Uber",
    category: "Transport",
    subcategory: "Rideshare",
    aliases: ["uber trip", "uber bv"],
    confidence: 0.95,
  },
  ubereats: {
    canonical_name: "Uber Eats",
    category: "Food",
    subcategory: "Eating out",
    aliases: ["uber eats", "uber* eats"],
    confidence: 0.95,
  },
  deliveroo: {
    canonical_name: "Deliveroo",
    category: "Food",
    subcategory: "Eating out",
    confidence: 0.95,
  },
  justeat: {
    canonical_name: "Just Eat",
    category: "Food",
    subcategory: "Eating out",
    aliases: ["just eat", "justeat"],
    confidence: 0.95,
  },
  greggs: {
    canonical_name: "Greggs",
    category: "Food",
    subcategory: "Eating out",
    confidence: 0.95,
  },
  boots: {
    canonical_name: "Boots",
    category: "Health",
    subcategory: "Pharmacy",
    aliases: ["boots pharmacy"],
    confidence: 0.9,
  },
  puregym: {
    canonical_name: "PureGym",
    category: "Health",
    subcategory: "Fitness",
    aliases: ["pure gym"],
    confidence: 0.95,
  },
  thegym: {
    canonical_name: "The Gym",
    category: "Health",
    subcategory: "Fitness",
    aliases: ["the gym group"],
    confidence: 0.95,
  },
  tfl: {
    canonical_name: "Transport for London",
    category: "Transport",
    subcategory: "Public transport",
    aliases: ["transport for london", "tfl travel"],
    confidence: 0.95,
  },
  // Shopping
  amazon: {
    canonical_name: "Amazon",
    category: "Shopping",
    subcategory: "General",
    aliases: ["amazon.co.uk", "amazon prime", "amzn"],
    confidence: 0.9,
  },
  // Subscriptions
  netflix: {
    canonical_name: "Netflix",
    category: "Subscriptions",
    subcategory: "Streaming",
    confidence: 0.95,
  },
  spotify: {
    canonical_name: "Spotify",
    category: "Subscriptions",
    subcategory: "Streaming",
    confidence: 0.95,
  },
  disneyplus: {
    canonical_name: "Disney+",
    category: "Subscriptions",
    subcategory: "Streaming",
    aliases: ["disney plus", "disney+"],
    confidence: 0.95,
  },
  appletv: {
    canonical_name: "Apple TV+",
    category: "Subscriptions",
    subcategory: "Streaming",
    aliases: ["apple tv", "apple tv+"],
    confidence: 0.95,
  },
  amazonprime: {
    canonical_name: "Amazon Prime",
    category: "Subscriptions",
    subcategory: "Membership",
    aliases: ["prime video", "amazon prime video"],
    confidence: 0.95,
  },
  appleicloud: {
    canonical_name: "Apple iCloud",
    category: "Subscriptions",
    subcategory: "Software",
    aliases: ["apple com bil", "apple com bill", "applecom bil", "applecom bill", "apple bil", "apple bill", "icloud storage"],
    confidence: 0.95,
  },
  uberone: {
    canonical_name: "Uber One",
    category: "Subscriptions",
    subcategory: "Membership",
    aliases: ["ubr pending uber", "ubr pending", "pending uber", "uber one"],
    confidence: 0.95,
  },
};

