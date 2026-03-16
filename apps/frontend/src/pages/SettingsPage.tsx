import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SettingsContent } from '@/components/SettingsDialog';

type LocationWithBackground = {
  backgroundLocation?: unknown;
};

function hasBackgroundLocation(state: unknown): state is LocationWithBackground {
  return !!state && typeof state === 'object' && 'backgroundLocation' in state;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = useCallback(() => {
    if (hasBackgroundLocation(location.state) && location.state.backgroundLocation) {
      navigate(-1);
      return;
    }
    navigate('/home', { replace: true });
  }, [location.state, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBack]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    // 需要盖住应用内固定 Header（z-50）等浮层，否则会出现“被遮挡/返回按钮看不到”
    <div className="fixed inset-0 z-[60] bg-background">
      <SettingsContent onBack={handleBack} />
    </div>
  );
}
