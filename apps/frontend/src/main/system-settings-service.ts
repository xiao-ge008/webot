import { app } from 'electron';

export function getAutoLaunchSetting(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

export function setAutoLaunchSetting(enabled: boolean): boolean {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
    });
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
