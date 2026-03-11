import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useTheme, type ThemeMode } from '@/providers/ThemeProvider';
import { changeLanguage } from '@/i18n';
import { Sun, Moon, Monitor, Globe } from 'lucide-react';

/** 主题模式列表 */
const themeModes: { value: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'theme.dark' },
  { value: 'system', icon: Monitor, labelKey: 'theme.system' },
];

/** 顶部栏的主题+语言切换器 */
export function ThemeLangSwitcher() {
  const { setMode } = useTheme();
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh';
    changeLanguage(next);
  };

  return (
    <div className="flex items-center gap-0.5">
      {/* 主题切换 */}
      {themeModes.map(({ value, icon: Icon }) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setMode(value)}
          title={value}
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}

      {/* 分隔 */}
      <div className="w-px h-4 bg-border mx-1" />

      {/* 语言切换 - 中子图标 */}
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={toggleLanguage}
        title={i18n.language === 'zh' ? 'English' : '中文'}
      >
        <Globe className="h-4 w-4" />
      </Button>
    </div>
  );
}