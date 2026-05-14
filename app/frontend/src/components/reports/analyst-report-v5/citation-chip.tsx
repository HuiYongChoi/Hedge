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

function confidenceClass(_confidence: CitationConfidence = 'medium') {
  return 'border border-white/20 bg-white/5 text-white/50';
}

export function CitationChip({
  letter,
  label,
  type,
  size = 'sm',
  confidence = 'medium',
  hrefAvailable: _hrefAvailable = true,
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
          ? 'relative inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] text-white/50 hover:bg-white/10 sm:min-h-0'
          : `relative ml-1 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full px-1.5 py-1 text-[9px] font-bold align-baseline hover:bg-white/10 sm:h-4 sm:min-h-0 sm:w-4 sm:min-w-0 sm:p-0 ${confidenceClass(confidence)}`
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
