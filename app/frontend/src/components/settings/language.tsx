import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
          <RadioGroup value={language} onValueChange={(value) => setLanguage(value as 'ko' | 'en')}>
            <div className="flex items-center space-x-3 mb-4">
              <RadioGroupItem value="ko" id="korean" />
              <Label htmlFor="korean" className="font-normal cursor-pointer flex-1">
                {t('korean', language)}
              </Label>
            </div>
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="en" id="english" />
              <Label htmlFor="english" className="font-normal cursor-pointer flex-1">
                {t('english', language)}
              </Label>
            </div>
          </RadioGroup>
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
