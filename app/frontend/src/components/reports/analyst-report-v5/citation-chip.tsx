import type { Citation, CitationConfidence } from './types';

interface CitationChipProps {
  letter: string;
  label?: string;
  type?: string;
  size?: 'sm' | 'md';
  confidence?: CitationConfidence;
  hrefAvailable?: boolean;
  onHover?: (letter: string | null) => void;
  onClick?: () => void;
}

function confidenceClass(confidence: CitationConfidence = 'medium') {
  if (confidence === 'high') return 'bg-zinc-500 text-white';
  if (confidence === 'low') return 'border border-dashed border-zinc-500/60 bg-transparent text-zinc-500';
  return 'border border-zinc-500 bg-transparent text-zinc-700 dark:text-zinc-300';
}

export function CitationChip({
  letter,
  label,
  type,
  size = 'sm',
  confidence = 'medium',
  hrefAvailable = true,
  onHover,
  onClick,
}: CitationChipProps) {
  const isMedium = size === 'md';
  return (
    <span
      data-citation-letter={letter}
      onMouseEnter={() => onHover?.(letter)}
      onMouseLeave={() => onHover?.(null)}
      onClick={onClick}
      className={
        isMedium
          ? `relative inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/50 sm:min-h-0 ${!hrefAvailable ? "after:absolute after:-right-0.5 after:-top-0.5 after:text-[8px] after:content-['?']" : ''}`
          : `relative ml-1 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full px-1.5 py-1 text-[9px] font-bold align-baseline hover:bg-zinc-500/30 sm:h-4 sm:min-h-0 sm:w-4 sm:min-w-0 sm:p-0 ${confidenceClass(confidence)} ${!hrefAvailable ? "after:absolute after:-right-0.5 after:-top-0.5 after:text-[8px] after:content-['?']" : ''}`
      }
      aria-label={label ? `출처 ${letter}: ${label}` : `출처 ${letter}`}
    >
      <span className={isMedium ? 'font-mono font-bold text-foreground' : ''}>{letter}</span>
      {isMedium && label && <span>{label}</span>}
      {isMedium && type && <span className="rounded bg-background/60 px-1 font-mono uppercase">{type}</span>}
    </span>
  );
}

export function findCitation(citations: Citation[], letter: string) {
  return citations.find(citation => citation.letter === letter);
}
