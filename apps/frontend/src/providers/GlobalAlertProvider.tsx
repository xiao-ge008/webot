import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface GlobalAlertState {
  open: boolean;
  title: string;
  message: string;
}

interface GlobalConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
}

interface GlobalAlertContextValue {
  showAlert: (message: string, title?: string) => void;
  showConfirm: (message: string, options?: GlobalConfirmOptions) => Promise<boolean>;
}

const DEFAULT_TITLE = '提示';
const DEFAULT_MESSAGE = '发生未知错误';
const DEFAULT_CONFIRM_TEXT = '确定';
const DEFAULT_CANCEL_TEXT = '取消';
const DEFAULT_CONFIRM_VARIANT: GlobalConfirmState['variant'] = 'default';
const GlobalAlertContext = createContext<GlobalAlertContextValue | null>(null);

interface GlobalConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: 'default' | 'destructive';
  resolver: ((confirmed: boolean) => void) | null;
}

function normalizeAlertMessage(input: unknown): string {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_MESSAGE;
  }
  if (input instanceof Error) {
    const message = input.message.trim();
    return message.length > 0 ? message : DEFAULT_MESSAGE;
  }
  if (input === undefined || input === null) {
    return DEFAULT_MESSAGE;
  }
  return String(input);
}

export function GlobalAlertProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GlobalAlertState>({
    open: false,
    title: DEFAULT_TITLE,
    message: DEFAULT_MESSAGE,
  });
  const [confirmState, setConfirmState] = useState<GlobalConfirmState>({
    open: false,
    title: DEFAULT_TITLE,
    message: DEFAULT_MESSAGE,
    confirmText: DEFAULT_CONFIRM_TEXT,
    cancelText: DEFAULT_CANCEL_TEXT,
    variant: DEFAULT_CONFIRM_VARIANT,
    resolver: null,
  });
  const originalAlertRef = useRef<typeof window.alert | null>(null);

  const showAlert = useCallback((message: string, title = DEFAULT_TITLE) => {
    setState({
      open: true,
      title: title.trim() || DEFAULT_TITLE,
      message: normalizeAlertMessage(message),
    });
  }, []);

  const showConfirm = useCallback((message: string, options?: GlobalConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfirmState((prev) => {
        if (prev.resolver) {
          prev.resolver(false);
        }
        return {
          open: true,
          title: options?.title?.trim() || DEFAULT_TITLE,
          message: normalizeAlertMessage(message),
          confirmText: options?.confirmText?.trim() || DEFAULT_CONFIRM_TEXT,
          cancelText: options?.cancelText?.trim() || DEFAULT_CANCEL_TEXT,
          variant: options?.variant || DEFAULT_CONFIRM_VARIANT,
          resolver: resolve,
        };
      });
    });
  }, []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    setConfirmState((prev) => {
      if (prev.resolver) {
        prev.resolver(confirmed);
      }
      return {
        open: false,
        title: DEFAULT_TITLE,
        message: DEFAULT_MESSAGE,
        confirmText: DEFAULT_CONFIRM_TEXT,
        cancelText: DEFAULT_CANCEL_TEXT,
        variant: DEFAULT_CONFIRM_VARIANT,
        resolver: null,
      };
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!originalAlertRef.current) {
      originalAlertRef.current = window.alert.bind(window);
    }
    window.alert = (message?: unknown) => {
      setState({
        open: true,
        title: DEFAULT_TITLE,
        message: normalizeAlertMessage(message),
      });
    };
    return () => {
      if (originalAlertRef.current) {
        window.alert = originalAlertRef.current;
      }
    };
  }, []);

  const contextValue = useMemo<GlobalAlertContextValue>(() => ({ showAlert, showConfirm }), [showAlert, showConfirm]);
  const confirmIsDestructive = confirmState.variant === 'destructive';

  return (
    <GlobalAlertContext.Provider value={contextValue}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => setState((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-[420px] rounded-3xl border-border/60 p-0 shadow-2xl">
          <div className="space-y-5 p-6">
            <DialogHeader className="space-y-4 text-left">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BellRing className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <DialogTitle className="text-xl font-black leading-tight">{state.title}</DialogTitle>
                <DialogDescription className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {state.message}
                </DialogDescription>
              </div>
            </DialogHeader>
            <DialogFooter className="sm:justify-end">
              <Button className="rounded-full px-5" onClick={() => setState((prev) => ({ ...prev, open: false }))}>
                我知道了
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmState.open}
        onOpenChange={(open) => {
          if (!open) {
            resolveConfirm(false);
          }
        }}
      >
        <DialogContent className="max-w-[440px] rounded-3xl border-border/60 p-0 shadow-2xl">
          <div className="space-y-5 p-6">
            <DialogHeader className="space-y-4 text-left">
              <div
                className={
                  confirmIsDestructive
                    ? 'flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive'
                    : 'flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary'
                }
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <DialogTitle className="text-xl font-black leading-tight">{confirmState.title}</DialogTitle>
                <DialogDescription className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {confirmState.message}
                </DialogDescription>
              </div>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-end">
              <Button variant="outline" className="rounded-full px-5" onClick={() => resolveConfirm(false)}>
                {confirmState.cancelText}
              </Button>
              <Button
                variant={confirmIsDestructive ? 'destructive' : 'default'}
                className="rounded-full px-5"
                onClick={() => resolveConfirm(true)}
              >
                {confirmState.confirmText}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </GlobalAlertContext.Provider>
  );
}

export function useGlobalAlert(): GlobalAlertContextValue {
  const context = useContext(GlobalAlertContext);
  if (!context) {
    throw new Error('useGlobalAlert 必须在 GlobalAlertProvider 内使用');
  }
  return context;
}
