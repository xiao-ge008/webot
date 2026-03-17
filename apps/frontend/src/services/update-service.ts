import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

const UPDATE_SETTINGS_KEY = 'webot-update-settings-v1';
const UPDATE_INSTALL_PROGRESS_EVENT = 'update-install-progress';
const DEFAULT_GITHUB_OWNER = (import.meta.env.VITE_WEBOT_UPDATE_OWNER as string | undefined)?.trim() || 'xiao-ge008';
const DEFAULT_GITHUB_REPO = (import.meta.env.VITE_WEBOT_UPDATE_REPO as string | undefined)?.trim() || 'webot';

export interface UpdatePreferences {
  autoCheckOnStartup: boolean;
  showReleaseNotes: boolean;
}

export interface AppMetadata {
  version: string;
  platform: string;
  arch: string;
}

interface GithubReleaseAsset {
  id: number;
  name: string;
  browser_download_url: string;
  content_type: string;
  size: number;
}

interface GithubReleasePayload {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  assets: GithubReleaseAsset[];
}

export interface UpdateAsset {
  name: string;
  downloadUrl: string;
  size: number;
  contentType: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  releaseUrl: string;
  asset: UpdateAsset;
}

export type UpdateInstallPhase =
  | 'preparing'
  | 'downloading'
  | 'downloaded'
  | 'launching_installer'
  | 'installer_started'
  | 'failed';

export interface UpdateInstallProgressEvent {
  phase: UpdateInstallPhase;
  downloadedBytes?: number;
  totalBytes?: number;
  progressPercent?: number;
  message?: string;
  fileName?: string;
  installerPath?: string;
  launched?: boolean;
}

interface NormalizedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const globalWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
  return Boolean(globalWindow.__TAURI_INTERNALS__);
}

export function getDefaultUpdatePreferences(): UpdatePreferences {
  return {
    autoCheckOnStartup: true,
    showReleaseNotes: true,
  };
}

export function loadUpdatePreferences(): UpdatePreferences {
  if (typeof window === 'undefined') {
    return getDefaultUpdatePreferences();
  }

  const defaults = getDefaultUpdatePreferences();
  try {
    const raw = localStorage.getItem(UPDATE_SETTINGS_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<UpdatePreferences>;
    return {
      autoCheckOnStartup:
        typeof parsed.autoCheckOnStartup === 'boolean'
          ? parsed.autoCheckOnStartup
          : defaults.autoCheckOnStartup,
      showReleaseNotes:
        typeof parsed.showReleaseNotes === 'boolean'
          ? parsed.showReleaseNotes
          : defaults.showReleaseNotes,
    };
  } catch {
    return defaults;
  }
}

export function saveUpdatePreferences(preferences: UpdatePreferences): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(UPDATE_SETTINGS_KEY, JSON.stringify(preferences));
}

export async function getAppMetadata(): Promise<AppMetadata> {
  if (!isTauriRuntime()) {
    return {
      version: '0.0.0',
      platform: 'web',
      arch: 'web',
    };
  }
  return invoke<AppMetadata>('get_app_metadata');
}

export async function installUpdate(asset: UpdateAsset): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('当前不是桌面运行环境，无法安装更新。');
  }

  await invoke('download_and_install_update', {
    downloadUrl: asset.downloadUrl,
    fileName: asset.name,
  });
}

export async function listenUpdateInstallProgress(
  handler: (event: UpdateInstallProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return async () => {};
  }

  return listen<UpdateInstallProgressEvent>(UPDATE_INSTALL_PROGRESS_EVENT, (event) => {
    handler(event.payload);
  });
}

function normalizeVersion(rawVersion: string): NormalizedVersion | null {
  const trimmed = rawVersion.trim();
  if (!trimmed) {
    return null;
  }

  const matched = trimmed.match(/(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!matched) {
    return null;
  }

  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    prerelease: matched[4]
      ? matched[4]
          .split('.')
          .map((part) => part.trim())
          .filter(Boolean)
      : [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);

  if (leftIsNumeric && rightIsNumeric) {
    const leftValue = Number(left);
    const rightValue = Number(right);
    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
    return 0;
  }

  if (leftIsNumeric) {
    return -1;
  }
  if (rightIsNumeric) {
    return 1;
  }

  return left.localeCompare(right);
}

export function compareVersions(currentVersion: string, nextVersion: string): number {
  const current = normalizeVersion(currentVersion);
  const next = normalizeVersion(nextVersion);
  if (!current || !next) {
    return currentVersion.localeCompare(nextVersion);
  }

  if (current.major !== next.major) {
    return current.major > next.major ? 1 : -1;
  }
  if (current.minor !== next.minor) {
    return current.minor > next.minor ? 1 : -1;
  }
  if (current.patch !== next.patch) {
    return current.patch > next.patch ? 1 : -1;
  }

  const currentPre = current.prerelease;
  const nextPre = next.prerelease;
  if (currentPre.length === 0 && nextPre.length === 0) {
    return 0;
  }
  if (currentPre.length === 0) {
    return 1;
  }
  if (nextPre.length === 0) {
    return -1;
  }

  const maxLength = Math.max(currentPre.length, nextPre.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = currentPre[index];
    const right = nextPre[index];
    if (left === undefined) {
      return -1;
    }
    if (right === undefined) {
      return 1;
    }
    const compared = compareIdentifiers(left, right);
    if (compared !== 0) {
      return compared;
    }
  }

  return 0;
}

function resolveReleaseVersion(release: GithubReleasePayload): string | null {
  const candidates = [release.tag_name, release.name];
  for (const candidate of candidates) {
    const normalized = normalizeVersion(candidate);
    if (normalized) {
      return `${normalized.major}.${normalized.minor}.${normalized.patch}${
        normalized.prerelease.length > 0 ? `-${normalized.prerelease.join('.')}` : ''
      }`;
    }
  }

  const bodyMatch = release.body.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return bodyMatch?.[1] ?? null;
}

function pickReleaseAsset(
  assets: GithubReleaseAsset[],
  metadata: AppMetadata,
): UpdateAsset | null {
  const platform = metadata.platform.toLowerCase();
  const arch = metadata.arch.toLowerCase();
  const normalizedAssets = assets.map((asset) => ({
    ...asset,
    lowerName: asset.name.toLowerCase(),
  }));

  if (platform === 'windows') {
    const windowsAssets = normalizedAssets.filter((asset) => asset.lowerName.endsWith('.msi') || asset.lowerName.endsWith('.exe'));
    const exactArch = windowsAssets.find((asset) => asset.lowerName.includes(arch));
    const target = exactArch ?? windowsAssets[0];
    return target
      ? {
          name: target.name,
          downloadUrl: target.browser_download_url,
          size: target.size,
          contentType: target.content_type,
        }
      : null;
  }

  if (platform === 'macos') {
    const macAssets = normalizedAssets.filter((asset) => asset.lowerName.endsWith('.app.zip'));
    const exactArch = macAssets.find((asset) => asset.lowerName.includes(arch));
    const target = exactArch ?? macAssets[0];
    return target
      ? {
          name: target.name,
          downloadUrl: target.browser_download_url,
          size: target.size,
          contentType: target.content_type,
        }
      : null;
  }

  return null;
}

async function fetchLatestRelease(): Promise<GithubReleasePayload> {
  const response = await fetch(
    `https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases/latest`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`获取 GitHub 发布版本失败: HTTP ${response.status}`);
  }

  return response.json() as Promise<GithubReleasePayload>;
}

export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  const metadata = await getAppMetadata();
  if (metadata.platform === 'web') {
    return null;
  }

  const release = await fetchLatestRelease();
  if (release.draft) {
    return null;
  }

  const latestVersion = resolveReleaseVersion(release);
  if (!latestVersion) {
    throw new Error('GitHub 最新发布缺少可识别的版本号。');
  }

  if (compareVersions(metadata.version, latestVersion) >= 0) {
    return null;
  }

  const asset = pickReleaseAsset(release.assets, metadata);
  if (!asset) {
    throw new Error(`GitHub 最新发布未找到适用于当前平台 (${metadata.platform}/${metadata.arch}) 的安装包。`);
  }

  return {
    currentVersion: metadata.version,
    latestVersion,
    releaseName: release.name || release.tag_name,
    releaseNotes: release.body?.trim() || '',
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    asset,
  };
}
