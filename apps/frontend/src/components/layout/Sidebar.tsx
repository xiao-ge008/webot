import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Home,
  UserPlus,
  Users,
  Settings,
  Sparkles,
  Calendar,
} from 'lucide-react';

/** 侧边栏导航项 */
const navItems = [
  { path: '/', label: '首页', icon: Home },
  { path: '/agents', label: '智能体', icon: Users },
  { path: '/create', label: '创建', icon: UserPlus },
  { path: '/tasks', label: '任务中心', icon: Calendar },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[220px] bg-background-secondary/60 border-r border-border-light flex flex-col z-10">
      {/* Logo 区域 */}
      <div className="h-16 flex items-center px-5 gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="text-base font-semibold tracking-tight">weBot</span>
      </div>

      {/* 导航列表 */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-apple',
                isActive
                  ? 'bg-accent/10 text-foreground shadow-sm'
                  : 'text-foreground-secondary hover:text-foreground hover:bg-background-secondary'
              )}
            >
              <Icon className="w-[18px] h-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 底部设置 */}
      <div className="p-3 border-t border-border-light">
        <Link
          to="/settings"
          state={{ backgroundLocation: location }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground-secondary hover:text-foreground hover:bg-background-secondary transition-apple"
        >
          <Settings className="w-[18px] h-[18px]" />
          设置
        </Link>
      </div>
    </aside>
  );
}
