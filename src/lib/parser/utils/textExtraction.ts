/**
 * textExtraction.ts
 * Helper functions for extracting text from PDF files using pdf.js
 */

import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker - must match installed pdfjs-dist version
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PDFPage {
  pageNumber: number;
  text: string;
  lines: string[];
}

export interface PDFDocument {
  pages: PDFPage[];
  fullText: string;
  metadata?: any;
}

/**
 * Extract text from PDF file
 */
export async function extractTextFromPDF(file: File): Promise<PDFDocument> {
  try {
    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const pages: PDFPage[] = [];
    let fullText = '';
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Combine text items into lines
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      // Split into lines
      const lines = reconstructLines(textContent.items);
      
      pages.push({
        pageNumber: pageNum,
        text: pageText,
        lines,
      });
      
      fullText += pageText + '\n\n';
    }
    
    // Get metadata
    const metadata = await pdf.getMetadata();
    
    return {
      pages,
      fullText,
      metadata: metadata.info,
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Reconstruct lines from PDF text items using X + Y positions.
 * - Groups items into lines using Y (dynamic threshold).
 * - Within a line, uses X gap + item width to decide whether to insert spaces.
 */
function reconstructLines(items: any[]): string[] {
  if (!items || items.length === 0) return [];

  // Helper accessors
  const getY = (item: any) => item.transform?.[5] ?? 0;
  const getX = (item: any) => item.transform?.[4] ?? 0;

  // Sort top→bottom, then left→right
  const sorted = [...items].sort((a, b) => {
    const ay = getY(a);
    const by = getY(b);
    const dy = ay - by;
    // If Y is clearly different, use that
    if (Math.abs(dy) > 2) {
      return dy;
    }
    // Otherwise, order by X
    const ax = getX(a);
    const bx = getX(b);
    return ax - bx;
  });

  // Derive a dynamic line-height threshold from Y deltas
  const yValues = sorted.map(getY);
  const deltas: number[] = [];
  for (let i = 1; i < yValues.length; i++) {
    const d = Math.abs(yValues[i] - yValues[i - 1]);
    if (d > 0.1) {
      deltas.push(d);
    }
  }

  let lineHeightThreshold = 5; // fallback
  if (deltas.length > 0) {
    const sortedDeltas = [...deltas].sort((a, b) => a - b);
    const median = sortedDeltas[Math.floor(sortedDeltas.length / 2)];
    // Be generous but still distinguish lines vs jitter
    lineHeightThreshold = Math.max(3, median / 2);
  }

  const lines: string[] = [];
  let currentLineItems: any[] = [];
  let currentY = getY(sorted[0]);

  for (const item of sorted) {
    const itemY = getY(item);
    if (Math.abs(itemY - currentY) > lineHeightThreshold) {
      // Flush previous line
      if (currentLineItems.length > 0) {
        const rawLine = joinItemsOnLine(currentLineItems);
        const normalized = normalizeCharacterSpacing(rawLine);
        if (normalized.trim()) {
          lines.push(normalized.trim());
        }
      }
      currentLineItems = [item];
      currentY = itemY;
    } else {
      currentLineItems.push(item);
    }
  }

  // Last line
  if (currentLineItems.length > 0) {
    const rawLine = joinItemsOnLine(currentLineItems);
    const normalized = normalizeCharacterSpacing(rawLine);
    if (normalized.trim()) {
      lines.push(normalized.trim());
    }
  }

  return lines;
}

/**
 * Join items that are on the same visual line.
 * Uses X gap and item width to decide whether a space is needed.
 */
function joinItemsOnLine(lineItems: any[]): string {
  if (!lineItems.length) return '';

  const getX = (item: any) => item.transform?.[4] ?? 0;

  // Left→right within the line
  const sorted = [...lineItems].sort((a, b) => getX(a) - getX(b));

  let line = '';
  let prevX: number | null = null;
  let prevWidth: number | null = null;

  // Running estimate of character width for this line
  let totalCharWidth = 0;
  let totalChars = 0;

  for (const item of sorted) {
    const text: string = item.str ?? '';
    if (!text) continue;

    const x = getX(item);
    let width: number | undefined = typeof item.width === 'number' ? item.width : undefined;

    if (!width && typeof item.transform?.[0] === 'number') {
      // Rough fallback: scale * characters
      width = Math.abs(item.transform[0]) * Math.max(text.length, 1);
    }

    // Update average char width
    if (width && text.length > 0) {
      totalCharWidth += width;
      totalChars += text.length;
    }

    const avgCharWidth = totalChars > 0 ? totalCharWidth / totalChars : 0;

    if (prevX !== null && prevWidth !== null) {
      const gap = x - (prevX + prevWidth);
      // Decide if this is a real word boundary
      // If the gap is bigger than ~0.8 * avgCharWidth, treat it as a space
      const spaceThreshold = avgCharWidth > 0 ? avgCharWidth * 0.8 : 2;
      if (gap > spaceThreshold) {
        line += ' ';
      }
      // Else: same word/continuous characters → no space
    }

    line += text;
    prevX = x;
    prevWidth = width ?? (avgCharWidth > 0 ? avgCharWidth * text.length : text.length * 3);
  }

  return line;
}

/**
 * Normalize lines where text has been extracted as spaced-out characters:
 * e.g. "P a y m e n t" -> "Payment"
 *
 * Heuristic:
 * - If >40% of tokens are single characters, we treat sequences of single-char
 *   tokens as one word.
 */
function normalizeCharacterSpacing(line: string): string {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return line;

  const singleCharTokens = tokens.filter(t => t.length === 1);
  const singleCharRatio = singleCharTokens.length / tokens.length;

  // Only touch lines that *look* like they suffered char-level splitting
  if (singleCharRatio < 0.4) {
    return line;
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
 * Clean extracted text
 * Remove extra whitespace, normalize characters
 * Note: Preserves line breaks (\n) while collapsing spaces/tabs
 */
export function cleanExtractedText(text: string): string {
  return text
    // Normalize spaces and tabs (but NOT newlines)
    .replace(/[ \t]+/g, ' ')
    // Remove special PDF characters (but keep newlines)
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    // Trim each line
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');
}

/**
 * Split text into table-like structure
 * Useful for extracting transaction tables
 */
export function extractTableRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  
  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Split by multiple spaces (common in PDF tables)
    const columns = line
      .split(/\s{2,}/)
      .map(col => col.trim())
      .filter(col => col.length > 0);
    
    if (columns.length > 0) {
      rows.push(columns);
    }
  }
  
  return rows;
}

/**
 * Find transaction table boundaries in text
 * Returns start and end line indices
 */
export function findTransactionTableBoundaries(lines: string[]): {
  start: number;
  end: number;
} | null {
  // Look for common header patterns
  const headerPatterns = [
    /date.*description.*amount/i,
    /date.*details.*debit.*credit/i,
    /transaction date.*merchant.*value/i,
    /posting date.*description.*amount/i,
  ];
  
  let start = -1;
  
  // Find start of transaction table
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (headerPatterns.some(pattern => pattern.test(line))) {
      start = i + 1; // Start from next line after header
      break;
    }
  }
  
  if (start === -1) return null;
  
  // Find end of transaction table
  // Usually ends with "Total", "Balance", or page break
  let end = lines.length;
  const endPatterns = [
    /^total/i,
    /^balance/i,
    /^subtotal/i,
    /^page \d+/i,
    /^statement period/i,
  ];
  
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (endPatterns.some(pattern => pattern.test(line))) {
      end = i;
      break;
    }
    
    // Also stop if we hit too many consecutive blank/short lines
    if (line.length < 5) {
      let blankCount = 1;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].trim().length < 5) blankCount++;
      }
      if (blankCount >= 3) {
        end = i;
        break;
      }
    }
  }
  
  return { start, end };
}

/**
 * Detect if a line looks like a transaction
 */
export function looksLikeTransaction(line: string): boolean {
  // Should have date-like pattern and amount-like pattern
  const hasDate = /\d{1,2}[\/\-\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2})/i.test(line);
  const hasAmount = /[£$€]?\s*\d+[,.]?\d*\.?\d{0,2}/.test(line);
  
  return hasDate && hasAmount;
}

/**
 * Extract multiple transaction tables from document
 * (Some PDFs have transactions across multiple pages)
 */
export function extractAllTransactionTables(pages: PDFPage[]): string[][] {
  const allRows: string[][] = [];
  
  for (const page of pages) {
    const boundaries = findTransactionTableBoundaries(page.lines);
    
    if (boundaries) {
      const tableLines = page.lines.slice(boundaries.start, boundaries.end);
      const rows = tableLines.filter(line => looksLikeTransaction(line));
      
      allRows.push(...rows.map(line => [line])); // Wrap each line as a row
    }
  }
  
  return allRows;
}

/**
 * Detect PDF bank statement format
 */
export function detectBankFormat(text: string): string {
  const lower = text.toLowerCase();
  
  if (lower.includes('barclays')) return 'barclays';
  if (lower.includes('hsbc')) return 'hsbc';
  if (lower.includes('lloyds')) return 'lloyds';
  if (lower.includes('natwest') || lower.includes('royal bank')) return 'natwest';
  if (lower.includes('santander')) return 'santander';
  if (lower.includes('monzo')) return 'monzo';
  if (lower.includes('revolut')) return 'revolut';
  if (lower.includes('amex') || lower.includes('american express')) return 'amex';
  
  return 'generic';
}

