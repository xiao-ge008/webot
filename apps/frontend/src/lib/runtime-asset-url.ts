import * as React from 'react';
import { getApiBaseUrl } from '@/services/transport';

const LOCAL_SERVICE_ASSET_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/api\/.+)$/i;

export function normalizeRuntimeAssetSource(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  const localMatch = trimmed.match(LOCAL_SERVICE_ASSET_PATTERN);
  if (localMatch?.[1]) {
    return localMatch[1];
  }
  if (trimmed.startsWith('api/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function buildAbsoluteApiUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function resolveCurrentApiAssetPath(raw: string): string {
  return normalizeRuntimeAssetSource(raw);
}

export function isCurrentApiAssetPath(raw: string): boolean {
  return normalizeRuntimeAssetSource(raw).startsWith('/api/');
}

export function useResolvedRuntimeAssetSrc(src?: string): string {
  const source = typeof src === 'string' ? src : '';
  const [resolved, setResolved] = React.useState(source);

  React.useEffect(() => {
    let cancelled = false;
    const normalized = normalizeRuntimeAssetSource(source);
    if (!normalized) {
      setResolved(source);
      return () => {
        cancelled = true;
      };
    }

    if (!normalized.startsWith('/api/')) {
      setResolved(normalized);
      return () => {
        cancelled = true;
      };
    }

    getApiBaseUrl()
      .then((baseUrl) => {
        if (cancelled) return;
        setResolved(buildAbsoluteApiUrl(baseUrl, normalized));
      })
      .catch(() => {
        if (cancelled) return;
        setResolved(normalized);
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  return resolved;
}
