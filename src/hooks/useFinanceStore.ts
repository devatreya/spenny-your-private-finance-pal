import { useState, useCallback } from 'react';
import { Transaction, Category } from '@/lib/parser/schema';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export const useFinanceStore = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadTransactions = useCallback((txns: Transaction[]) => {
    setTransactions(txns);
    setIsLoaded(txns.length > 0);
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

    // Category spending query
    const categoryMatch = q.match(/(?:how much|spent|spend|spending).*(?:on|for)\s+(\w+)/i);
    if (categoryMatch) {
      const searchTerm = categoryMatch[1].toLowerCase();
      const filtered = transactions.filter(t => 
        t.category.toLowerCase().includes(searchTerm) || 
        t.merchant_canonical.toLowerCase().includes(searchTerm) ||
        t.merchant_raw.toLowerCase().includes(searchTerm) ||
        (t.description?.toLowerCase().includes(searchTerm))
      );
      const total = filtered
        .filter(t => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      if (filtered.length === 0) {
        return `I couldn't find any transactions matching "${searchTerm}".`;
      }
      
      return `You spent **£${total.toFixed(2)}** on ${searchTerm} across ${filtered.length} transaction(s).`;
    }

    // Subscriptions breakdown
    if (q.includes('subscription')) {
      const subs = transactions.filter(t => t.category === 'Subscriptions');
      if (subs.length === 0) {
        return "I couldn't find any subscription transactions.";
      }
      
      const total = subs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const breakdown = subs.map(s => `- ${s.merchant_canonical}: £${Math.abs(s.amount).toFixed(2)}`).join('\n');
      
      return `**Your Subscriptions (£${total.toFixed(2)} total):**\n\n${breakdown}`;
    }

    // Total spending
    if (q.includes('total') && (q.includes('spent') || q.includes('spending'))) {
      const total = transactions
        .filter(t => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      return `Your total spending is **£${total.toFixed(2)}** across ${transactions.filter(t => t.amount < 0).length} transactions.`;
    }

    // Category breakdown
    if (q.includes('breakdown') || q.includes('categories') || q.includes('summary')) {
      const byCategory: Record<string, number> = {};
      transactions.filter(t => t.amount < 0).forEach(t => {
        byCategory[t.category] = (byCategory[t.category] || 0) + Math.abs(t.amount);
      });
      
      const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
      const breakdown = sorted.map(([cat, amt]) => `- **${cat}:** £${amt.toFixed(2)}`).join('\n');
      const total = sorted.reduce((sum, [, amt]) => sum + amt, 0);
      
      return `**Spending Breakdown (£${total.toFixed(2)} total):**\n\n${breakdown}`;
    }

    // Largest transactions
    if (q.includes('largest') || q.includes('biggest') || q.includes('highest')) {
      const sorted = [...transactions]
        .filter(t => t.amount < 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 5);
      const list = sorted.map((t, i) => 
        `${i + 1}. ${t.merchant_canonical}: £${Math.abs(t.amount).toFixed(2)} (${t.date})`
      ).join('\n');
      
      return `**Your 5 Largest Transactions:**\n\n${list}`;
    }

    // Income
    if (q.includes('income') || q.includes('earned') || q.includes('received')) {
      const income = transactions.filter(t => t.amount > 0);
      const total = income.reduce((sum, t) => sum + t.amount, 0);
      
      if (income.length === 0) {
        return "I couldn't find any income transactions.";
      }
      
      return `**Total Income:** £${total.toFixed(2)} across ${income.length} transaction(s).`;
    }

    // Merchant-specific
    const merchants = [...new Set(transactions.map(t => t.merchant_canonical))];
    for (const merchant of merchants) {
      if (q.includes(merchant.toLowerCase())) {
        const filtered = transactions.filter(t => 
          t.merchant_canonical.toLowerCase() === merchant.toLowerCase()
        );
        const total = filtered.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        return `You had **${filtered.length} transaction(s)** with ${merchant}, totaling **£${total.toFixed(2)}**.`;
      }
    }

    return "I can help you analyze your spending! Try asking:\n- \"How much did I spend on Uber?\"\n- \"Give me a breakdown of my spending\"\n- \"What are my subscriptions?\"\n- \"What were my largest transactions?\"\n- \"How much income did I receive?\"";
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
