/**
 * parser.ts
 * Extracts transaction data from PDFs or CSVs, normalizes fields
 */

import Papa from 'papaparse';
import { Transaction, ParsedStatement } from './schema';
import { cleanMerchantName, getCanonicalName, extractMerchantFromDescription } from './utils/merchantTools';
import { parsePDF as parsePDFFile } from './pdfParser';

// Simple UUID generator
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export interface ParseOptions {
  filename: string;
  fileType: 'csv' | 'pdf';
  dateFormat?: string;
}

export type FileType = 'csv' | 'pdf';

/**
 * Main entry point - parse a file and return transactions
 */
export async function parseFile(
  file: File,
  options?: Partial<ParseOptions>
): Promise<ParsedStatement> {
  const filename = options?.filename || file.name;
  const fileType = detectFileType(file);
  
  if (fileType === 'csv') {
    return parseCSV(file, filename);
  } else if (fileType === 'pdf') {
    return parsePDFFile(file, filename);
  } else {
    throw new Error(`Unsupported file type: ${file.type}`);
  }
}

/**
 * Detect file type from File object
 */
export function detectFileType(file: File): FileType {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  // Check by extension first (more reliable)
  if (extension === 'csv') {
    return 'csv';
  } else if (extension === 'pdf') {
    return 'pdf';
  }
  
  // Check by MIME type
  if (mimeType.includes('csv') || mimeType.includes('comma-separated')) {
    return 'csv';
  } else if (mimeType.includes('pdf')) {
    return 'pdf';
  }
  
  // Check by content (last resort)
  if (extension === 'txt' && file.name.toLowerCase().includes('statement')) {
    return 'csv'; // Assume text statements are CSV
  }
  
  throw new Error(`Unable to detect file type for: ${file.name}. Supported formats: CSV, PDF`);
}

/**
 * Parse CSV file
 * Handles various bank CSV formats
 */
async function parseCSV(file: File, filename: string): Promise<ParsedStatement> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const transactions = parseCSVRows(results.data as any[], filename);
          resolve({
            filename,
            transactions,
          });
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => {
        reject(new Error(`CSV parsing error: ${error.message}`));
      },
    });
  });
}

/**
 * Parse CSV rows into transactions
 * Attempts to auto-detect column mappings
 */
function parseCSVRows(rows: any[], source: string): Transaction[] {
  if (rows.length === 0) {
    throw new Error('CSV file is empty');
  }
  
  // Detect column mappings
  const headers = Object.keys(rows[0]);
  const mapping = detectColumnMapping(headers);
  
  const transactions: Transaction[] = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    try {
      const transaction = parseCSVRow(row, mapping, source);
      if (transaction) {
        transactions.push(transaction);
      }
    } catch (error) {
      console.warn(`Failed to parse row ${i + 1}:`, error);
      // Continue parsing other rows
    }
  }
  
  return transactions;
}

/**
 * Detect which columns correspond to which fields
 */
function detectColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  
  // Date column
  const datePatterns = ['date', 'transaction date', 'posted date', 'trans date', 'value date'];
  for (const pattern of datePatterns) {
    const index = lowerHeaders.findIndex(h => h.includes(pattern));
    if (index !== -1) {
      mapping.date = headers[index];
      break;
    }
  }
  
  // Description/Merchant column
  const descPatterns = ['description', 'merchant', 'details', 'transaction', 'narrative'];
  for (const pattern of descPatterns) {
    const index = lowerHeaders.findIndex(h => h.includes(pattern));
    if (index !== -1) {
      mapping.description = headers[index];
      break;
    }
  }
  
  // Amount columns (could be single or debit/credit split)
  const amountPatterns = ['amount', 'value', 'transaction amount'];
  const debitPatterns = ['debit', 'paid out', 'withdrawal'];
  const creditPatterns = ['credit', 'paid in', 'deposit'];
  
  for (const pattern of amountPatterns) {
    const index = lowerHeaders.findIndex(h => h === pattern || h === 'amount');
    if (index !== -1) {
      mapping.amount = headers[index];
      break;
    }
  }
  
  for (const pattern of debitPatterns) {
    const index = lowerHeaders.findIndex(h => h.includes(pattern));
    if (index !== -1) {
      mapping.debit = headers[index];
      break;
    }
  }
  
  for (const pattern of creditPatterns) {
    const index = lowerHeaders.findIndex(h => h.includes(pattern));
    if (index !== -1) {
      mapping.credit = headers[index];
      break;
    }
  }
  
  // Currency
  const currencyPatterns = ['currency', 'ccy'];
  for (const pattern of currencyPatterns) {
    const index = lowerHeaders.findIndex(h => h.includes(pattern));
    if (index !== -1) {
      mapping.currency = headers[index];
      break;
    }
  }
  
  // Balance (optional, not used but good to detect)
  const balancePatterns = ['balance', 'running balance'];
  for (const pattern of balancePatterns) {
    const index = lowerHeaders.findIndex(h => h.includes(pattern));
    if (index !== -1) {
      mapping.balance = headers[index];
      break;
    }
  }
  
  return mapping;
}

/**
 * Parse a single CSV row into a transaction
 */
function parseCSVRow(
  row: any,
  mapping: Record<string, string>,
  source: string
): Transaction | null {
  // Extract date
  const dateStr = row[mapping.date];
  if (!dateStr) return null;
  
  const date = parseDate(dateStr);
  
  // Extract description/merchant
  const description = row[mapping.description] || '';
  const merchant_raw = extractMerchantFromDescription(description) || description;
  const merchant_canonical = getCanonicalName(merchant_raw);
  
  // Extract amount
  let amount = 0;
  
  if (mapping.amount) {
    amount = parseAmount(row[mapping.amount]);
  } else if (mapping.debit && mapping.credit) {
    const debit = parseAmount(row[mapping.debit]);
    const credit = parseAmount(row[mapping.credit]);
    
    if (debit !== 0) {
      amount = -Math.abs(debit); // Debits are negative
    } else if (credit !== 0) {
      amount = Math.abs(credit); // Credits are positive
    }
  }
  
  // Skip if amount is 0
  if (amount === 0) return null;
  
  // Extract currency
  const currency = row[mapping.currency] || 'GBP';
  
  return {
    id: generateId(),
    date,
    amount,
    currency,
    merchant_raw,
    merchant_canonical,
    description,
    source,
    // These will be filled in by categorizer
    category: 'Unknown',
    confidence: 0,
  };
}

/**
 * Parse date string to ISO format
 * Handles various date formats
 */
function parseDate(dateStr: string): string {
  if (!dateStr) throw new Error('Date is required');
  
  // Try various date formats
  const formats = [
    // DD/MM/YYYY
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,
    // DD/MM/YY
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/,
    // YYYY-MM-DD (ISO)
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    // MM/DD/YYYY (US format)
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,
  ];
  
  for (let i = 0; i < formats.length; i++) {
    const match = dateStr.trim().match(formats[i]);
    if (match) {
      let day: number, month: number, year: number;
      
      if (i === 0 || i === 1) {
        // DD/MM/YYYY or DD/MM/YY
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
        
        // Handle 2-digit years
        if (year < 100) {
          year += year < 50 ? 2000 : 1900;
        }
      } else if (i === 2) {
        // YYYY-MM-DD
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
      } else {
        // Ambiguous - assume DD/MM/YYYY for UK
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
      }
      
      // Create ISO date string
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
  }
  
  // Fallback: try native Date parsing
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  throw new Error(`Unable to parse date: ${dateStr}`);
}

/**
 * Parse amount string to number
 * Handles various formats (£1,234.56, -£100, etc)
 */
function parseAmount(amountStr: string | number): number {
  if (typeof amountStr === 'number') {
    return amountStr;
  }
  
  if (!amountStr) return 0;
  
  // Remove currency symbols and whitespace
  let cleaned = amountStr.toString().trim();
  cleaned = cleaned.replace(/[£$€,\s]/g, '');
  
  // Handle parentheses for negative (accounting format)
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  
  const amount = parseFloat(cleaned);
  
  if (isNaN(amount)) {
    throw new Error(`Unable to parse amount: ${amountStr}`);
  }
  
  return amount;
}

// PDF parsing is now handled by pdfParser.ts

/**
 * Merge multiple parsed statements
 */
export function mergeStatements(statements: ParsedStatement[]): ParsedStatement {
  const allTransactions: Transaction[] = [];
  
  for (const statement of statements) {
    allTransactions.push(...statement.transactions);
  }
  
  // Sort by date
  allTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Remove duplicates (same date, amount, merchant)
  const unique = allTransactions.filter((transaction, index, array) => {
    return array.findIndex(t =>
      t.date === transaction.date &&
      t.amount === transaction.amount &&
      t.merchant_canonical === transaction.merchant_canonical
    ) === index;
  });
  
  return {
    filename: `Merged (${statements.length} files)`,
    transactions: unique,
  };
}

/**
 * Validate parsed transactions
 */
export function validateTransactions(transactions: Transaction[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (transactions.length === 0) {
    errors.push('No transactions found');
  }
  
  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    
    if (!t.date) {
      errors.push(`Transaction ${i + 1}: Missing date`);
    }
    
    if (t.amount === 0) {
      errors.push(`Transaction ${i + 1}: Amount is zero`);
    }
    
    if (!t.merchant_raw && !t.description) {
      errors.push(`Transaction ${i + 1}: Missing merchant/description`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

