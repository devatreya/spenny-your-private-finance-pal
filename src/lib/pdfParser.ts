import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export const parsePDF = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }
  
  return fullText;
};

// Extract transaction-like patterns from PDF text
export const extractTransactionsFromText = (text: string): string => {
  // Convert PDF text to CSV-like format for the existing parser
  const lines = text.split('\n').filter(line => line.trim());
  
  // Common date patterns
  const datePattern = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/;
  // Amount pattern (with currency symbols and commas)
  const amountPattern = /[\$£€]?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
  
  const csvLines: string[] = ['Date,Description,Amount'];
  
  for (const line of lines) {
    const dateMatch = line.match(datePattern);
    const amounts = line.match(amountPattern);
    
    if (dateMatch && amounts && amounts.length > 0) {
      const date = dateMatch[1];
      // Get the last amount (usually the transaction amount)
      const amount = amounts[amounts.length - 1].replace(/[\$£€,\s]/g, '');
      // Everything else is description
      let description = line
        .replace(datePattern, '')
        .replace(amountPattern, '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/,/g, ' '); // Remove commas from description for CSV
      
      if (description && amount) {
        csvLines.push(`${date},"${description}",${amount}`);
      }
    }
  }
  
  return csvLines.join('\n');
};
