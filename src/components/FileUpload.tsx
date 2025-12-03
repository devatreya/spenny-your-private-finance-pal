import { useCallback, useState } from 'react';
import { Upload, FileText, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFileLoaded: (content: string) => number;
}

export const FileUpload = ({ onFileLoaded }: FileUploadProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [transactionCount, setTransactionCount] = useState(0);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const count = onFileLoaded(content);
      setUploadedFile(file.name);
      setTransactionCount(count);
    };
    reader.readAsText(file);
  }, [onFileLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  if (uploadedFile) {
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
        accept=".csv"
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
              CSV format • Processed locally
            </p>
          </div>
        </div>
      </label>
    </div>
  );
};
