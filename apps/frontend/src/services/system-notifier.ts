import { pushInAppNotice, type NoticeLevel } from '@/services/in-app-notifier';

let requestedPermission = false;

async function ensurePermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  if (requestedPermission) {
    return Notification.permission;
  }

  requestedPermission = true;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function pushSystemNotice(input: {
  title: string;
  message: string;
  level?: NoticeLevel;
  tag?: string;
}): Promise<void> {
  const permission = await ensurePermission();
  const body = input.message.trim().slice(0, 240);

  if (permission === 'granted' && typeof window !== 'undefined' && 'Notification' in window) {
    try {
      // 在 Windows 下通常显示为右下角系统通知弹窗
      new Notification(input.title, {
        body,
        tag: input.tag,
      });
      return;
    } catch {
      // ignore and fallback to in-app notice
    }
  }

  pushInAppNotice({
    title: input.title,
    message: body,
    level: input.level || 'info',
    durationMs: 6000,
  });
}
