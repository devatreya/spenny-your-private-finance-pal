import { useCallback } from 'react';
import { Shield, Sparkles, Trash2 } from 'lucide-react';
import { FileUpload } from '@/components/FileUpload';
import { ChatInterface } from '@/components/ChatInterface';
import { useFinanceStore } from '@/hooks/useFinanceStore';
import { Button } from '@/components/ui/button';
import { Transaction } from '@/lib/parser/schema';

const Index = () => {
  const { messages, isLoaded, loadTransactions, addMessage, analyzeQuery, clearData } = useFinanceStore();

  const handleFileLoaded = useCallback((transactions: Transaction[]) => {
    loadTransactions(transactions);
  }, [loadTransactions]);

  const handleSendMessage = useCallback((content: string) => {
    addMessage('user', content);
    const response = analyzeQuery(content);
    setTimeout(() => addMessage('assistant', response), 300);
  }, [addMessage, analyzeQuery]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-hero flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-lg text-foreground">Spenny</span>
        </div>
        <div className="flex items-center gap-3">
          {isLoaded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearData}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </Button>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Shield className="w-3.5 h-3.5" />
            <span>Privacy-first</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full">
        {!isLoaded ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                <span className="gradient-text">How can I help you</span>
                <br />
                <span className="text-foreground">today?</span>
              </h1>
              <p className="text-muted-foreground max-w-md mx-auto">
                Upload your bank statement and I'll analyze your spending. 
                Everything stays on your device.
              </p>
            </div>

            <div className="w-full max-w-md">
              <FileUpload onFileLoaded={handleFileLoaded} />
            </div>

            <div className="mt-12 grid grid-cols-3 gap-6 text-center">
              <div>
                <div className="text-2xl font-bold gradient-text">100%</div>
                <div className="text-xs text-muted-foreground">Private</div>
              </div>
              <div>
                <div className="text-2xl font-bold gradient-text">0</div>
                <div className="text-xs text-muted-foreground">Data stored</div>
              </div>
              <div>
                <div className="text-2xl font-bold gradient-text">Instant</div>
                <div className="text-xs text-muted-foreground">Analysis</div>
              </div>
            </div>
          </div>
        ) : (
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            isReady={isLoaded}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="py-4 text-center border-t border-border">
        <p className="text-xs text-muted-foreground">
          Your data never leaves your device
        </p>
      </footer>
    </div>
  );
};

export default Index;
