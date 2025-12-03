/**
 * confidence.ts
 * Tracks low/medium/high confidence and triggers user confirmations
 */

import { Transaction, Category } from './schema';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConfidenceThresholds {
  low: number;    // Below this is low
  medium: number; // Below this is medium, above is high
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  low: 0.6,
  medium: 0.8,
};

/**
 * Get confidence level from numeric confidence
 */
export function getConfidenceLevel(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): ConfidenceLevel {
  if (confidence < thresholds.low) {
    return 'low';
  } else if (confidence < thresholds.medium) {
    return 'medium';
  } else {
    return 'high';
  }
}

/**
 * Filter transactions by confidence level
 */
export function filterByConfidence(
  transactions: Transaction[],
  level: ConfidenceLevel,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): Transaction[] {
  return transactions.filter(t => 
    getConfidenceLevel(t.confidence, thresholds) === level
  );
}

/**
 * Get transactions that need review
 */
export function getTransactionsNeedingReview(
  transactions: Transaction[],
  threshold: number = DEFAULT_THRESHOLDS.low
): Transaction[] {
  return transactions
    .filter(t => t.confidence < threshold)
    .sort((a, b) => a.confidence - b.confidence); // Lowest confidence first
}

/**
 * Group transactions by confidence level
 */
export interface ConfidenceBreakdown {
  high: Transaction[];
  medium: Transaction[];
  low: Transaction[];
  counts: {
    high: number;
    medium: number;
    low: number;
  };
  percentages: {
    high: number;
    medium: number;
    low: number;
  };
}

export function getConfidenceBreakdown(
  transactions: Transaction[],
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): ConfidenceBreakdown {
  const breakdown: ConfidenceBreakdown = {
    high: [],
    medium: [],
    low: [],
    counts: { high: 0, medium: 0, low: 0 },
    percentages: { high: 0, medium: 0, low: 0 },
  };
  
  for (const transaction of transactions) {
    const level = getConfidenceLevel(transaction.confidence, thresholds);
    breakdown[level].push(transaction);
    breakdown.counts[level]++;
  }
  
  const total = transactions.length;
  if (total > 0) {
    breakdown.percentages.high = (breakdown.counts.high / total) * 100;
    breakdown.percentages.medium = (breakdown.counts.medium / total) * 100;
    breakdown.percentages.low = (breakdown.counts.low / total) * 100;
  }
  
  return breakdown;
}

/**
 * Confidence score for UI display
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Get color for confidence level
 */
export function getConfidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return '#22c55e'; // green
    case 'medium':
      return '#f59e0b'; // orange
    case 'low':
      return '#ef4444'; // red
  }
}

/**
 * Get emoji for confidence level
 */
export function getConfidenceEmoji(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return '✓';
    case 'medium':
      return '⚠';
    case 'low':
      return '?';
  }
}

/**
 * Calculate overall confidence score for a set of transactions
 */
export function calculateOverallConfidence(transactions: Transaction[]): number {
  if (transactions.length === 0) return 0;
  
  const totalConfidence = transactions.reduce((sum, t) => sum + t.confidence, 0);
  return totalConfidence / transactions.length;
}

/**
 * Get confidence statistics
 */
export interface ConfidenceStats {
  average: number;
  median: number;
  min: number;
  max: number;
  distribution: {
    high: number;
    medium: number;
    low: number;
  };
}

export function getConfidenceStats(
  transactions: Transaction[],
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): ConfidenceStats {
  if (transactions.length === 0) {
    return {
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      distribution: { high: 0, medium: 0, low: 0 },
    };
  }
  
  const confidences = transactions.map(t => t.confidence).sort((a, b) => a - b);
  
  const breakdown = getConfidenceBreakdown(transactions, thresholds);
  
  return {
    average: calculateOverallConfidence(transactions),
    median: confidences[Math.floor(confidences.length / 2)],
    min: confidences[0],
    max: confidences[confidences.length - 1],
    distribution: breakdown.percentages,
  };
}

/**
 * Suggest which transactions to review first
 * Prioritizes low confidence + high amounts
 */
export function prioritizeReviews(transactions: Transaction[]): Transaction[] {
  return transactions
    .filter(t => t.confidence < DEFAULT_THRESHOLDS.low)
    .sort((a, b) => {
      // Score = (1 - confidence) * abs(amount)
      const scoreA = (1 - a.confidence) * Math.abs(a.amount);
      const scoreB = (1 - b.confidence) * Math.abs(b.amount);
      return scoreB - scoreA; // Highest score first
    });
}

/**
 * Boost confidence after user confirmation
 */
export function boostConfidenceAfterConfirmation(
  transaction: Transaction,
  boost: number = 0.3
): Transaction {
  return {
    ...transaction,
    confidence: Math.min(1, transaction.confidence + boost),
    notes: (transaction.notes || '') + ' [User confirmed]',
  };
}

/**
 * Get recommendation for user action
 */
export interface ConfidenceRecommendation {
  shouldReview: boolean;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export function getRecommendation(
  transaction: Transaction,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): ConfidenceRecommendation {
  const level = getConfidenceLevel(transaction.confidence, thresholds);
  const amount = Math.abs(transaction.amount);
  
  if (level === 'low') {
    if (amount > 100) {
      return {
        shouldReview: true,
        priority: 'high',
        reason: 'Low confidence on large transaction',
      };
    } else {
      return {
        shouldReview: true,
        priority: 'medium',
        reason: 'Low confidence - please verify',
      };
    }
  } else if (level === 'medium') {
    if (amount > 200) {
      return {
        shouldReview: true,
        priority: 'medium',
        reason: 'Medium confidence on large transaction',
      };
    } else {
      return {
        shouldReview: false,
        priority: 'low',
        reason: 'Likely correct',
      };
    }
  } else {
    return {
      shouldReview: false,
      priority: 'low',
      reason: 'High confidence',
    };
  }
}

/**
 * Track user corrections to improve confidence thresholds
 */
export class ConfidenceTracker {
  private corrections: Array<{
    originalConfidence: number;
    wasCorrect: boolean;
    category: Category;
  }> = [];
  
  recordCorrection(
    originalConfidence: number,
    wasCorrect: boolean,
    category: Category
  ) {
    this.corrections.push({
      originalConfidence,
      wasCorrect,
      category,
    });
  }
  
  /**
   * Calculate optimal threshold based on correction history
   */
  getOptimalThreshold(): number {
    if (this.corrections.length < 10) {
      return DEFAULT_THRESHOLDS.low;
    }
    
    // Find threshold that minimizes false positives
    // while catching most incorrect categorizations
    const sorted = [...this.corrections].sort(
      (a, b) => a.originalConfidence - b.originalConfidence
    );
    
    let bestThreshold = DEFAULT_THRESHOLDS.low;
    let bestScore = 0;
    
    for (let i = 0; i < sorted.length; i++) {
      const threshold = sorted[i].originalConfidence;
      
      // Count true positives and false positives
      let truePositives = 0;
      let falsePositives = 0;
      
      for (const correction of this.corrections) {
        if (correction.originalConfidence < threshold) {
          if (!correction.wasCorrect) {
            truePositives++; // Correctly identified as needing review
          } else {
            falsePositives++; // Incorrectly flagged
          }
        }
      }
      
      // Score favors catching errors while minimizing false alarms
      const score = truePositives - falsePositives * 0.5;
      
      if (score > bestScore) {
        bestScore = score;
        bestThreshold = threshold;
      }
    }
    
    return bestThreshold;
  }
  
  /**
   * Get category-specific confidence insights
   */
  getCategoryAccuracy(category: Category): number {
    const categoryCorrections = this.corrections.filter(
      c => c.category === category
    );
    
    if (categoryCorrections.length === 0) return 1;
    
    const correct = categoryCorrections.filter(c => c.wasCorrect).length;
    return correct / categoryCorrections.length;
  }
}
