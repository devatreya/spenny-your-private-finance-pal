import { useCallback, useState } from 'react';
import { Upload, FileText, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseFile } from '@/lib/parser/parser';
import { Transaction } from '@/lib/parser/schema';

interface FileUploadProps {
  onFileLoaded: (transactions: Transaction[]) => void;
}

export const FileUpload = ({ onFileLoaded }: FileUploadProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [transactionCount, setTransactionCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setIsProcessing(true);
    
    try {
      const result = await parseFile(file);
      
      if (result.transactions.length === 0) {
        setError('No transactions found. Please check your file format.');
        setIsProcessing(false);
        return;
      }
      
      onFileLoaded(result.transactions);
      setUploadedFile(file.name);
      setTransactionCount(result.transactions.length);
      setIsProcessing(false);
    } catch (err) {
      console.error('File parsing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to parse file.');
      setIsProcessing(false);
    }
  }, [onFileLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  if (isProcessing) {
    return (
      <div className="gradient-border p-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-foreground font-medium">Processing your statement...</p>
          <p className="text-muted-foreground text-sm">This may take a moment</p>
        </div>
      </div>
    );
  }

  if (uploadedFile && transactionCount > 0) {
    return (
      <div className="gradient-border p-6 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <span className="text-foreground font-medium">{uploadedFile}</span>
        </div>
        <p className="text-muted-foreground text-sm">
          {transactionCount} transactions loaded
        </p>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "gradient-border p-8 text-center cursor-pointer transition-all duration-300",
        isDragging && "glow-effect"
      )}
    >
      <input
        type="file"
        accept=".csv,.pdf"
        onChange={handleChange}
        className="hidden"
        id="file-upload"
      />
      <label htmlFor="file-upload" className="cursor-pointer block">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
            {isDragging ? (
              <FileText className="w-6 h-6 text-primary" />
            ) : (
              <Upload className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="text-foreground font-medium mb-1">
              {isDragging ? 'Drop your statement here' : 'Upload your bank statement'}
            </p>
            <p className="text-muted-foreground text-sm">
              PDF or CSV • Processed locally
            </p>
          </div>
          {error && (
            <p className="text-destructive text-sm mt-2">{error}</p>
          )}
        </div>
      </label>
    </div>
  );
};
