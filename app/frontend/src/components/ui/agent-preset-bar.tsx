import { Sparkles } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AGENT_PRESETS } from '@/data/agent-presets';
import type { Agent } from '@/data/agents';

interface AgentPresetBarProps {
  agents: Agent[];
  selectedKeys: Set<string>;
  onApply: (keys: string[]) => void;
  language: 'ko' | 'en';
}

function agentName(agents: Agent[], key: string, language: 'ko' | 'en'): string {
  const agent = agents.find(a => a.key === key);
  if (!agent) return key;
  return language === 'ko' ? agent.display_name_ko || agent.display_name : agent.display_name;
}

export function AgentPresetBar({ agents, selectedKeys, onApply, language }: AgentPresetBarProps) {
  if (agents.length === 0) return null;

  const presets = AGENT_PRESETS.map(preset => ({
    ...preset,
    availableKeys: preset.agentKeys.filter(k => agents.some(a => a.key === k)),
  })).filter(preset => preset.availableKeys.length > 0);

  if (presets.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        {language === 'ko' ? '추천 조합' : 'Recommended combos'}
      </div>
      <TooltipProvider delayDuration={150}>
        <div className="flex flex-wrap gap-1.5">
          {presets.map(preset => {
            const label = language === 'ko' ? preset.labelKo : preset.labelEn;
            const tooltip = language === 'ko' ? preset.tooltipKo : preset.tooltipEn;
            const isActive =
              preset.availableKeys.length === selectedKeys.size &&
              preset.availableKeys.every(k => selectedKeys.has(k));
            return (
              <Tooltip key={preset.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onApply(preset.availableKeys)}
                    aria-pressed={isActive}
                    className={[
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-accent hover:text-accent-foreground',
                    ].join(' ')}
                  >
                    {label}
                    <span className="ml-1 opacity-70">{preset.availableKeys.length}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs whitespace-normal text-left leading-relaxed">
                  <p>{tooltip}</p>
                  <p className="mt-1.5 opacity-80">
                    {preset.availableKeys.map(k => agentName(agents, k, language)).join(' · ')}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}
