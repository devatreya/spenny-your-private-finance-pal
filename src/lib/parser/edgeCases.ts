/**
 * edgeCases.ts
 * Specific logic for corner shops, ATM, rent, unknown transfers, etc.
 */

import { Transaction, Category } from './schema';
import { looksLikePersonName } from './utils/merchantTools';

export interface EdgeCaseResult {
  category?: Category;
  subcategory?: string;
  confidence: number;
  notes?: string;
  matched: boolean;
}

/**
 * Check if transaction matches any edge case patterns
 */
export function checkEdgeCases(transaction: Transaction): EdgeCaseResult {
  const merchant = transaction.merchant_canonical.toLowerCase();
  const description = (transaction.description || '').toLowerCase();
  const amount = Math.abs(transaction.amount);
  
  // ATM/Cash withdrawals
  if (isATMWithdrawal(merchant, description)) {
    return {
      category: 'Cash',
      subcategory: 'ATM Withdrawal',
      confidence: 0.95,
      notes: 'ATM cash withdrawal',
      matched: true,
    };
  }
  
  // Rent payments
  if (isRentPayment(merchant, description, amount)) {
    return {
      category: 'Housing',
      subcategory: 'Rent',
      confidence: 0.85,
      notes: 'Likely rent payment based on amount and description',
      matched: true,
    };
  }
  
  // Personal transfers (person names)
  if (looksLikePersonName(transaction.merchant_canonical)) {
    return {
      category: 'Transfers',
      subcategory: 'Friends',
      confidence: 0.7,
      notes: 'Appears to be a personal transfer (person name detected)',
      matched: true,
    };
  }
  
  // Off-license / alcohol shops
  if (isOffLicense(merchant)) {
    return {
      category: 'Shopping',
      subcategory: 'General',
      confidence: 0.8,
      notes: 'Off-license or alcohol shop',
      matched: true,
    };
  }
  
  // Small cafes and restaurants (if amount suggests it)
  if (isSmallCafe(merchant, amount)) {
    return {
      category: 'Food',
      subcategory: 'Eating out',
      confidence: 0.75,
      notes: 'Small transaction at potential cafe/restaurant',
      matched: true,
    };
  }
  
  // Bank fees and charges
  if (isBankFee(merchant, description)) {
    return {
      category: 'Fees/Interest',
      subcategory: 'Bank fees',
      confidence: 0.9,
      notes: 'Bank fee or charge',
      matched: true,
    };
  }
  
  // Interest charges
  if (isInterestCharge(description)) {
    return {
      category: 'Fees/Interest',
      subcategory: 'Interest charges',
      confidence: 0.95,
      notes: 'Interest charge',
      matched: true,
    };
  }
  
  // Refunds (positive amounts with refund keywords)
  if (isRefund(description, transaction.amount)) {
    return {
      category: 'Income',
      subcategory: 'Refund',
      confidence: 0.85,
      notes: 'Transaction marked as refund',
      matched: true,
    };
  }
  
  // Salary/wages
  if (isSalary(merchant, description, transaction.amount)) {
    return {
      category: 'Income',
      subcategory: 'Salary',
      confidence: 0.9,
      notes: 'Salary or wage payment',
      matched: true,
    };
  }
  
  // Internal transfers
  if (isInternalTransfer(merchant, description)) {
    return {
      category: 'Transfers',
      subcategory: 'Other accounts',
      confidence: 0.9,
      notes: 'Transfer between own accounts',
      matched: true,
    };
  }
  
  // Foreign exchange fees
  if (isForeignExchangeFee(description)) {
    return {
      category: 'Fees/Interest',
      subcategory: 'Foreign exchange',
      confidence: 0.9,
      notes: 'Foreign exchange fee',
      matched: true,
    };
  }
  
  // No edge case matched
  return {
    confidence: 0,
    matched: false,
  };
}

/**
 * Check if transaction is an ATM withdrawal
 */
function isATMWithdrawal(merchant: string, description: string): boolean {
  const patterns = [
    'atm',
    'cash',
    'withdrawal',
    'dispense',
    'cashpoint',
    'link',
    'cash machine',
  ];
  
  return patterns.some(pattern => 
    merchant.includes(pattern) || description.includes(pattern)
  );
}

/**
 * Check if transaction is a rent payment
 */
function isRentPayment(merchant: string, description: string, amount: number): boolean {
  // Check for rent keywords
  const rentKeywords = ['rent', 'landlord', 'letting', 'property', 'estate'];
  const hasRentKeyword = rentKeywords.some(keyword => 
    merchant.includes(keyword) || description.includes(keyword)
  );
  
  if (hasRentKeyword) return true;
  
  // Large regular amounts (£500-£3000) might be rent
  const isLargeAmount = amount >= 500 && amount <= 5000;
  
  // Check if description suggests it's a standing order or regular payment
  const isRegularPayment = description.includes('standing order') || 
                          description.includes('so');
  
  return isLargeAmount && isRegularPayment && looksLikePersonName(merchant);
}

/**
 * Check if merchant is an off-license or alcohol shop
 */
function isOffLicense(merchant: string): boolean {
  const patterns = [
    'off license',
    'off licence',
    'booze',
    'wine shop',
    'liquor',
    'wines',
    'beer shop',
  ];
  
  return patterns.some(pattern => merchant.includes(pattern));
}

/**
 * Check if transaction is at a small cafe
 */
function isSmallCafe(merchant: string, amount: number): boolean {
  const cafeKeywords = [
    'cafe',
    'coffee',
    'tea room',
    'bistro',
    'deli',
    'bakery',
  ];
  
  const hasCafeKeyword = cafeKeywords.some(keyword => merchant.includes(keyword));
  
  // Small amount (£2-£15) at a place with cafe keywords
  const isSmallAmount = amount >= 2 && amount <= 15;
  
  return hasCafeKeyword && isSmallAmount;
}

/**
 * Check if transaction is a bank fee
 */
function isBankFee(merchant: string, description: string): boolean {
  const feeKeywords = [
    'bank fee',
    'service charge',
    'account fee',
    'monthly fee',
    'admin fee',
    'maintenance fee',
  ];
  
  return feeKeywords.some(keyword => 
    merchant.includes(keyword) || description.includes(keyword)
  );
}

/**
 * Check if transaction is an interest charge
 */
function isInterestCharge(description: string): boolean {
  const interestKeywords = [
    'interest',
    'interest charge',
    'overdraft interest',
    'credit interest',
  ];
  
  return interestKeywords.some(keyword => description.includes(keyword));
}

/**
 * Check if transaction is a refund
 */
function isRefund(description: string, amount: number): boolean {
  // Refunds are typically positive (money coming in)
  if (amount <= 0) return false;
  
  const refundKeywords = [
    'refund',
    'reversal',
    'chargeback',
    'returned',
    'credit adjustment',
  ];
  
  return refundKeywords.some(keyword => description.includes(keyword));
}

/**
 * Check if transaction is salary
 */
function isSalary(merchant: string, description: string, amount: number): boolean {
  // Salary is positive (income) and usually large
  if (amount <= 0) return false;
  
  const salaryKeywords = [
    'salary',
    'wage',
    'payroll',
    'pay',
    'wages',
    'income',
  ];
  
  const hasSalaryKeyword = salaryKeywords.some(keyword => 
    merchant.includes(keyword) || description.includes(keyword)
  );
  
  // Large positive amount (£1000+) might be salary
  const isLargePosAmount = amount >= 1000;
  
  return hasSalaryKeyword || (isLargePosAmount && looksLikeCompanyName(merchant));
}

/**
 * Check if merchant looks like a company name (potential employer)
 */
function looksLikeCompanyName(merchant: string): boolean {
  const companyIndicators = ['ltd', 'limited', 'inc', 'corp', 'plc', 'llc'];
  return companyIndicators.some(indicator => merchant.toLowerCase().includes(indicator));
}

/**
 * Check if transaction is an internal transfer
 */
function isInternalTransfer(merchant: string, description: string): boolean {
  const transferKeywords = [
    'transfer to',
    'transfer from',
    'internal transfer',
    'own account',
    'savings transfer',
    'current account',
    'savings account',
  ];
  
  return transferKeywords.some(keyword => 
    merchant.includes(keyword) || description.includes(keyword)
  );
}

/**
 * Check if transaction is a foreign exchange fee
 */
function isForeignExchangeFee(description: string): boolean {
  const fxKeywords = [
    'foreign exchange',
    'fx fee',
    'currency conversion',
    'exchange rate',
    'non-sterling',
  ];
  
  return fxKeywords.some(keyword => description.includes(keyword));
}

/**
 * Get confidence adjustment based on amount
 * Very small or very large amounts might need special handling
 */
export function getAmountBasedConfidence(amount: number, category: Category): number {
  const absAmount = Math.abs(amount);
  
  // Very small amounts (< £1) are often unclear
  if (absAmount < 1) {
    return 0.6;
  }
  
  // Very large amounts (> £10,000) should be reviewed
  if (absAmount > 10000) {
    return 0.7;
  }
  
  // Amounts that seem suspicious for certain categories
  if (category === 'Food' && absAmount > 200) {
    return 0.7; // Unlikely to spend £200+ at a single restaurant
  }
  
  // Amount seems reasonable for category
  return 1.0;
}

/**
 * Detect if multiple transactions from same merchant on same day
 * Might indicate split payments or separate items
 */
export function detectSplitPayments(transactions: Transaction[]): Map<string, Transaction[]> {
  const splitPayments = new Map<string, Transaction[]>();
  
  // Group by date + merchant
  const groups = new Map<string, Transaction[]>();
  
  for (const transaction of transactions) {
    const key = `${transaction.date}-${transaction.merchant_canonical}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(transaction);
  }
  
  // Find groups with multiple transactions
  for (const [key, txns] of groups.entries()) {
    if (txns.length > 1) {
      splitPayments.set(key, txns);
    }
  }
  
  return splitPayments;
}

/**
 * Handle uncategorized transactions with special logic
 */
export function handleUncategorized(transaction: Transaction): EdgeCaseResult {
  // If we have MCC code, use it
  if (transaction.mcc) {
    const category = getCategoryFromMCC(transaction.mcc);
    if (category) {
      return {
        category,
        confidence: 0.8,
        notes: `Categorized using MCC code ${transaction.mcc}`,
        matched: true,
      };
    }
  }
  
  // If amount is very small, might be a test transaction
  if (Math.abs(transaction.amount) < 0.5) {
    return {
      category: 'Unknown',
      confidence: 0.5,
      notes: 'Very small amount - possibly a test transaction',
      matched: true,
    };
  }
  
  return {
    confidence: 0,
    matched: false,
  };
}

/**
 * Get category from Merchant Category Code (MCC)
 * Simplified mapping - real implementation would have full MCC table
 */
function getCategoryFromMCC(mcc: string): Category | null {
  const mccMap: Record<string, Category> = {
    // Groceries
    '5411': 'Food', // Grocery stores
    '5422': 'Food', // Meat shops
    '5441': 'Food', // Candy shops
    
    // Restaurants
    '5812': 'Food', // Eating places, restaurants
    '5814': 'Food', // Fast food
    
    // Transport
    '4121': 'Transport', // Taxi
    '5541': 'Transport', // Gas stations
    '5542': 'Transport', // Automated fuel dispensers
    
    // Entertainment
    '7832': 'Entertainment', // Motion picture theaters
    '7922': 'Entertainment', // Theatrical producers
    
    // Add more as needed
  };
  
  return mccMap[mcc] || null;
}
