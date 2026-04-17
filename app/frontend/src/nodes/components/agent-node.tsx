import { type NodeProps } from '@xyflow/react';
import { Bot } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CardContent } from '@/components/ui/card';
import { ModelSelector } from '@/components/ui/llm-selector';
import { useFlowContext } from '@/contexts/flow-context';
import { useLanguage } from '@/contexts/language-context';
import { useNodeContext } from '@/contexts/node-context';
import { getAgents } from '@/data/agents';
import { DEFAULT_MODEL_DISPLAY_NAME, getDefaultModel, getModels, LanguageModel, shouldUseDefaultModel } from '@/data/models';
import { useNodeState } from '@/hooks/use-node-state';
import { t } from '@/lib/language-preferences';
import { cn } from '@/lib/utils';
import { type AgentNode } from '../types';
import { getStatusColor } from '../utils';
import { AgentOutputDialog } from './agent-output-dialog';
import { NodeShell } from './node-shell';

export function AgentNode({
  data,
  selected,
  id,
  isConnectable,
}: NodeProps<AgentNode>) {
  const { currentFlowId } = useFlowContext();
  const { getAgentNodeDataForFlow, setAgentModel, getAgentModel } = useNodeContext();
  
  // Get agent node data for the current flow
  const agentNodeData = getAgentNodeDataForFlow(currentFlowId?.toString() || null);
  const nodeData = agentNodeData[id] || { 
    status: 'IDLE', 
    ticker: null, 
    message: '', 
    messages: [],
    lastUpdated: 0
  };
  const status = nodeData.status;
  const isInProgress = status === 'IN_PROGRESS';
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  // Use persistent state hooks
  const [availableModels, setAvailableModels] = useNodeState<LanguageModel[]>(id, 'availableModels', []);
  const [selectedModel, setSelectedModel] = useNodeState<LanguageModel | null>(id, 'selectedModel', null);
  const [localizedName, setLocalizedName] = useState<string | null>(null);
  const [localizedDesc, setLocalizedDesc] = useState<string | null>(null);

  // Load models and localized agent metadata on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [models, defaultModel, agentList] = await Promise.all([getModels(), getDefaultModel(), getAgents()]);
        setAvailableModels(models);
        if (shouldUseDefaultModel(selectedModel) && defaultModel) {
          setSelectedModel(defaultModel);
        }
        // Extract base key from node id (e.g. "warren_buffett_abc123" → "warren_buffett")
        const parts = id.split('_');
        const suffix = parts[parts.length - 1];
        const isHexSuffix = /^[a-z0-9]{6}$/.test(suffix);
        const baseKey = isHexSuffix ? parts.slice(0, -1).join('_') : id;
        const agent = agentList.find(a => a.key === baseKey);
        if (agent) {
          setLocalizedName(agent.display_name_ko || null);
          setLocalizedDesc(agent.investing_style_ko || null);
        }
      } catch (error) {
        console.error('Failed to load models:', error);
      }
    };
    loadData();
  }, [id, selectedModel, setAvailableModels, setSelectedModel]);

  // Update the node context when the model changes
  useEffect(() => {
    const flowId = currentFlowId?.toString() || null;
    const currentContextModel = getAgentModel(flowId, id);
    if (selectedModel !== currentContextModel) {
      setAgentModel(flowId, id, selectedModel);
    }
  }, [selectedModel, id, currentFlowId, setAgentModel, getAgentModel]);

  const handleModelChange = (model: LanguageModel | null) => {
    setSelectedModel(model);
  };

  const handleUseGlobalModel = () => {
    setSelectedModel(null);
  };

  const { language } = useLanguage();

  const displayName = language === 'ko' && localizedName ? localizedName : (data.name || "Agent");
  const displayDesc = language === 'ko' && localizedDesc ? localizedDesc : data.description;

  return (
    <NodeShell
      id={id}
      selected={selected}
      isConnectable={isConnectable}
      icon={<Bot className="h-5 w-5" />}
      iconColor={getStatusColor(status)}
      name={displayName}
      description={displayDesc}
      status={status}
    >
      <CardContent className="p-0">
        <div className="border-t border-border p-3">
          <div className="flex flex-col gap-2">
            <div className="text-subtitle text-primary flex items-center gap-1">
              {t('nodeStatus', language)}
            </div>

            <div className={cn(
              "text-foreground text-xs rounded p-2 border border-status",
              isInProgress ? "gradient-animation" : getStatusColor(status)
            )}>
              <span className="capitalize">
                {status === 'IDLE' ? t('statusIdle', language) :
                 status === 'IN_PROGRESS' ? t('statusRunning', language) :
                 status === 'COMPLETE' ? t('statusComplete', language) :
                 status === 'ERROR' ? t('statusError', language) :
                 (status as string).toLowerCase().replace(/_/g, ' ')}
              </span>
            </div>

            {nodeData.message && (
              <div className="text-foreground text-subtitle">
                {nodeData.message !== "Done" && nodeData.message}
                {nodeData.ticker && <span className="ml-1">({nodeData.ticker})</span>}
              </div>
            )}
            <Accordion type="single" collapsible>
              <AccordionItem value="advanced" className="border-none">
                <AccordionTrigger className="!text-subtitle text-primary">
                  {t('advanced', language)}
                </AccordionTrigger>
                <AccordionContent className="pt-2">
                  <div className="flex flex-col gap-2">
                    <div className="text-subtitle text-primary flex items-center gap-1">
                      {t('nodeModel', language)}
                    </div>
                    <ModelSelector
                      models={availableModels}
                      value={selectedModel?.model_name || ""}
                      onChange={handleModelChange}
                      placeholder={DEFAULT_MODEL_DISPLAY_NAME}
                    />
                    {selectedModel && (
                      <button
                        onClick={handleUseGlobalModel}
                        className="text-subtitle text-primary hover:text-foreground transition-colors text-left"
                      >
                        {language === 'ko' ? '기본 GPT-5.4 Nano로 초기화' : 'Reset to GPT-5.4 Nano'}
                      </button>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
        <AgentOutputDialog
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          name={data.name || "Agent"}
          nodeId={id}
          flowId={currentFlowId?.toString() || null}
        />
      </CardContent>
    </NodeShell>
  );
}
