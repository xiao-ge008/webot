import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ThemeLangSwitcher } from '@/components/ThemeLangSwitcher';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getServicePowerState, startServicePower, stopServicePower, type ServicePowerState } from '@/services/service-power-client';
import { AlertTriangle, ChevronLeft, Loader2, Power, Sparkles, User, Users, Clock, Wand2 } from 'lucide-react';

export type HomeTab = 'agents' | 'groups' | 'tasks' | 'superTools';

interface HomeTabContextType {
  activeTab: HomeTab;
  setActiveTab: (tab: HomeTab) => void;
}

const HomeTabContext = createContext<HomeTabContextType | undefined>(undefined);

export function useHomeTab() {
  const context = useContext(HomeTabContext);
  if (!context) {
    throw new Error('useHomeTab must be used within a HomeTabProvider');
  }
  return context;
}

export function HomeTabProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<HomeTab>('agents');

  return (
    <HomeTabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </HomeTabContext.Provider>
  );
}

export function Header() {
  const { t } = useTranslation();
  const { activeTab, setActiveTab } = useHomeTab();
  const location = useLocation();
  const isHome = location.pathname === '/' || location.pathname === '/home';
  const isTaskLanding = location.pathname.startsWith('/tasks');
  const [serviceState, setServiceState] = useState<ServicePowerState>({
    status: 'offline',
    online: false,
  });
  const [toggling, setToggling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshServiceState = async () => {
    try {
      const next = await getServicePowerState();
      setServiceState(next);
      setErrorMessage(next.error ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '状态查询失败';
      setServiceState({ status: 'error', online: false, error: message });
      setErrorMessage(message);
    }
  };

  useEffect(() => {
    void refreshServiceState();
    const timer = window.setInterval(() => {
      void refreshServiceState();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleToggleService = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      const next = serviceState.online ? await stopServicePower() : await startServicePower();
      setServiceState(next);
      setErrorMessage(next.error ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      setServiceState({ status: 'error', online: false, error: message });
      setErrorMessage(message);
    } finally {
      setToggling(false);
    }
  };

  const navTabs = [
    { id: 'agents' as HomeTab, icon: User, label: t('home.tabs.agents'), path: '/home' },
    { id: 'groups' as HomeTab, icon: Users, label: t('home.tabs.groups'), path: '/home' },
    { id: 'tasks' as HomeTab, icon: Clock, label: t('home.tabs.tasks'), path: '/tasks' },
    { id: 'superTools' as HomeTab, icon: Wand2, label: t('home.tabs.superTools'), path: '/home' },
  ];

  const activeTopTab: HomeTab | null = (() => {
    if (isTaskLanding) return 'tasks';
    if (location.pathname.startsWith('/agents')) return 'agents';
    if (isHome) return activeTab;
    return null;
  })();

  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border z-50">
      <div className="h-full flex items-center px-4 md:px-6">
        {/* 左侧：Logo 或 返回按钮 */}
        <div className="flex items-center gap-3 shrink-0">
          {isHome || isTaskLanding ? (
            <Link to="/home" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-base font-semibold tracking-tight hidden sm:block">weBot</span>
            </Link>
          ) : (
            <Link to="/home" className="flex items-center">
              <Button variant="ghost" size="sm" className="gap-1.5 h-9 pl-0">
                <ChevronLeft className="w-4 h-4" />
                <span>{t('nav.back')}</span>
              </Button>
            </Link>
          )}
        </div>

        {/* 中间：主功能导航 Tab */}
        {(isHome || isTaskLanding || location.pathname.startsWith('/agents')) && (
          <nav className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1">
            {navTabs.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTopTab === tab.id ? 'default' : 'ghost'}
                size="sm"
                className="gap-2 h-9 px-4 font-medium transition-colors"
                asChild
              >
                <Link
                  to={tab.path}
                  onClick={() => {
                    if (tab.path === '/home') {
                      setActiveTab(tab.id);
                    }
                  }}
                >
                  <tab.icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </Link>
              </Button>
            ))}
          </nav>
        )}

        {/* 右侧：开机 + 设置 */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleToggleService}
                  disabled={toggling}
                >
                  {toggling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className={cn('h-4 w-4', serviceState.online ? 'text-success' : 'text-muted-foreground')} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs font-medium">{serviceState.online ? '在线' : '离线'}</p>
              </TooltipContent>
            </Tooltip>

            {errorMessage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[360px] text-xs leading-relaxed">
                  {errorMessage}
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
          <SettingsDialog />
          <ThemeLangSwitcher />
        </div>
      </div>
    </header>
  );
}
