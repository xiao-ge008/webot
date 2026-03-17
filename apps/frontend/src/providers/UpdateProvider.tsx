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
import { Progress } from '@/components/ui/progress';
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
  listenUpdateInstallProgress,
  loadUpdatePreferences,
  saveUpdatePreferences,
  type UpdateInstallPhase,
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

interface UpdateInstallState {
  phase: 'idle' | UpdateInstallPhase;
  downloadedBytes: number;
  totalBytes: number | null;
  progressPercent: number | null;
  message: string;
  installerPath: string;
  launched: boolean | null;
}

function createIdleInstallState(): UpdateInstallState {
  return {
    phase: 'idle',
    downloadedBytes: 0,
    totalBytes: null,
    progressPercent: null,
    message: '',
    installerPath: '',
    launched: null,
  };
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { showAlert } = useGlobalAlert();
  const [preferences, setPreferences] = useState<UpdatePreferences>(() => loadUpdatePreferences());
  const [currentVersion, setCurrentVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [installState, setInstallState] = useState<UpdateInstallState>(() => createIdleInstallState());
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

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listenUpdateInstallProgress((event) => {
      if (cancelled) {
        return;
      }

      setInstallState((prev) => ({
        phase: event.phase,
        downloadedBytes:
          typeof event.downloadedBytes === 'number' ? event.downloadedBytes : prev.downloadedBytes,
        totalBytes: typeof event.totalBytes === 'number' ? event.totalBytes : prev.totalBytes,
        progressPercent:
          typeof event.progressPercent === 'number' ? event.progressPercent : prev.progressPercent,
        message: typeof event.message === 'string' ? event.message : prev.message,
        installerPath:
          typeof event.installerPath === 'string' ? event.installerPath : prev.installerPath,
        launched: typeof event.launched === 'boolean' ? event.launched : prev.launched,
      }));
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((error) => {
        console.error('[Update] 监听安装进度失败:', error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktopRuntime]);

  useEffect(() => {
    if (!dialogOpen && !installing) {
      setInstallState(createIdleInstallState());
    }
  }, [dialogOpen, installing]);

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
        const installedVersion = metadata.version;
        setCurrentVersion(installedVersion);
        const info = await checkForAppUpdate();
        if (info) {
          setCurrentVersion(info.currentVersion);
          setUpdateInfo(info);
          setInstallState(createIdleInstallState());
          setDialogOpen(true);
          return;
        }

        if (manual) {
          showAlert(
            t('settings.updateAlreadyLatest', { version: installedVersion }),
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
    [desktopRuntime, showAlert, t],
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
    setInstallState({
      phase: 'preparing',
      downloadedBytes: 0,
      totalBytes: updateInfo.asset.size,
      progressPercent: 0,
      message: t('settings.updatePreparingDetail'),
      installerPath: '',
      launched: null,
    });
    try {
      await installUpdate(updateInfo.asset);
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

  const effectiveTotalBytes = installState.totalBytes ?? updateInfo?.asset.size ?? null;
  const installProgressValue = useMemo(() => {
    if (typeof installState.progressPercent === 'number') {
      return Math.max(0, Math.min(100, installState.progressPercent));
    }

    if (
      typeof effectiveTotalBytes === 'number' &&
      effectiveTotalBytes > 0 &&
      installState.downloadedBytes > 0
    ) {
      return Math.min((installState.downloadedBytes / effectiveTotalBytes) * 100, 100);
    }

    if (
      installState.phase === 'downloaded' ||
      installState.phase === 'launching_installer' ||
      installState.phase === 'installer_started'
    ) {
      return 100;
    }

    return 0;
  }, [effectiveTotalBytes, installState.downloadedBytes, installState.phase, installState.progressPercent]);

  const installStatusLabel = useMemo(() => {
    switch (installState.phase) {
      case 'preparing':
        return t('settings.updatePreparing');
      case 'downloading':
        return t('settings.updateDownloading');
      case 'downloaded':
        return t('settings.updateDownloaded');
      case 'launching_installer':
        return t('settings.updateLaunchingInstaller');
      case 'installer_started':
        return t('settings.updateInstallerStartedShort');
      case 'failed':
        return t('settings.updateInstallFailed');
      default:
        return t('settings.updateNow');
    }
  }, [installState.phase, t]);

  const installStatusMessage = useMemo(() => {
    if (installState.message) {
      return installState.message;
    }

    switch (installState.phase) {
      case 'preparing':
        return t('settings.updatePreparingDetail');
      case 'downloading':
        return t('settings.updateInstalling');
      case 'downloaded':
        return t('settings.updateDownloadedDetail');
      case 'launching_installer':
        return t('settings.updateLaunchingInstallerDetail');
      case 'installer_started':
        return t('settings.updateInstallerStarted');
      case 'failed':
        return t('settings.updateInstallFailed');
      default:
        return '';
    }
  }, [installState.message, installState.phase, t]);

  const installProgressText = useMemo(() => {
    if (typeof effectiveTotalBytes === 'number' && effectiveTotalBytes > 0) {
      return t('settings.updateDownloadedSize', {
        downloaded: formatBytes(installState.downloadedBytes),
        total: formatBytes(effectiveTotalBytes),
      });
    }

    if (installState.downloadedBytes > 0) {
      return t('settings.updateDownloadedSizeUnknown', {
        downloaded: formatBytes(installState.downloadedBytes),
      });
    }

    return t('settings.updateProgressUnknown');
  }, [effectiveTotalBytes, installState.downloadedBytes, t]);

  const showInstallProgress = installing || installState.phase !== 'idle';
  const preventDialogClose =
    installing && installState.phase !== 'failed' && installState.phase !== 'installer_started';
  const installActionLabel =
    installState.phase === 'launching_installer'
      ? t('settings.updateLaunchingInstaller')
      : installState.phase === 'installer_started'
        ? t('settings.updateInstallerStartedShort')
        : installing
          ? t('settings.updateInstalling')
          : t('settings.updateNow');

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
        <DialogContent
          className="max-w-xl"
          onInteractOutside={(event) => {
            if (preventDialogClose) {
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (preventDialogClose) {
              event.preventDefault();
            }
          }}
        >
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

              {showInstallProgress && (
                <div className="rounded-xl border border-border-light bg-background-secondary/20 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground-secondary">{t('settings.updateProgressLabel')}</span>
                    <span className="font-medium text-foreground">{installStatusLabel}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <Progress value={installProgressValue} className="h-2.5" />
                    <div className="flex items-center justify-between gap-3 text-xs text-foreground-secondary">
                      <span>{installProgressText}</span>
                      <span>{`${Math.round(installProgressValue)}%`}</span>
                    </div>
                    <p className="text-xs text-foreground-secondary">{installStatusMessage}</p>
                  </div>
                </div>
              )}

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
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={preventDialogClose}>
              {t('settings.updateLater')}
            </Button>
            <Button
              onClick={() => void handleInstall()}
              disabled={installing || installState.phase === 'installer_started'}
            >
              {installActionLabel}
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
