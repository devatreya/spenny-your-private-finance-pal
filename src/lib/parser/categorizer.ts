/**
 * categorizer.ts
 * Classifier with fallback heuristics + edge-case rules
 * Note: LLM support is optional - works great without API keys
 */

import { Transaction, Category, Subcategory, CATEGORY_CONFIG } from './schema';
import { lookupMerchant } from './utils/merchantTools';
import { checkEdgeCases, getAmountBasedConfidence } from './edgeCases';

export interface CategorizationResult {
  category: Category;
  subcategory?: string;
  confidence: number;
  notes: string;
  method: 'known_merchant' | 'edge_case' | 'llm' | 'fallback';
}

/**
 * Categorize a single transaction
 */
export async function categorizeTransaction(
  transaction: Transaction
): Promise<CategorizationResult> {
  
  // Step 1: Check if it's a known merchant
  const knownMerchant = lookupMerchant(transaction.merchant_raw);
  if (knownMerchant) {
    return {
      category: knownMerchant.category,
      subcategory: knownMerchant.subcategory as string,
      confidence: knownMerchant.confidence,
      notes: `Matched known merchant: ${knownMerchant.canonical_name}`,
      method: 'known_merchant',
    };
  }
  
  // Step 2: Check edge cases
  const edgeCase = checkEdgeCases(transaction);
  if (edgeCase.matched && edgeCase.category) {
    return {
      category: edgeCase.category,
      subcategory: edgeCase.subcategory,
      confidence: edgeCase.confidence,
      notes: edgeCase.notes || 'Matched edge case pattern',
      method: 'edge_case',
    };
  }
  
  // Step 3: Fallback to keyword matching
  const fallbackResult = categorizeWithKeywords(transaction);
  return {
    ...fallbackResult,
    method: 'fallback',
  };
}

/**
 * Fallback categorization using keyword matching
 */
function categorizeWithKeywords(
  transaction: Transaction
): Omit<CategorizationResult, 'method'> {
  const merchant = transaction.merchant_canonical.toLowerCase();
  const description = (transaction.description || '').toLowerCase();
  const searchText = `${merchant} ${description}`;
  
  // Try each category's keywords
  let bestMatch: {
    category: Category;
    confidence: number;
    subcategory?: string;
  } = {
    category: 'Unknown',
    confidence: 0.3,
  };
  
  for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
    if (config.keywords) {
      const matchCount = config.keywords.filter(keyword =>
        searchText.includes(keyword.toLowerCase())
      ).length;
      
      if (matchCount > 0) {
        const confidence = Math.min(0.7, 0.5 + matchCount * 0.1);
        if (confidence > bestMatch.confidence) {
          bestMatch = {
            category: category as Category,
            confidence,
            subcategory: config.subcategories[0], // Default to first subcategory
          };
        }
      }
    }
  }
  
  // Adjust confidence based on amount
  const amountConfidence = getAmountBasedConfidence(
    transaction.amount,
    bestMatch.category
  );
  bestMatch.confidence = bestMatch.confidence * amountConfidence;
  
  return {
    category: bestMatch.category,
    subcategory: bestMatch.subcategory,
    confidence: bestMatch.confidence,
    notes: bestMatch.confidence > 0.5
      ? `Matched keywords for ${bestMatch.category}`
      : 'No clear match - needs review',
  };
}

/**
 * Categorize multiple transactions in batch
 */
export async function categorizeTransactions(
  transactions: Transaction[],
  onProgress?: (current: number, total: number) => void
): Promise<Transaction[]> {
  const categorized: Transaction[] = [];
  
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    
    try {
      const result = await categorizeTransaction(transaction);
      
      categorized.push({
        ...transaction,
        category: result.category,
        subcategory: result.subcategory as any,
        confidence: result.confidence,
        notes: result.notes,
      });
    } catch (error) {
      console.error(`Failed to categorize transaction ${transaction.id}:`, error);
      categorized.push({
        ...transaction,
        category: 'Unknown',
        confidence: 0,
        notes: 'Categorization failed',
      });
    }
    
    if (onProgress) {
      onProgress(i + 1, transactions.length);
    }
  }
  
  return categorized;
}

/**
 * Re-categorize transactions after user correction
 * Learns from user feedback to update similar transactions
 */
export function applyCorrectionToSimilar(
  correctedTransaction: Transaction,
  allTransactions: Transaction[]
): Transaction[] {
  const updated = [...allTransactions];
  
  // Find similar transactions (same merchant)
  for (let i = 0; i < updated.length; i++) {
    const t = updated[i];
    
    if (
      t.id !== correctedTransaction.id &&
      t.merchant_canonical === correctedTransaction.merchant_canonical
    ) {
      // Apply the same categorization
      updated[i] = {
        ...t,
        category: correctedTransaction.category,
        subcategory: correctedTransaction.subcategory,
        confidence: Math.min(0.9, correctedTransaction.confidence + 0.1),
        notes: `Applied correction from similar transaction`,
      };
    }
  }
  
  return updated;
}

/**
 * Get confidence color for UI
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'green';
  if (confidence >= 0.6) return 'yellow';
  return 'red';
}

/**
 * Get confidence label
 */
export function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.6) return 'Medium';
  return 'Low';
}

/**
 * Filter transactions by confidence threshold
 */
export function getUncertainTransactions(
  transactions: Transaction[],
  threshold: number = 0.6
): Transaction[] {
  return transactions.filter(t => t.confidence < threshold);
}

/**
 * Get categorization statistics
 */
export interface CategorizationStats {
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  byCategory: Record<Category, number>;
  byMethod?: Record<string, number>;
}

export function getCategorizationStats(
  transactions: Transaction[]
): CategorizationStats {
  const stats: CategorizationStats = {
    total: transactions.length,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    byCategory: {} as Record<Category, number>,
  };
  
  for (const t of transactions) {
    // Confidence distribution
    if (t.confidence >= 0.8) {
      stats.highConfidence++;
    } else if (t.confidence >= 0.6) {
      stats.mediumConfidence++;
    } else {
      stats.lowConfidence++;
    }
    
    // Category distribution
    if (!stats.byCategory[t.category]) {
      stats.byCategory[t.category] = 0;
    }
    stats.byCategory[t.category]++;
  }
  
  return stats;
}
