import ComponentItem from '@/components/panels/right/component-item';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useFlowContext } from '@/contexts/flow-context';
import { useLanguage } from '@/contexts/language-context';
import { ComponentGroup } from '@/data/sidebar-components';
import { t, translations } from '@/lib/language-preferences';

interface ComponentItemGroupProps {
  group: ComponentGroup;
  activeItem: string | null;
}

// Map English group/item names to translation keys
const groupNameKeyMap: Record<string, keyof typeof translations.en> = {
  'Start Nodes': 'startNodes',
  'Analysts': 'analystNodes',
  'Swarms': 'swarmNodes',
  'End Nodes': 'endNodes',
};

const itemNameKeyMap: Record<string, keyof typeof translations.en> = {
  'Portfolio Input': 'portfolioInput',
  'Stock Input': 'stockInput',
  'Portfolio Manager': 'portfolioManager',
  'Data Wizards': 'dataWizards',
  'Market Mavericks': 'marketMavericks',
  'Value Investors': 'valueInvestors',
};

export function ComponentItemGroup({
  group,
  activeItem
}: ComponentItemGroupProps) {
  const { name, icon: Icon, iconColor, items } = group;
  const { addComponentToFlow } = useFlowContext();
  const { language } = useLanguage();

  const handleItemClick = async (componentName: string) => {
    try {
      await addComponentToFlow(componentName);
    } catch (error) {
      console.error('Failed to add component to flow:', error);
    }
  };

  const displayGroupName = groupNameKeyMap[name] ? t(groupNameKeyMap[name], language) : name;

  return (
    <AccordionItem key={name} value={name} className="border-none">
      <AccordionTrigger className="px-4 py-2 text-sm hover-bg hover:no-underline">
        <div className="flex items-center gap-2">
          <Icon size={16} className={iconColor} />
          <span className="capitalize">{displayGroupName}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4">
        <div className="space-y-1">
          {items.map((item) => {
            const displayItemName = itemNameKeyMap[item.name] ? t(itemNameKeyMap[item.name], language) : item.name;
            return (
              <ComponentItem
                key={item.name}
                icon={item.icon}
                label={displayItemName}
                isActive={activeItem === item.name}
                onClick={() => handleItemClick(item.name)}
              />
            );
          })}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
} 