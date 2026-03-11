import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subscribeInAppNotice, type InAppNotice } from '@/services/in-app-notifier';

function iconByLevel(level: InAppNotice['level']) {
  if (level === 'success') return CheckCircle2;
  if (level === 'error') return XCircle;
  return Info;
}

function classByLevel(level: InAppNotice['level']): string {
  if (level === 'success') return 'border-success/30 bg-success/10 text-success';
  if (level === 'error') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-primary/30 bg-primary/10 text-primary';
}

export function InAppNotificationCenter() {
  const [notices, setNotices] = useState<InAppNotice[]>([]);

  useEffect(() => {
    const timers = new Map<string, number>();
    const unsubscribe = subscribeInAppNotice((notice) => {
      setNotices((prev) => [notice, ...prev].slice(0, 5));
      const timeoutId = window.setTimeout(() => {
        setNotices((prev) => prev.filter((item) => item.id !== notice.id));
        timers.delete(notice.id);
      }, notice.durationMs ?? 4500);
      timers.set(notice.id, timeoutId);
    });

    return () => {
      unsubscribe();
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const visible = useMemo(() => notices, [notices]);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[120] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {visible.map((notice) => {
        const Icon = iconByLevel(notice.level);
        return (
          <div
            key={notice.id}
            className={cn(
              'pointer-events-auto rounded-xl border px-3 py-2 shadow-lg backdrop-blur-sm',
              classByLevel(notice.level),
            )}
          >
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black">{notice.title}</div>
                <div className="mt-0.5 text-xs leading-5 text-foreground/85">{notice.message}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
