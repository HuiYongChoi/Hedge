import { Accordion } from '@/components/ui/accordion';
import { useLanguage } from '@/contexts/language-context';
import { ComponentGroup } from '@/data/sidebar-components';
import { t } from '@/lib/language-preferences';
import { SearchBox } from '../search-box';
import { ComponentItemGroup } from './component-item-group';

interface ComponentListProps {
  componentGroups: ComponentGroup[];
  searchQuery: string;
  isLoading: boolean;
  openGroups: string[];
  filteredGroups: ComponentGroup[];
  activeItem: string | null;
  onSearchChange: (query: string) => void;
  onAccordionChange: (value: string[]) => void;
}

export function ComponentList({
  componentGroups,
  searchQuery,
  isLoading,
  openGroups,
  filteredGroups,
  activeItem,
  onSearchChange,
  onAccordionChange,
}: ComponentListProps) {
  const { language } = useLanguage();

  return (
    <div className="flex-grow overflow-auto text-primary scrollbar-thin scrollbar-thumb-ramp-grey-700">
      <SearchBox
        value={searchQuery}
        onChange={onSearchChange}
        placeholder={t('searchComponents', language)}
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-muted-foreground text-sm">{t('loadingComponents', language)}</div>
        </div>
      ) : (
        <Accordion
          type="multiple"
          className="w-full"
          value={openGroups}
          onValueChange={onAccordionChange}
        >
          {filteredGroups.map(group => (
            <ComponentItemGroup
              key={group.name}
              group={group}
              activeItem={activeItem}
            />
          ))}
        </Accordion>
      )}

      {!isLoading && filteredGroups.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {componentGroups.length === 0 ? (
            <div className="space-y-2">
              <div>{t('noComponentsAvailable', language)}</div>
              <div className="text-xs">{t('componentsWillAppear', language)}</div>
            </div>
          ) : (
            t('noComponentsFound', language)
          )}
        </div>
      )}
    </div>
  );
} 