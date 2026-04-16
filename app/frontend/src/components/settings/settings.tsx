import { cn } from '@/lib/utils';
import { CubeIcon } from '@radix-ui/react-icons';
import { Key, Palette, Globe } from 'lucide-react';
import { useState } from 'react';
import { ApiKeysSettings, Models } from './';
import { ThemeSettings } from './appearance';
import { LanguageSettings } from './language';
import { useLanguage } from '@/contexts/language-context';
import { t } from '@/lib/language-preferences';

interface SettingsProps {
  className?: string;
}

interface SettingsNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}

export function Settings({ className }: SettingsProps) {
  const [selectedSection, setSelectedSection] = useState('api');
  const { language } = useLanguage();

  const navigationItems: SettingsNavItem[] = [
    {
      id: 'api',
      label: t('apiKeys', language),
      icon: Key,
      description: t('apiKeysDescription', language),
    },
    {
      id: 'models',
      label: t('models', language),
      icon: CubeIcon,
      description: t('modelsDescription', language),
    },
    {
      id: 'theme',
      label: t('theme', language),
      icon: Palette,
      description: t('themeDescription', language),
    },
    {
      id: 'language',
      label: t('language', language),
      icon: Globe,
      description: t('languageDescription', language),
    },
  ];

  const renderContent = () => {
    switch (selectedSection) {
      case 'models':
        return <Models />;
      case 'theme':
        return <ThemeSettings />;
      case 'language':
        return <LanguageSettings />;
      case 'api':
        return <ApiKeysSettings />;
      default:
        return <ApiKeysSettings />;
    }
  };

  return (
    <div className={cn("flex justify-center h-full overflow-hidden bg-panel", className)}>
      <div className="flex w-full max-w-7xl mx-auto">
        {/* Left Navigation Pane */}
        <div className="w-60 bg-panel flex-shrink-0">
          <div className="p-4 border-b">
            <h1 className="text-lg font-semibold text-primary">{t('settings', language)}</h1>
          </div>
          <nav className="p-2">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isSelected = selectedSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedSection(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left rounded-md text-sm transition-colors",
                    isSelected 
                      ? "active-bg text-blue-500" 
                      : "text-primary hover-item"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Content Pane */}
        <div className="flex-1 overflow-auto bg-panel">
          <div className="p-8 max-w-4xl">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
} 