import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** 当前用户选择的模式 */
  mode: ThemeMode;
  /** 实际生效的主题（system 会被解析为 light/dark） */
  resolved: 'light' | 'dark';
  /** 切换主题 */
  setMode: (mode: ThemeMode) => void;
  /** 字体设置 */
  fontFamily: string;
  setFontFamily: (font: string) => void;
  /** 字号设置 */
  fontSize: number;
  setFontSize: (size: number) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** 获取系统偏好 */
function getSystemPreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // 主题模式状态
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('webot-theme');
    return (saved as ThemeMode) ?? 'system';
  });

  // 界面配置状态
  const [fontFamily, setFontFamilyState] = useState(() => {
    return localStorage.getItem('webot-font-family') || "'Inter', 'Noto Sans SC', sans-serif";
  });
  const [fontSize, setFontSizeState] = useState(() => {
    return Number(localStorage.getItem('webot-font-size')) || 14;
  });

  // 监听系统主题变化供派生使用
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemPreference);

  // 派生实际生效的主题
  const resolved = useMemo(() => {
    return mode === 'system' ? systemTheme : mode;
  }, [mode, systemTheme]);

  /** 切换主题并持久化 */
  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem('webot-theme', newMode);
  }, []);

  /** 切换字体并持久化 */
  const setFontFamily = useCallback((newFont: string) => {
    setFontFamilyState(newFont);
    localStorage.setItem('webot-font-family', newFont);
  }, []);

  /** 切换字号并持久化 */
  const setFontSize = useCallback((newSize: number) => {
    setFontSizeState(newSize);
    localStorage.setItem('webot-font-size', String(newSize));
  }, []);

  /** 应用样式到容器（主要应用到 <html>） */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;

    // 应用字体 —— 同时覆盖 --font-family（被 body/html 直接引用）
    // 以及 --font-sans（供 Tailwind font-sans class 使用）
    root.style.setProperty('--font-family', fontFamily);
    root.style.setProperty('--font-sans', fontFamily);
    root.style.setProperty('--font-size', `${fontSize}px`);
  }, [resolved, fontFamily, fontSize]);

  /** 监听系统设置变化 */
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(getSystemPreference());
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return (
    <ThemeContext.Provider value={{
      mode,
      resolved,
      setMode,
      fontFamily,
      setFontFamily,
      fontSize,
      setFontSize
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** 使用主题 hook */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用');
  return ctx;
}
