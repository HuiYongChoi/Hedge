import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/language-context';
import { t } from '@/lib/language-preferences';

export function LanguageSettings() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-primary mb-2">{t('languageTitle', language)}</h2>
        <p className="text-sm text-secondary-foreground">{t('languageDescription', language)}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('language', language)}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="language"
                value="ko"
                checked={language === 'ko'}
                onChange={() => setLanguage('ko')}
                className="w-4 h-4 accent-blue-500"
              />
              <span className="text-sm">{t('korean', language)}</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="language"
                value="en"
                checked={language === 'en'}
                onChange={() => setLanguage('en')}
                className="w-4 h-4 accent-blue-500"
              />
              <span className="text-sm">{t('english', language)}</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-900 dark:text-blue-100">
          {language === 'ko'
            ? '언어 선택 시 전체 설정 화면의 텍스트가 선택된 언어로 변경됩니다.'
            : 'When you change the language, all text on the settings screen will be displayed in the selected language.'}
        </p>
      </div>
    </div>
  );
}
