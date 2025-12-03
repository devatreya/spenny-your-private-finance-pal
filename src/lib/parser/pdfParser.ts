/**
 * pdfParser.ts
 * Extracts structured transactions from PDF bank statements
 */

import { Transaction, ParsedStatement } from './schema';
import { getCanonicalName, extractMerchantFromDescription } from './utils/merchantTools';
import {
  extractTextFromPDF,
  PDFDocument,
  detectBankFormat,
  looksLikeTransaction,
  findTransactionTableBoundaries,
} from './utils/textExtraction';

// Simple UUID generator
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Main entry point - parse PDF file
 */
export async function parsePDF(file: File, filename: string): Promise<ParsedStatement> {
  try {
    // Extract text from PDF
    const pdfDoc = await extractTextFromPDF(file);
    
    // Detect bank format
    const bankFormat = detectBankFormat(pdfDoc.fullText);
    
    console.log(`Detected bank format: ${bankFormat}`);
    
    // Extract transactions based on format
    const transactions = await extractTransactionsFromPDF(pdfDoc, bankFormat);
    
    if (transactions.length === 0) {
      throw new Error('No transactions found in PDF. Please ensure it\'s a valid bank statement.');
    }
    
    return {
      filename,
      transactions,
      metadata: {
        currency: 'GBP', // Default, can be detected from PDF
      },
    };
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract transactions from PDF document
 */
async function extractTransactionsFromPDF(
  pdfDoc: PDFDocument,
  bankFormat: string
): Promise<Transaction[]> {
  // Try format-specific parser first
  switch (bankFormat) {
    case 'barclays':
      return parseBarclaysFormat(pdfDoc);
    case 'hsbc':
      return parseHSBCFormat(pdfDoc);
    case 'lloyds':
      return parseLloydsFormat(pdfDoc);
    case 'amex':
      return parseAmexFormat(pdfDoc);
    case 'monzo':
    case 'revolut':
      return parseDigitalBankFormat(pdfDoc);
    default:
      return parseGenericFormat(pdfDoc);
  }
}

/**
 * Generic PDF parser - works with most bank statement formats
 */
function parseGenericFormat(pdfDoc: PDFDocument): Transaction[] {
  const transactions: Transaction[] = [];
  
  for (const page of pdfDoc.pages) {
    // Find transaction table boundaries
    const boundaries = findTransactionTableBoundaries(page.lines);
    
    if (!boundaries) continue;
    
    // Extract transaction lines
    const transactionLines = page.lines.slice(boundaries.start, boundaries.end);
    
    for (const line of transactionLines) {
      if (!looksLikeTransaction(line)) continue;
      
      try {
        const transaction = parseGenericTransactionLine(line);
        if (transaction) {
          transactions.push(transaction);
        }
      } catch (error) {
        console.warn('Failed to parse line:', line, error);
        // Continue with next line
      }
    }
  }
  
  return transactions;
}

/**
 * Parse a generic transaction line
 * Attempts to extract: date, description, amount
 */
function parseGenericTransactionLine(line: string): Transaction | null {
  // Common patterns for transaction lines:
  // "01 Sep TESCO STORES -12.95"
  // "15/09/2024 Amazon.co.uk 29.99"
  // "2024-09-01 SHELL FUEL STATION -45.20 100.00" (with balance)
  
  // Try multiple regex patterns
  const patterns = [
    // DD MMM DESCRIPTION AMOUNT
    /^(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\s+(.+?)\s+([-£$€]?\s*\d+[,.]?\d*\.?\d{0,2})\s*$/i,
    
    // DD/MM/YYYY DESCRIPTION AMOUNT
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+([-£$€]?\s*\d+[,.]?\d*\.?\d{0,2})\s*$/,
    
    // YYYY-MM-DD DESCRIPTION AMOUNT BALANCE
    /^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-£$€]?\s*\d+[,.]?\d*\.?\d{0,2})\s+\d+[,.]?\d*\.?\d{0,2}\s*$/,
    
    // DD MMM YYYY DESCRIPTION AMOUNT
    /^(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})\s+(.+?)\s+([-£$€]?\s*\d+[,.]?\d*\.?\d{0,2})\s*$/i,
  ];
  
  for (const pattern of patterns) {
    const match = line.match(pattern);
    
    if (match) {
      const [, dateStr, description, amountStr] = match;
      
      try {
        const date = parseFlexibleDate(dateStr);
        const amount = parseAmount(amountStr);
        const merchant_raw = extractMerchantFromDescription(description) || description;
        const merchant_canonical = getCanonicalName(merchant_raw);
        
        return {
          id: generateId(),
          date,
          amount,
          currency: 'GBP',
          merchant_raw,
          merchant_canonical,
          description: description.trim(),
          category: 'Unknown',
          confidence: 0,
        };
      } catch (error) {
        console.warn('Failed to parse matched line:', error);
        continue;
      }
    }
  }
  
  return null;
}

// ============================================================================
// HSBC-specific helpers
// ============================================================================

/**
 * HSBC-specific line normalisation.
 * - Collapses spaced-out characters: "2 3 J u l" -> "23 Jul"
 * - Collapses multiple spaces.
 */
function normalizeHsbcLine(line: string): string {
  // First pass: collapse multiple spaces to single
  let normalized = line.replace(/\s+/g, ' ').trim();

  // Second pass: similar to normalizeCharacterSpacing but local to HSBC
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return normalized;

  const singleCharTokens = tokens.filter(t => t.length === 1);
  const singleCharRatio = singleCharTokens.length / tokens.length;

  if (singleCharRatio < 0.4) {
    // Looks like normal text; keep as-is
    return normalized;
  }

  const result: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      result.push(buffer[0]);
    } else {
      result.push(buffer.join(''));
    }
    buffer = [];
  };

  for (const token of tokens) {
    if (token.length === 1 && /[A-Za-z0-9]/.test(token)) {
      buffer.push(token);
    } else {
      flushBuffer();
      result.push(token);
    }
  }

  flushBuffer();

  return result.join(' ');
}

/**
 * Regex for HSBC date format: DD MMM YY or DD MMM YYYY
 */
const HSBC_DATE_REGEX = /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{2,4})/i;

/**
 * Check if a line starts with an HSBC-style date (after normalization)
 */
function hsbcLineStartsWithDate(rawLine: string): RegExpMatchArray | null {
  const normalized = normalizeHsbcLine(rawLine);
  return normalized.match(HSBC_DATE_REGEX);
}

// ============================================================================
// Bank-specific parsers
// ============================================================================

/**
 * Barclays-specific parser
 */
function parseBarclaysFormat(pdfDoc: PDFDocument): Transaction[] {
  // Barclays format typically:
  // "01 Sep TESCO STORES 1234 -12.95"
  return parseGenericFormat(pdfDoc); // Use generic for now, can be specialized
}

/**
 * HSBC-specific parser
 * Handles HSBC's multi-line transaction format:
 * Line 1: Date + payment type + merchant name
 * Line 2: Additional details + amount
 * 
 * Now uses normalizeHsbcLine() to handle spaced-out characters.
 */
function parseHSBCFormat(pdfDoc: PDFDocument): Transaction[] {
  const transactions: Transaction[] = [];
  
  console.log('=== HSBC PDF Parser Debug ===');
  console.log('Total pages:', pdfDoc.pages.length);
  
  for (const page of pdfDoc.pages) {
    const lines = page.lines;
    console.log(`Page ${page.pageNumber} has ${lines.length} lines`);
    
    // DEBUG: On page 1, dump ALL lines to understand the structure
    if (page.pageNumber === 1) {
      console.log(`=== FULL DUMP OF ALL ${lines.length} LINES ON PAGE 1 ===`);
      for (let i = 0; i < lines.length; i++) {
        const normalizedLine = normalizeHsbcLine(lines[i]);
        console.log(`  [${i.toString().padStart(2, '0')}]: "${normalizedLine}"`);
      }
      console.log(`=== END FULL DUMP ===`);
    }
    
    // Find transaction table start
    let startIndex = -1;
    
    // Search through ALL lines to find transaction table
    console.log(`Searching all ${lines.length} lines on page ${page.pageNumber} for transaction header...`);
    
    // Look for "Your Bank Account" or transaction column headers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const normalizedLine = normalizeHsbcLine(line);
      const lineLower = normalizedLine.toLowerCase();
      
      // Log lines that might be headers
      if (lineLower.includes('account') || lineLower.includes('date')) {
        console.log(`Line ${i} (potential header): "${normalizedLine}"`);
      }
      
      // Check for HSBC transaction table indicators
      if (lineLower.includes('your bank account') || 
          lineLower.includes('your business banking account')) {
        console.log(`Found "Your Bank Account" at line ${i}`);
        // Check previous lines (header might be before "Your Bank Account")
        for (let j = Math.max(0, i - 10); j < i; j++) {
          const headerNormalized = normalizeHsbcLine(lines[j]).toLowerCase();
          if (headerNormalized.includes('date') && 
              (headerNormalized.includes('paid out') || headerNormalized.includes('paidout'))) {
            console.log(`✅ Found column headers at line ${j}: "${normalizeHsbcLine(lines[j])}"`);
            startIndex = j + 1; // Start from line after headers
            break;
          }
        }
        if (startIndex !== -1) break;
      }
      
      // Alternative: Look directly for the column header line with "Date" and "Paid out"
      if (lineLower.includes('date') && 
          (lineLower.includes('paid out') || lineLower.includes('paidout'))) {
        console.log(`✅ Found column header directly at line ${i}: "${normalizedLine}"`);
        startIndex = i + 1;
        break;
      }
    }
    
    // HSBC PDFs have a quirk: the header appears AFTER the transactions in the line array
    // because PDF.js sorts by Y coordinate (bottom of page first).
    // So we need to search BEFORE the header, not after it.
    
    let searchStartIndex = 0;
    let searchEndIndex = lines.length;
    
    if (startIndex !== -1) {
      // Header found - transactions are BEFORE it in the array
      searchEndIndex = startIndex;
      console.log(`✅ Found header at line ${startIndex}, searching lines 0-${startIndex - 1} for transactions`);
    } else {
      // No header found - search all lines
      console.log('⚠️ No header found, searching all lines for transactions');
    }
    
    // DEBUG: Show transaction-candidate lines (those with dates)
    console.log(`Lines with dates on page ${page.pageNumber} (searching lines ${searchStartIndex}-${searchEndIndex - 1}):`);
    for (let debug = searchStartIndex; debug < searchEndIndex; debug++) {
      if (hsbcLineStartsWithDate(lines[debug])) {
        console.log(`  📅 Line ${debug}: "${normalizeHsbcLine(lines[debug])}"`);
      }
    }
    
    // First, collect all date positions to determine transaction dates
    const datePositions: { index: number; date: string }[] = [];
    for (let d = searchStartIndex; d < searchEndIndex; d++) {
      const dateMatch = hsbcLineStartsWithDate(lines[d]);
      if (dateMatch && !normalizeHsbcLine(lines[d]).toLowerCase().includes(' to ')) {
        datePositions.push({ index: d, date: dateMatch[0] });
      }
    }
    console.log(`Found ${datePositions.length} date markers on page ${page.pageNumber}`);
    
    // Helper to find the applicable date for a given line index
    const getDateForIndex = (idx: number): string | null => {
      // Find the nearest date at or after this index (since array is reversed)
      for (const dp of datePositions) {
        if (dp.index >= idx) {
          return dp.date;
        }
      }
      // If no date found after, use the last known date
      return datePositions.length > 0 ? datePositions[datePositions.length - 1].date : null;
    };
    
    // Parse transactions - look for lines with amounts AND nearby merchant info
    let i = searchStartIndex;
    
    while (i < searchEndIndex) {
      const rawLine = lines[i];
      const normalizedLine = normalizeHsbcLine(rawLine);
      
      // Check if line starts with a date (DD MMM YY or DD MMM YYYY)
      // Skip lines that contain "to" (these are date ranges like "24 July to 23 August")
      const dateMatch = normalizedLine.match(HSBC_DATE_REGEX);
      
      if (dateMatch && !normalizedLine.toLowerCase().includes(' to ')) {
        console.log(`✅ Found transaction at line ${i}: Date="${dateMatch[0]}", Line="${normalizedLine}"`);
        try {
          // This is a transaction start
          const dateStr = dateMatch[0]; // Use full date match for parsing
          
          // Extract merchant from current line (after date)
          let merchantLine = normalizedLine.substring(dateMatch[0].length).trim();
          // Remove payment type indicators like "))", "(((" etc
          merchantLine = merchantLine.replace(/^[\)\(]{2,}\s*/, '');
          
          let description = merchantLine;
          let amount = 0;
          let foundAmount = false;
          let isCredit = false;
          
          // Check if amount is on current line
          // HSBC format: "£ Paid out" (debit) and "£ Paid in" (credit) columns
          const amountMatch = normalizedLine.match(/([\d,]+\.\d{2})\s*$/);
          if (amountMatch) {
            const beforeAmount = normalizedLine.substring(0, normalizedLine.lastIndexOf(amountMatch[0]));
            const lower = beforeAmount.toLowerCase();
            
            // Prefer semantic hints over brittle column counting
            if (lower.includes('paid in') || lower.includes('credit')) {
              isCredit = true;
            } else if (lower.includes('paid out') || lower.includes('debit')) {
              isCredit = false;
            } else {
              // Fallback: rough column check using runs of 2+ spaces in the *raw* line
              const rawBeforeAmount = rawLine.substring(0, rawLine.lastIndexOf(amountMatch[0]));
              const columnCount = rawBeforeAmount.split(/\s{2,}/).length;
              isCredit = columnCount >= 3;
            }
            
            amount = isCredit ? parseAmount(amountMatch[1]) : -parseAmount(amountMatch[1]);
            foundAmount = true;
            // Remove amount from description
            description = merchantLine.replace(amountMatch[0], '').trim();
          }
          
          // HSBC PDFs have amounts on lines BEFORE the merchant (lower index)
          // Look BACKWARD for the amount line
          if (!foundAmount) {
            let j = i - 1;
            while (j >= searchStartIndex && j > i - 5) { // Look back max 5 lines
              const prevRawLine = lines[j];
              const prevLine = normalizeHsbcLine(prevRawLine);
              
              // Stop if we hit another date (different transaction)
              if (hsbcLineStartsWithDate(prevRawLine)) {
                break;
              }
              
              // Stop at summary lines
              const prevLower = prevLine.toLowerCase();
              if (prevLower.includes('balance brought forward') ||
                  prevLower.includes('balance carried forward') ||
                  prevLower.includes('total')) {
                break;
              }
              
              // Check if this line has an amount (format: "LOCATION 12.34" or "LOCATION 12.34 567.89")
              const prevAmountMatch = prevLine.match(/([\d,]+\.\d{2})(?:\s+[\d,]+\.\d{2})?\s*$/);
              if (prevAmountMatch) {
                // Extract just the first amount (paid out), ignore balance
                const amountStr = prevAmountMatch[1];
                amount = -parseAmount(amountStr); // Assume debit (paid out) for HSBC
                foundAmount = true;
                
                // Add location to description
                const locationText = prevLine.replace(prevAmountMatch[0], '').trim();
                if (locationText && locationText.length > 1) {
                  description += ' (' + locationText + ')';
                }
                
                console.log(`  📍 Found amount on line ${j}: ${amount} from "${prevLine}"`);
                break;
              }
              
              j--;
            }
          }
          
          // Also look FORWARD for any continuation lines (but not for amounts)
          let k = i + 1;
          while (k < searchEndIndex && k < i + 3) {
            const nextRawLine = lines[k];
            const nextLine = normalizeHsbcLine(nextRawLine);
            
            // Stop if we hit another date or amount line
            if (hsbcLineStartsWithDate(nextRawLine) || /[\d,]+\.\d{2}\s*$/.test(nextLine)) {
              break;
            }
            
            // Stop at summary lines
            const nextLower = nextLine.toLowerCase();
            if (nextLower.includes('balance') || nextLower.includes('total')) {
              break;
            }
            
            k++;
          }
          
          // Only create transaction if we found an amount
          if (foundAmount && Math.abs(amount) > 0) {
            const date = parseFlexibleDate(dateStr);
            const merchant_raw = description.trim();
            const merchant_canonical = getCanonicalName(merchant_raw);
            
            console.log(`✅ Created transaction: ${date} | ${merchant_canonical} | ${amount}`);
            
            transactions.push({
              id: generateId(),
              date,
              amount,
              currency: 'GBP',
              merchant_raw,
              merchant_canonical,
              description: merchant_raw,
              category: 'Unknown',
              confidence: 0,
            });
          } else {
            console.log(`⚠️ Skipped line ${i}: foundAmount=${foundAmount}, amount=${amount}`);
          }
          
          // Move to the next line
          i++;
        } catch (error) {
          console.warn('Failed to parse HSBC transaction at line', i, error);
          i++;
        }
      } else {
        // Check if this is a merchant-only line (no date) with an amount on the previous line
        // Common patterns: starts with ")))" (contactless), "VIS" (Visa), "CR" (credit), etc.
        const isMerchantLine = /^(\)\)\)|VIS\s|CR\s|DD\s|SO\s|TFR\s|ATM\s|CHQ\s)/i.test(normalizedLine);
        
        // Also check for billing/subscription lines like "APPLE.COM/BIL 2.99 926.78"
        // These have amount on the same line but no date prefix
        const isBillingLine = /\.(com|co\.uk)\/bil/i.test(normalizedLine);
        const hasAmountOnLine = /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/.test(normalizedLine);
        
        if (isBillingLine && hasAmountOnLine) {
          // Handle billing lines with amount on same line (e.g., "APPLE.COM/BIL 2.99 926.78")
          const applicableDate = getDateForIndex(i);
          
          if (applicableDate) {
            try {
              const date = parseFlexibleDate(applicableDate);
              // Extract amount - first number is the transaction, second is balance
              const amountMatch = normalizedLine.match(/([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/);
              if (amountMatch) {
                const amount = -parseAmount(amountMatch[1]); // Assume debit for billing
                const merchantPart = normalizedLine.replace(amountMatch[0], '').trim();
                const merchant_raw = merchantPart;
                const merchant_canonical = getCanonicalName(merchant_raw);
                
                console.log(`✅ Found billing transaction at line ${i}: ${date} | ${merchant_canonical} | ${amount}`);
                
                transactions.push({
                  id: generateId(),
                  date,
                  amount,
                  currency: 'GBP',
                  merchant_raw,
                  merchant_canonical,
                  description: merchant_raw,
                  category: 'Unknown',
                  confidence: 0,
                });
              }
            } catch (error) {
              console.warn('Failed to parse billing transaction at line', i, error);
            }
          }
        } else if (isMerchantLine) {
          // Look for amount on previous line
          const prevIndex = i - 1;
          if (prevIndex >= searchStartIndex) {
            const prevLine = normalizeHsbcLine(lines[prevIndex]);
            const prevAmountMatch = prevLine.match(/([\d,]+\.\d{2})(?:\s+[\d,]+\.\d{2})?\s*$/);
            
            if (prevAmountMatch) {
              // We found a merchant line with amount on previous line
              const applicableDate = getDateForIndex(i);
              
              if (applicableDate) {
                try {
                  const date = parseFlexibleDate(applicableDate);
                  const merchantLine = normalizedLine.replace(/^[\)\(]{2,}\s*/, '').trim();
                  const amount = -parseAmount(prevAmountMatch[1]); // Assume debit
                  
                  // Get location from the previous line
                  const locationText = prevLine.replace(prevAmountMatch[0], '').trim();
                  const description = locationText 
                    ? `${merchantLine} (${locationText})`
                    : merchantLine;
                  
                  const merchant_raw = merchantLine;
                  const merchant_canonical = getCanonicalName(merchant_raw);
                  
                  console.log(`✅ Found dateless transaction at line ${i}: ${date} | ${merchant_canonical} | ${amount}`);
                  
                  transactions.push({
                    id: generateId(),
                    date,
                    amount,
                    currency: 'GBP',
                    merchant_raw,
                    merchant_canonical,
                    description,
                    category: 'Unknown',
                    confidence: 0,
                  });
                } catch (error) {
                  console.warn('Failed to parse dateless transaction at line', i, error);
                }
              }
            }
          }
        }
        i++;
      }
    }
  }
  
  console.log(`=== HSBC Parser Complete: Found ${transactions.length} transactions ===`);
  return transactions;
}

/**
 * Lloyds-specific parser
 */
function parseLloydsFormat(pdfDoc: PDFDocument): Transaction[] {
  return parseGenericFormat(pdfDoc);
}

/**
 * American Express-specific parser
 */
function parseAmexFormat(pdfDoc: PDFDocument): Transaction[] {
  // Amex has a specific format with reference numbers
  return parseGenericFormat(pdfDoc);
}

/**
 * Digital bank (Monzo/Revolut) parser
 */
function parseDigitalBankFormat(pdfDoc: PDFDocument): Transaction[] {
  // Digital banks often have cleaner, more structured PDFs
  return parseGenericFormat(pdfDoc);
}

/**
 * Parse flexible date formats from PDF
 */
function parseFlexibleDate(dateStr: string): string {
  const cleaned = dateStr.trim();
  
  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  
  // DD MMM YYYY (4-digit year) - check first to avoid partial match
  const ddMmmYyyyMatch = cleaned.match(/^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (ddMmmYyyyMatch) {
    const day = parseInt(ddMmmYyyyMatch[1], 10);
    const monthName = ddMmmYyyyMatch[2].toLowerCase();
    const year = parseInt(ddMmmYyyyMatch[3], 10);
    const month = monthMap[monthName.substring(0, 3)];
    
    return new Date(year, month, day).toISOString().split('T')[0];
  }
  
  // DD MMM YY (2-digit year) - common in HSBC statements like "23 Jul 25"
  const ddMmmYyMatch = cleaned.match(/^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{2})(?:\s|$)/i);
  if (ddMmmYyMatch) {
    const day = parseInt(ddMmmYyMatch[1], 10);
    const monthName = ddMmmYyMatch[2].toLowerCase();
    let year = parseInt(ddMmmYyMatch[3], 10);
    const month = monthMap[monthName.substring(0, 3)];
    
    // Convert 2-digit year to 4-digit (assume 2000s for 00-50, 1900s for 51-99)
    year += year < 50 ? 2000 : 1900;
    
    return new Date(year, month, day).toISOString().split('T')[0];
  }
  
  // DD MMM (no year - assume current/recent year)
  const ddMmmMatch = cleaned.match(/^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s|$)/i);
  if (ddMmmMatch) {
    const day = parseInt(ddMmmMatch[1], 10);
    const monthName = ddMmmMatch[2].toLowerCase();
    const month = monthMap[monthName.substring(0, 3)];
    
    // Use current year, adjust if needed
    let year = new Date().getFullYear();
    const date = new Date(year, month, day);
    
    // If date is in future, use previous year
    if (date > new Date()) {
      year--;
    }
    
    return new Date(year, month, day).toISOString().split('T')[0];
  }
  
  // DD/MM/YYYY or DD-MM-YYYY
  const ddMmYyyyMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (ddMmYyyyMatch) {
    let day = parseInt(ddMmYyyyMatch[1], 10);
    let month = parseInt(ddMmYyyyMatch[2], 10);
    let year = parseInt(ddMmYyyyMatch[3], 10);
    
    // Handle 2-digit years
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    
    return new Date(year, month - 1, day).toISOString().split('T')[0];
  }
  
  // YYYY-MM-DD (ISO format)
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return cleaned; // Already in ISO format
  }
  
  // Fallback: try native parsing
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  throw new Error(`Unable to parse date: ${dateStr}`);
}

/**
 * Parse amount from PDF (handles various formats)
 */
function parseAmount(amountStr: string): number {
  let cleaned = amountStr.trim();
  
  // Remove currency symbols
  cleaned = cleaned.replace(/[£$€]/g, '');
  
  // Remove spaces
  cleaned = cleaned.replace(/\s/g, '');
  
  // Handle parentheses (negative in accounting format)
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  
  // Remove thousands separators
  cleaned = cleaned.replace(/,/g, '');
  
  // Parse
  const amount = parseFloat(cleaned);
  
  if (isNaN(amount)) {
    throw new Error(`Unable to parse amount: ${amountStr}`);
  }
  
  return amount;
}

/**
 * Validate parsed transactions
 */
export function validatePDFTransactions(transactions: Transaction[]): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  
  if (transactions.length === 0) {
    warnings.push('No transactions found');
  }
  
  // Check for common issues
  let consecutiveDuplicates = 0;
  for (let i = 1; i < transactions.length; i++) {
    const curr = transactions[i];
    const prev = transactions[i - 1];
    
    if (
      curr.date === prev.date &&
      curr.amount === prev.amount &&
      curr.merchant_canonical === prev.merchant_canonical
    ) {
      consecutiveDuplicates++;
    }
  }
  
  if (consecutiveDuplicates > 3) {
    warnings.push(`Found ${consecutiveDuplicates} potential duplicate transactions`);
  }
  
  // Check date ranges
  const dates = transactions.map(t => new Date(t.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const rangeMonths = (maxDate - minDate) / (1000 * 60 * 60 * 24 * 30);
  
  if (rangeMonths > 13) {
    warnings.push('Transaction range spans more than 13 months - verify accuracy');
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
  };
}

