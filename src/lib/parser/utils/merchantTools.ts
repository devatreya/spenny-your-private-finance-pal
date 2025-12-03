/**
 * merchantTools.ts
 * Merchant string cleaning, canonicalization, and fuzzy matching
 */

import { KNOWN_MERCHANTS, MerchantMetadata } from '../schema';

/**
 * Clean and normalize merchant name
 * Removes common patterns, locations, extra info
 */
export function cleanMerchantName(raw: string): string {
  if (!raw) return '';
  
  let cleaned = raw.trim();
  
  // Convert to lowercase for processing
  cleaned = cleaned.toLowerCase();
  
  // Remove common prefixes/suffixes
  cleaned = cleaned.replace(/^(www\.|http:\/\/|https:\/\/)/gi, '');
  cleaned = cleaned.replace(/\.(com|co\.uk|org|net)$/gi, '');
  
  // Remove location indicators
  cleaned = cleaned.replace(/\s+(ltd|limited|inc|llc|plc|gmbh)$/gi, '');
  cleaned = cleaned.replace(/\s*-\s*[a-z\s]+$/gi, ''); // e.g., "Tesco - London"
  cleaned = cleaned.replace(/\s+\d+$/g, ''); // Remove trailing numbers (branch codes)
  
  // Remove special characters but keep spaces
  cleaned = cleaned.replace(/[^a-z0-9\s]/gi, ' ');
  
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove common transaction prefixes
  const prefixesToRemove = [
    'payment to',
    'payment from',
    'direct debit to',
    'standing order to',
    'card payment',
    'contactless',
    'chip and pin',
    'online purchase',
    'pos',
    'purchase at',
  ];
  
  for (const prefix of prefixesToRemove) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.substring(prefix.length).trim();
    }
  }
  
  return cleaned;
}

/**
 * Get canonical merchant name
 * Looks up in known merchants or returns cleaned version
 */
export function getCanonicalName(raw: string): string {
  const cleaned = cleanMerchantName(raw);
  
  // Check if we have a known merchant
  const merchantKey = cleaned.replace(/\s+/g, '').toLowerCase();
  
  // Direct match
  if (KNOWN_MERCHANTS[merchantKey]) {
    return KNOWN_MERCHANTS[merchantKey].canonical_name;
  }
  
  // Check aliases
  for (const [key, metadata] of Object.entries(KNOWN_MERCHANTS)) {
    if (metadata.aliases) {
      for (const alias of metadata.aliases) {
        const aliasKey = alias.toLowerCase().replace(/\s+/g, '');
        if (merchantKey.includes(aliasKey) || aliasKey.includes(merchantKey)) {
          return metadata.canonical_name;
        }
      }
    }
    
    // Fuzzy match - check if cleaned name contains known merchant name
    const knownKey = key.toLowerCase();
    if (cleaned.includes(knownKey) || knownKey.includes(cleaned)) {
      return metadata.canonical_name;
    }
  }
  
  // Return cleaned version with proper capitalization
  return toTitleCase(cleaned);
}

/**
 * Convert string to title case
 */
function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map(word => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Lookup known merchant metadata
 */
export function lookupMerchant(merchantName: string): MerchantMetadata | null {
  const cleaned = cleanMerchantName(merchantName);
  const merchantKey = cleaned.replace(/\s+/g, '').toLowerCase();
  
  // Direct match
  if (KNOWN_MERCHANTS[merchantKey]) {
    return KNOWN_MERCHANTS[merchantKey];
  }
  
  // Check aliases and fuzzy matches
  for (const [key, metadata] of Object.entries(KNOWN_MERCHANTS)) {
    if (metadata.aliases) {
      for (const alias of metadata.aliases) {
        const aliasKey = alias.toLowerCase().replace(/\s+/g, '');
        if (merchantKey.includes(aliasKey) || aliasKey.includes(merchantKey)) {
          return metadata;
        }
      }
    }
    
    const knownKey = key.toLowerCase();
    if (cleaned.includes(knownKey) || knownKey.includes(cleaned)) {
      return metadata;
    }
  }
  
  return null;
}

/**
 * Calculate similarity between two strings (Levenshtein distance)
 * Returns value between 0 (completely different) and 1 (identical)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const distance = matrix[s2.length][s1.length];
  const maxLength = Math.max(s1.length, s2.length);
  
  return 1 - distance / maxLength;
}

/**
 * Check if merchant name matches a pattern
 */
export function matchesPattern(merchantName: string, pattern: string | RegExp): boolean {
  const cleaned = cleanMerchantName(merchantName).toLowerCase();
  
  if (typeof pattern === 'string') {
    return cleaned.includes(pattern.toLowerCase());
  }
  
  return pattern.test(cleaned);
}

/**
 * Extract merchant name from description
 * Handles various bank statement formats
 */
export function extractMerchantFromDescription(description: string): string {
  if (!description) return '';
  
  // Common patterns in bank statements
  const patterns = [
    // "CARD PAYMENT TO TESCO STORES 1234"
    /(?:card payment to|payment to)\s+([^,\d]+)/i,
    // "DIRECT DEBIT TO NETFLIX"
    /(?:direct debit to|dd to)\s+([^,\d]+)/i,
    // "TFL TRAVEL CH"
    /^([a-z\s]+?)(?:\s+ch|\s+\d)/i,
    // Generic fallback - first meaningful part
    /^([a-z\s]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return description;
}

/**
 * Group transactions by merchant
 * Useful for finding recurring payments
 */
export function groupByMerchant<T extends { merchant_canonical: string }>(
  transactions: T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  
  for (const transaction of transactions) {
    const merchant = transaction.merchant_canonical;
    if (!groups.has(merchant)) {
      groups.set(merchant, []);
    }
    groups.get(merchant)!.push(transaction);
  }
  
  return groups;
}

/**
 * Check if a merchant name looks like a person's name
 * (likely a personal transfer)
 */
export function looksLikePersonName(merchantName: string): boolean {
  const cleaned = cleanMerchantName(merchantName);
  
  // Check for common person name patterns
  const words = cleaned.split(' ');
  
  // Single word is unlikely to be a person (unless very short)
  if (words.length === 1) {
    return words[0].length >= 3 && words[0].length <= 12;
  }
  
  // Two or three words, each starting with capital (after cleaning)
  if (words.length >= 2 && words.length <= 3) {
    // Check if words look like names (no numbers, reasonable length)
    return words.every(word => {
      return word.length >= 2 && 
             word.length <= 15 && 
             !/\d/.test(word);
    });
  }
  
  return false;
}

/**
 * Strip sensitive information from transaction data
 * For privacy-focused processing
 */
export function stripSensitiveInfo(text: string): string {
  let cleaned = text;
  
  // Remove account numbers (8-12 digits)
  cleaned = cleaned.replace(/\b\d{8,12}\b/g, '****');
  
  // Remove sort codes (XX-XX-XX format)
  cleaned = cleaned.replace(/\b\d{2}-\d{2}-\d{2}\b/g, '**-**-**');
  
  // Remove card numbers (last 4 digits patterns)
  cleaned = cleaned.replace(/\*+\d{4}/g, '****');
  
  return cleaned;
}

