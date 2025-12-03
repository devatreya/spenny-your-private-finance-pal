import { useState, useCallback, useMemo } from 'react';
import { Transaction, Category } from '@/lib/parser/schema';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Helper: Get date range from transactions
const getDateRange = (transactions: Transaction[]): { start: string; end: string } | null => {
  if (transactions.length === 0) return null;
  const dates = transactions.map(t => t.date).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
};

// Helper: Format date for display
const formatDateRange = (range: { start: string; end: string } | null): string => {
  if (!range) return 'your statement';
  const start = new Date(range.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const end = new Date(range.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} to ${end}`;
};

// Helper: Check if transaction is spending (Money Out)
const isSpending = (t: Transaction): boolean => t.amount < 0;

// Helper: Check if transaction is income (Money In)
const isIncome = (t: Transaction): boolean => t.amount > 0;

// Helper: Get absolute amount for display
const absAmount = (amount: number): number => Math.abs(amount);

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

  // Computed aggregates
  const aggregates = useMemo(() => {
    const spending = transactions.filter(isSpending);
    const income = transactions.filter(isIncome);
    const dateRange = getDateRange(transactions);
    
    // Services that are almost always subscriptions, even if they only appear once
    const strictSubscriptionKeywords = [
      'netflix', 'spotify', 'disney', 'amazon prime', 'apple tv', 'apple music',
      'youtube', 'hbo', 'paramount', 'hulu', 'audible', 'kindle',
      'voxi', 'ee', 'o2', 'three', 'vodafone', 'giffgaff', 'sky', 'virgin media', 'bt',
      'icloud', 'google one', 'dropbox', 'apple.com', 'uber one', 'pending.uber', 'ubr pending uber'
    ];

    // Generic / fuzzy names that could be one-offs – we do NOT automatically treat these as subscriptions
    const fuzzySubscriptionKeywords = [
      'puregym', 'gym', 'fitness',
      'adobe', 'microsoft',
      'notion', 'canva',
      'chatgpt', 'openai'
    ];

    // Things that should NEVER be treated as subscriptions, even if categorised badly
    const nonSubscriptionMerchantPatterns = [
      ' bp ',           // fuel station
      'bp petrol',
      'ticket machine', // LUL / station ticket machines
      'lul ticket',
      'blank street',   // coffee shop
      'starbucks',
      'pret ',
      'costa',
      'uber eats',
      'uber * eats',
      'eats pend',
      'deliveroo',
      'just eat'
    ];

    const subscriptionTxns = spending.filter(t => {
      const merchantLower = t.merchant_canonical.toLowerCase();
      const rawLower = t.merchant_raw.toLowerCase();
      const combined = ` ${merchantLower} ${rawLower} `; // leading/trailing space for patterns like " bp "

      // 0) Explicitly exclude obvious non-subscription merchants
      if (nonSubscriptionMerchantPatterns.some(p => combined.includes(p))) {
        return false;
      }

      // 1) If category is Subscriptions and not obviously excluded, treat as subscription
      if (t.category === 'Subscriptions') {
        return true;
      }

      // 2) Strict subscription merchants – treat as subscription even if they appear only once
      const matchesStrict = strictSubscriptionKeywords.some(
        kw => merchantLower.includes(kw) || rawLower.includes(kw)
      );
      if (matchesStrict) {
        return true;
      }

      // 3) Fuzzy keywords are *not* enough on their own in a single-month statement.
      //    We only rely on them if category is already Subscriptions (handled above).
      const matchesFuzzy = fuzzySubscriptionKeywords.some(
        kw => merchantLower.includes(kw) || rawLower.includes(kw)
      );
      if (matchesFuzzy) {
        return false;
      }

      // Anything else is not a subscription
      return false;
    });

    const uniqueSubscriptions = [...new Set(subscriptionTxns.map(t => t.merchant_canonical))];
    
    // Category totals (spending only)
    const byCategory: Record<string, { total: number; count: number }> = {};
    spending.forEach(t => {
      if (!byCategory[t.category]) {
        byCategory[t.category] = { total: 0, count: 0 };
      }
      byCategory[t.category].total += absAmount(t.amount);
      byCategory[t.category].count += 1;
    });

    return {
      totalSpending: spending.reduce((sum, t) => sum + absAmount(t.amount), 0),
      totalIncome: income.reduce((sum, t) => sum + t.amount, 0),
      spendingCount: spending.length,
      incomeCount: income.length,
      dateRange,
      subscriptionTxns,
      uniqueSubscriptions,
      subscriptionTotal: subscriptionTxns.reduce((sum, t) => sum + absAmount(t.amount), 0),
      byCategory,
    };
  }, [transactions]);

  const analyzeQuery = useCallback((query: string): string => {
    const q = query.toLowerCase();
    const dateRangeStr = formatDateRange(aggregates.dateRange);
    
    if (transactions.length === 0) {
      return "I don't have any transaction data loaded yet. Please upload your bank statement first.";
    }

    // ===== SUBSCRIPTIONS =====
    if (q.includes('subscription')) {
      const { subscriptionTxns, uniqueSubscriptions, subscriptionTotal } = aggregates;
      
      if (uniqueSubscriptions.length === 0) {
        return `**No subscriptions found**\n\nI couldn't find any subscription transactions in your data (${dateRangeStr}).`;
      }

      // "How many subscriptions do I have?" → count unique services
      if (q.includes('how many')) {
        const breakdown = uniqueSubscriptions.map(name => {
          const txns = subscriptionTxns.filter(t => t.merchant_canonical === name);
          const total = txns.reduce((sum, t) => sum + absAmount(t.amount), 0);
          return `- **${name}**: £${total.toFixed(2)} (${txns.length} payment${txns.length > 1 ? 's' : ''})`;
        }).join('\n');

        return `**You have ${uniqueSubscriptions.length} subscription service${uniqueSubscriptions.length > 1 ? 's' : ''}**\n\n${breakdown}\n\n**Total:** £${subscriptionTotal.toFixed(2)}\n\n_Based on Money Out transactions from ${dateRangeStr}_`;
      }

      // General subscription query
      const breakdown = uniqueSubscriptions.map(name => {
        const txns = subscriptionTxns.filter(t => t.merchant_canonical === name);
        const total = txns.reduce((sum, t) => sum + absAmount(t.amount), 0);
        return `- **${name}**: £${total.toFixed(2)}`;
      }).join('\n');

      return `**Your Subscriptions (${uniqueSubscriptions.length} services, £${subscriptionTotal.toFixed(2)} total)**\n\n${breakdown}\n\n_Based on Money Out transactions from ${dateRangeStr}_`;
    }

    // ===== TOTAL SPENDING =====
    if (q.includes('total') && (q.includes('spent') || q.includes('spending') || q.includes('spend'))) {
      return `**Total Spending: £${aggregates.totalSpending.toFixed(2)}**\n\nThis is across ${aggregates.spendingCount} Money Out transactions from ${dateRangeStr}.`;
    }

    // ===== INCOME =====
    if (q.includes('income') || q.includes('earned') || q.includes('received') || q.includes('money in')) {
      if (aggregates.incomeCount === 0) {
        return `**No income found**\n\nI couldn't find any Money In transactions in your data (${dateRangeStr}).`;
      }
      
      const incomeTransactions = transactions.filter(isIncome);
      const breakdown = incomeTransactions
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(t => `- ${t.merchant_canonical}: £${t.amount.toFixed(2)} (${t.date})`)
        .join('\n');
      
      return `**Total Income: £${aggregates.totalIncome.toFixed(2)}**\n\nAcross ${aggregates.incomeCount} Money In transaction${aggregates.incomeCount > 1 ? 's' : ''} from ${dateRangeStr}.\n\n**Top income sources:**\n${breakdown}`;
    }

    // ===== NET / BALANCE =====
    if (q.includes('net') || q.includes('balance') || q.includes('overall')) {
      const net = aggregates.totalIncome - aggregates.totalSpending;
      const sign = net >= 0 ? '+' : '-';
      return `**Net Balance: ${sign}£${absAmount(net).toFixed(2)}**\n\n- Money In: £${aggregates.totalIncome.toFixed(2)}\n- Money Out: £${aggregates.totalSpending.toFixed(2)}\n\n_For period ${dateRangeStr}_`;
    }

    // ===== CATEGORY SPENDING =====
    const categoryMatch = q.match(/(?:how much|spent|spend|spending).*(?:on|for)\s+(\w+)/i);
    if (categoryMatch) {
      const searchTerm = categoryMatch[1].toLowerCase();
      const spending = transactions.filter(isSpending);
      
      const filtered = spending.filter(t => 
        t.category.toLowerCase().includes(searchTerm) || 
        t.merchant_canonical.toLowerCase().includes(searchTerm) ||
        t.merchant_raw.toLowerCase().includes(searchTerm) ||
        (t.description?.toLowerCase().includes(searchTerm))
      );
      
      const total = filtered.reduce((sum, t) => sum + absAmount(t.amount), 0);
      
      if (filtered.length === 0) {
        return `I couldn't find any Money Out transactions matching "${searchTerm}" in your data (${dateRangeStr}).`;
      }
      
      return `**Spending on ${searchTerm}: £${total.toFixed(2)}**\n\nAcross ${filtered.length} Money Out transaction${filtered.length > 1 ? 's' : ''} from ${dateRangeStr}.`;
    }

    // ===== BREAKDOWN / CATEGORIES =====
    if (q.includes('breakdown') || q.includes('categories') || q.includes('summary')) {
      const sorted = Object.entries(aggregates.byCategory)
        .sort((a, b) => b[1].total - a[1].total);
      
      const breakdown = sorted.map(([cat, data]) => 
        `- **${cat}:** £${data.total.toFixed(2)} (${data.count} txn${data.count > 1 ? 's' : ''})`
      ).join('\n');
      
      return `**Spending Breakdown (£${aggregates.totalSpending.toFixed(2)} total)**\n\n${breakdown}\n\n_Based on Money Out transactions from ${dateRangeStr}_`;
    }

    // ===== LARGEST TRANSACTIONS =====
    if (q.includes('largest') || q.includes('biggest') || q.includes('highest')) {
      const sorted = transactions
        .filter(isSpending)
        .sort((a, b) => absAmount(b.amount) - absAmount(a.amount))
        .slice(0, 5);
      
      const list = sorted.map((t, i) => 
        `${i + 1}. **${t.merchant_canonical}**: £${absAmount(t.amount).toFixed(2)} (${t.date})`
      ).join('\n');
      
      return `**Your 5 Largest Transactions (Money Out)**\n\n${list}\n\n_From ${dateRangeStr}_`;
    }

    // ===== MERCHANT-SPECIFIC =====
    const merchants = [...new Set(transactions.map(t => t.merchant_canonical.toLowerCase()))];
    for (const merchant of merchants) {
      if (q.includes(merchant)) {
        const filtered = transactions.filter(t => 
          t.merchant_canonical.toLowerCase() === merchant
        );
        const spending = filtered.filter(isSpending);
        const income = filtered.filter(isIncome);
        
        let response = `**${filtered[0].merchant_canonical}**\n\n`;
        
        if (spending.length > 0) {
          const total = spending.reduce((sum, t) => sum + absAmount(t.amount), 0);
          response += `- Money Out: £${total.toFixed(2)} (${spending.length} transaction${spending.length > 1 ? 's' : ''})\n`;
        }
        if (income.length > 0) {
          const total = income.reduce((sum, t) => sum + t.amount, 0);
          response += `- Money In: £${total.toFixed(2)} (${income.length} transaction${income.length > 1 ? 's' : ''})\n`;
        }
        
        response += `\n_From ${dateRangeStr}_`;
        return response;
      }
    }

    // ===== DEFAULT HELP =====
    return `I can help you analyze your spending! Try asking:\n\n- "How much did I spend on food?"\n- "Give me a breakdown of my spending"\n- "How many subscriptions do I have?"\n- "What were my largest transactions?"\n- "How much income did I receive?"\n- "What's my net balance?"`;
  }, [transactions, aggregates]);

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
