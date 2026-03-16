import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGlobalAlert } from '@/providers/GlobalAlertProvider';
import {
  checkForAppUpdate,
  getAppMetadata,
  installUpdate,
  isTauriRuntime,
  loadUpdatePreferences,
  saveUpdatePreferences,
  type UpdateInfo,
  type UpdatePreferences,
} from '@/services/update-service';

interface UpdateContextValue {
  supported: boolean;
  preferences: UpdatePreferences;
  currentVersion: string;
  checking: boolean;
  installing: boolean;
  setAutoCheckOnStartup: (value: boolean) => void;
  setShowReleaseNotes: (value: boolean) => void;
  checkNow: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { showAlert } = useGlobalAlert();
  const [preferences, setPreferences] = useState<UpdatePreferences>(() => loadUpdatePreferences());
  const [currentVersion, setCurrentVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const autoCheckedRef = useRef(false);
  const desktopRuntime = useMemo(() => isTauriRuntime(), []);

  useEffect(() => {
    saveUpdatePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    let cancelled = false;
    void getAppMetadata()
      .then((metadata) => {
        if (!cancelled) {
          setCurrentVersion(metadata.version);
        }
      })
      .catch((error) => {
        console.error('[Update] 读取应用版本失败:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [desktopRuntime]);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (!desktopRuntime) {
        if (manual) {
          showAlert(t('settings.updateUnsupportedRuntime'), t('settings.update'));
        }
        return;
      }

      setChecking(true);
      try {
        const metadata = await getAppMetadata();
        setCurrentVersion(metadata.version);
        const info = await checkForAppUpdate();
        if (info) {
          setCurrentVersion(info.currentVersion);
          setUpdateInfo(info);
          setDialogOpen(true);
          return;
        }

        if (manual) {
          showAlert(
            t('settings.updateAlreadyLatest', { version: currentVersion }),
            t('settings.update'),
          );
        }
      } catch (error) {
        console.error('[Update] 检查更新失败:', error);
        const message = error instanceof Error ? error.message : t('settings.updateCheckFailed');
        if (manual) {
          showAlert(message, t('settings.update'));
        }
      } finally {
        setChecking(false);
      }
    },
    [currentVersion, desktopRuntime, showAlert, t],
  );

  useEffect(() => {
    if (!desktopRuntime || !preferences.autoCheckOnStartup || autoCheckedRef.current) {
      return;
    }
    autoCheckedRef.current = true;
    void runCheck(false);
  }, [desktopRuntime, preferences.autoCheckOnStartup, runCheck]);

  const handleInstall = useCallback(async () => {
    if (!updateInfo) {
      return;
    }

    setInstalling(true);
    try {
      await installUpdate(updateInfo.asset);
      setDialogOpen(false);
      showAlert(t('settings.updateInstallerStarted'), t('settings.update'));
    } catch (error) {
      console.error('[Update] 安装更新失败:', error);
      showAlert(
        error instanceof Error ? error.message : t('settings.updateInstallFailed'),
        t('settings.update'),
      );
    } finally {
      setInstalling(false);
    }
  }, [showAlert, t, updateInfo]);

  const contextValue = useMemo<UpdateContextValue>(
    () => ({
      supported: desktopRuntime,
      preferences,
      currentVersion,
      checking,
      installing,
      setAutoCheckOnStartup: (value: boolean) => {
        setPreferences((prev) => ({ ...prev, autoCheckOnStartup: value }));
      },
      setShowReleaseNotes: (value: boolean) => {
        setPreferences((prev) => ({ ...prev, showReleaseNotes: value }));
      },
      checkNow: async () => {
        await runCheck(true);
      },
    }),
    [checking, currentVersion, desktopRuntime, installing, preferences, runCheck],
  );

  return (
    <UpdateContext.Provider value={contextValue}>
      {children}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('settings.updateAvailableTitle')}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap break-words text-muted-foreground">
              {updateInfo
                ? t('settings.updateAvailableDesc', {
                    currentVersion: updateInfo.currentVersion,
                    latestVersion: updateInfo.latestVersion,
                  })
                : t('settings.updateCheckFailed')}
            </DialogDescription>
          </DialogHeader>

          {updateInfo && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border-light bg-background-secondary/30 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground-secondary">{t('settings.updatePackage')}</span>
                  <span className="font-medium text-foreground">{updateInfo.asset.name}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-foreground-secondary">{t('settings.releaseNotes')}</span>
                  <span className="font-medium text-foreground">{updateInfo.releaseName}</span>
                </div>
              </div>

              {preferences.showReleaseNotes && updateInfo.releaseNotes && (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-border-light bg-background-secondary/20 p-4">
                  <p className="mb-2 text-sm font-medium text-foreground">{t('settings.updateReleaseNotesTitle')}</p>
                  <pre className="whitespace-pre-wrap break-words text-xs text-foreground-secondary font-sans">
                    {updateInfo.releaseNotes}
                  </pre>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={installing}>
              {t('settings.updateLater')}
            </Button>
            <Button onClick={() => void handleInstall()} disabled={installing}>
              {installing ? t('settings.updateInstalling') : t('settings.updateNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UpdateContext.Provider>
  );
}

export function useUpdateManager(): UpdateContextValue {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error('useUpdateManager 必须在 UpdateProvider 内使用');
  }
  return context;
}
