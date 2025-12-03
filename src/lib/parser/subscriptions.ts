/**
 * subscriptions.ts
 * Detects recurring payments (Netflix, Disney+, etc) via pattern analysis
 */

import { Transaction } from './schema';
import { groupByMerchant } from './utils/merchantTools';

export interface Subscription {
  merchant: string;
  amount: number;
  currency: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  confidence: number;
  transactions: Transaction[];
  nextDue?: string; // ISO date
  averageAmount: number;
  lastCharge: string; // ISO date
  status: 'active' | 'cancelled' | 'irregular';
}

/**
 * Detect recurring payments/subscriptions
 */
export function detectSubscriptions(transactions: Transaction[]): Subscription[] {
  const subscriptions: Subscription[] = [];
  
  // Group by merchant
  const merchantGroups = groupByMerchant(transactions);
  
  for (const [merchant, txns] of merchantGroups.entries()) {
    // Need at least 2 transactions to detect pattern
    if (txns.length < 2) continue;
    
    // Only consider expenses (negative amounts)
    const expenses = txns.filter(t => t.amount < 0);
    if (expenses.length < 2) continue;
    
    // Sort by date
    const sorted = [...expenses].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    // Analyze intervals between transactions
    const intervals = calculateIntervals(sorted);
    const pattern = detectPattern(intervals);
    
    if (pattern) {
      const avgAmount = calculateAverage(sorted.map(t => Math.abs(t.amount)));
      const amountVariance = calculateVariance(sorted.map(t => Math.abs(t.amount)));
      
      // Check if amounts are consistent (low variance)
      const isConsistentAmount = amountVariance < avgAmount * 0.2; // 20% variance threshold
      
      if (isConsistentAmount) {
        const lastTransaction = sorted[sorted.length - 1];
        const nextDue = calculateNextDue(lastTransaction.date, pattern.cadence);
        
        // Determine if subscription is still active
        const daysSinceLastCharge = daysBetween(lastTransaction.date, new Date().toISOString());
        const expectedInterval = getCadenceInDays(pattern.cadence);
        const isActive = daysSinceLastCharge <= expectedInterval * 1.5;
        
        subscriptions.push({
          merchant,
          amount: avgAmount,
          currency: sorted[0].currency,
          cadence: pattern.cadence,
          confidence: pattern.confidence,
          transactions: sorted,
          nextDue: isActive ? nextDue : undefined,
          averageAmount: avgAmount,
          lastCharge: lastTransaction.date,
          status: isActive ? 'active' : 'cancelled',
        });
      }
    }
  }
  
  // Sort by confidence and amount
  return subscriptions.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return b.confidence - a.confidence;
    }
    return b.amount - a.amount;
  });
}

/**
 * Calculate intervals (in days) between consecutive transactions
 */
function calculateIntervals(transactions: Transaction[]): number[] {
  const intervals: number[] = [];
  
  for (let i = 1; i < transactions.length; i++) {
    const days = daysBetween(transactions[i - 1].date, transactions[i].date);
    intervals.push(days);
  }
  
  return intervals;
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diff = d2.getTime() - d1.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

/**
 * Detect recurring pattern from intervals
 */
function detectPattern(intervals: number[]): {
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  confidence: number;
} | null {
  if (intervals.length === 0) return null;
  
  const avgInterval = calculateAverage(intervals);
  const variance = calculateVariance(intervals);
  const stdDev = Math.sqrt(variance);
  
  // Determine cadence based on average interval
  let cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  let expectedInterval: number;
  let tolerance: number;
  
  if (avgInterval <= 10) {
    // Weekly (7 days ± 3)
    cadence = 'weekly';
    expectedInterval = 7;
    tolerance = 3;
  } else if (avgInterval <= 40) {
    // Monthly (30 days ± 5)
    cadence = 'monthly';
    expectedInterval = 30;
    tolerance = 5;
  } else if (avgInterval <= 100) {
    // Quarterly (90 days ± 10)
    cadence = 'quarterly';
    expectedInterval = 90;
    tolerance = 10;
  } else {
    // Yearly (365 days ± 15)
    cadence = 'yearly';
    expectedInterval = 365;
    tolerance = 15;
  }
  
  // Calculate confidence based on consistency
  // More consistent intervals = higher confidence
  const consistencyScore = Math.max(0, 1 - stdDev / expectedInterval);
  
  // Check if intervals are close to expected
  const deviationFromExpected = Math.abs(avgInterval - expectedInterval);
  const matchScore = Math.max(0, 1 - deviationFromExpected / tolerance);
  
  // Combined confidence
  const confidence = (consistencyScore * 0.6 + matchScore * 0.4);
  
  // Only return if confidence is reasonable
  if (confidence < 0.5) return null;
  
  return {
    cadence,
    confidence: Math.min(0.95, confidence),
  };
}

/**
 * Calculate next due date
 */
function calculateNextDue(lastDate: string, cadence: string): string {
  const date = new Date(lastDate);
  
  switch (cadence) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  
  return date.toISOString().split('T')[0];
}

/**
 * Get cadence in days
 */
function getCadenceInDays(cadence: string): number {
  switch (cadence) {
    case 'weekly': return 7;
    case 'monthly': return 30;
    case 'quarterly': return 90;
    case 'yearly': return 365;
    default: return 30;
  }
}

/**
 * Calculate average of numbers
 */
function calculateAverage(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

/**
 * Calculate variance of numbers
 */
function calculateVariance(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const avg = calculateAverage(numbers);
  const squaredDiffs = numbers.map(n => Math.pow(n - avg, 2));
  return calculateAverage(squaredDiffs);
}

/**
 * Get total monthly cost from subscriptions
 */
export function getTotalMonthlyCost(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(s => s.status === 'active')
    .reduce((total, sub) => {
      let monthlyCost = sub.amount;
      
      // Convert to monthly
      switch (sub.cadence) {
        case 'weekly':
          monthlyCost = sub.amount * 4.33; // Average weeks per month
          break;
        case 'quarterly':
          monthlyCost = sub.amount / 3;
          break;
        case 'yearly':
          monthlyCost = sub.amount / 12;
          break;
      }
      
      return total + monthlyCost;
    }, 0);
}

/**
 * Get subscriptions expiring soon
 */
export function getUpcomingSubscriptions(
  subscriptions: Subscription[],
  daysAhead: number = 7
): Subscription[] {
  const today = new Date();
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + daysAhead);
  
  return subscriptions.filter(sub => {
    if (!sub.nextDue || sub.status !== 'active') return false;
    
    const dueDate = new Date(sub.nextDue);
    return dueDate >= today && dueDate <= futureDate;
  });
}

/**
 * Group subscriptions by category
 */
export function groupSubscriptionsByCategory(
  subscriptions: Subscription[],
  transactions: Transaction[]
): Map<string, Subscription[]> {
  const groups = new Map<string, Subscription[]>();
  
  for (const sub of subscriptions) {
    // Find a transaction to get its category
    const transaction = transactions.find(
      t => t.merchant_canonical === sub.merchant
    );
    
    const category = transaction?.category || 'Unknown';
    
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(sub);
  }
  
  return groups;
}

/**
 * Check if subscription amount has changed
 */
export function detectPriceChanges(subscription: Subscription): {
  hasChanged: boolean;
  oldAmount?: number;
  newAmount?: number;
  changePercent?: number;
} {
  if (subscription.transactions.length < 3) {
    return { hasChanged: false };
  }
  
  const sorted = [...subscription.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  const recentTxns = sorted.slice(-3);
  const olderTxns = sorted.slice(0, -3);
  
  const recentAvg = calculateAverage(recentTxns.map(t => Math.abs(t.amount)));
  const olderAvg = calculateAverage(olderTxns.map(t => Math.abs(t.amount)));
  
  const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;
  
  // Consider a change if it's more than 5%
  if (Math.abs(changePercent) > 5) {
    return {
      hasChanged: true,
      oldAmount: olderAvg,
      newAmount: recentAvg,
      changePercent,
    };
  }
  
  return { hasChanged: false };
}

/**
 * Find potential forgotten subscriptions
 * (Active but not commonly known)
 */
export function findForgottenSubscriptions(
  subscriptions: Subscription[]
): Subscription[] {
  // List of common subscription services (people are usually aware of these)
  const commonServices = [
    'netflix', 'spotify', 'disney', 'amazon prime', 'apple',
    'youtube', 'hulu', 'hbo', 'gym', 'insurance'
  ];
  
  return subscriptions.filter(sub => {
    if (sub.status !== 'active') return false;
    
    const merchantLower = sub.merchant.toLowerCase();
    const isCommon = commonServices.some(service => 
      merchantLower.includes(service)
    );
    
    return !isCommon;
  });
}
