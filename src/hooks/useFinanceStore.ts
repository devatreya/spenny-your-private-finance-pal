import { useState, useCallback } from 'react';
import { Transaction, ChatMessage } from '@/types/finance';

// Simple category detection based on keywords
const categorizeTransaction = (description: string): string => {
  const desc = description.toLowerCase();
  
  if (desc.includes('uber') || desc.includes('lyft') || desc.includes('bolt')) return 'Transport';
  if (desc.includes('netflix') || desc.includes('spotify') || desc.includes('disney') || desc.includes('hbo') || desc.includes('subscription')) return 'Subscriptions';
  if (desc.includes('amazon') || desc.includes('ebay') || desc.includes('shop')) return 'Shopping';
  if (desc.includes('restaurant') || desc.includes('cafe') || desc.includes('coffee') || desc.includes('starbucks') || desc.includes('mcdonald')) return 'Food & Dining';
  if (desc.includes('grocery') || desc.includes('walmart') || desc.includes('target') || desc.includes('supermarket')) return 'Groceries';
  if (desc.includes('gas') || desc.includes('fuel') || desc.includes('shell') || desc.includes('chevron')) return 'Fuel';
  if (desc.includes('rent') || desc.includes('mortgage')) return 'Housing';
  if (desc.includes('electric') || desc.includes('water') || desc.includes('utility') || desc.includes('internet')) return 'Utilities';
  if (desc.includes('gym') || desc.includes('fitness')) return 'Health & Fitness';
  if (desc.includes('pharmacy') || desc.includes('doctor') || desc.includes('hospital')) return 'Healthcare';
  if (desc.includes('salary') || desc.includes('payroll') || desc.includes('income')) return 'Income';
  if (desc.includes('transfer')) return 'Transfer';
  
  return 'Other';
};

const parseCSV = (content: string): Transaction[] => {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  
  const transactions: Transaction[] = [];
  
  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Simple CSV parsing (handles basic cases)
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
    
    if (parts.length >= 3) {
      const amount = parseFloat(parts[2]?.replace(/[^0-9.-]/g, '') || '0');
      const transaction: Transaction = {
        id: `txn-${i}-${Date.now()}`,
        date: parts[0] || '',
        description: parts[1] || '',
        amount: Math.abs(amount),
        category: categorizeTransaction(parts[1] || ''),
        type: amount < 0 ? 'debit' : 'credit',
      };
      transactions.push(transaction);
    }
  }
  
  return transactions;
};

export const useFinanceStore = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadTransactions = useCallback((fileContent: string) => {
    const parsed = parseCSV(fileContent);
    setTransactions(parsed);
    setIsLoaded(parsed.length > 0);
    return parsed.length;
  }, []);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, message]);
    return message;
  }, []);

  const analyzeQuery = useCallback((query: string): string => {
    const q = query.toLowerCase();
    
    if (transactions.length === 0) {
      return "I don't have any transaction data loaded yet. Please upload your bank statement first.";
    }

    // Category spending
    const categoryMatch = q.match(/(?:how much|spent|spend|spending).*(?:on|for)\s+(\w+)/i);
    if (categoryMatch) {
      const searchTerm = categoryMatch[1].toLowerCase();
      const filtered = transactions.filter(t => 
        t.category.toLowerCase().includes(searchTerm) || 
        t.description.toLowerCase().includes(searchTerm)
      );
      const total = filtered.filter(t => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0);
      
      if (filtered.length === 0) {
        return `I couldn't find any transactions matching "${searchTerm}".`;
      }
      
      return `You spent **$${total.toFixed(2)}** on ${searchTerm} across ${filtered.length} transaction(s).`;
    }

    // Subscriptions breakdown
    if (q.includes('subscription')) {
      const subs = transactions.filter(t => t.category === 'Subscriptions');
      if (subs.length === 0) {
        return "I couldn't find any subscription transactions.";
      }
      
      const total = subs.reduce((sum, t) => sum + t.amount, 0);
      const breakdown = subs.map(s => `- ${s.description}: $${s.amount.toFixed(2)}`).join('\n');
      
      return `**Your Subscriptions ($${total.toFixed(2)} total):**\n\n${breakdown}`;
    }

    // Total spending
    if (q.includes('total') && (q.includes('spent') || q.includes('spending'))) {
      const total = transactions.filter(t => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0);
      return `Your total spending is **$${total.toFixed(2)}** across ${transactions.filter(t => t.type === 'debit').length} transactions.`;
    }

    // Category breakdown
    if (q.includes('breakdown') || q.includes('categories') || q.includes('summary')) {
      const byCategory: Record<string, number> = {};
      transactions.filter(t => t.type === 'debit').forEach(t => {
        byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
      });
      
      const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
      const breakdown = sorted.map(([cat, amt]) => `- **${cat}:** $${amt.toFixed(2)}`).join('\n');
      const total = sorted.reduce((sum, [, amt]) => sum + amt, 0);
      
      return `**Spending Breakdown ($${total.toFixed(2)} total):**\n\n${breakdown}`;
    }

    // Largest transactions
    if (q.includes('largest') || q.includes('biggest') || q.includes('highest')) {
      const sorted = [...transactions].filter(t => t.type === 'debit').sort((a, b) => b.amount - a.amount).slice(0, 5);
      const list = sorted.map((t, i) => `${i + 1}. ${t.description}: $${t.amount.toFixed(2)}`).join('\n');
      
      return `**Your 5 Largest Transactions:**\n\n${list}`;
    }

    return "I can help you analyze your spending! Try asking:\n- \"How much did I spend on Uber?\"\n- \"Give me a breakdown of my spending\"\n- \"What are my subscriptions?\"\n- \"What were my largest transactions?\"";
  }, [transactions]);

  const clearData = useCallback(() => {
    setTransactions([]);
    setMessages([]);
    setIsLoaded(false);
  }, []);

  return {
    transactions,
    messages,
    isLoaded,
    loadTransactions,
    addMessage,
    analyzeQuery,
    clearData,
  };
};
