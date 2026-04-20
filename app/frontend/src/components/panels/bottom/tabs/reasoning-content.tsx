import { Copy } from 'lucide-react';
import { useState } from 'react';
import { copyTextToClipboard, stringifyClipboardValue } from '@/utils/clipboard-utils';

// Component to render reasoning content with copy button
export function ReasoningContent({ content }: { content: any }) {
  const [copySuccess, setCopySuccess] = useState(false);

  if (!content) return null;

  const contentString = stringifyClipboardValue(content);

  const copyToClipboard = async () => {
    const didCopy = await copyTextToClipboard(contentString);
    if (didCopy) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } else {
      console.error('Failed to copy text');
    }
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copyToClipboard}
        className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1 text-xs p-1 rounded hover:bg-accent bg-background border border-border"
        title="Copy to clipboard"
      >
        <Copy className="h-3 w-3" />
        <span className="text-xs">{copySuccess ? 'Copied!' : 'Copy'}</span>
      </button>

      <div className="text-sm">
        {contentString.split('\n').map((paragraph, idx) => (
          <p key={idx} className="mb-1 last:mb-0 whitespace-pre-wrap">{paragraph}</p>
        ))}
      </div>
    </div>
  );
}
