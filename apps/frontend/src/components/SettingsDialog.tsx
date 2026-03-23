import { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTheme, type ThemeMode } from '@/providers/ThemeProvider';
import { useUpdateManager } from '@/providers/UpdateProvider';
import { changeLanguage } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  Settings2,
  Settings,
  ChevronLeft,
  Keyboard,
  Cpu,
  Sparkles,
  BrainCircuit,
  Image as ImageIcon,
  Trash2,
  RefreshCw,
  FileText,
  Server,
  UploadCloud,
  Volume2,
} from 'lucide-react';
import type { SkillItem } from '@/main/skills-mcp-types';
import { ProvidersTab } from '@/components/settings/ProvidersTab';
import { ModelsTab } from '@/components/settings/ModelsTab';
import { MemoryEnhancementTab } from '@/components/settings/MemoryEnhancementTab';
import { Live2DTab } from '@/components/settings/Live2DTab';
import { ComponentProvidersTab } from '@/components/settings/ComponentProvidersTab';
import { ImageGenerationTab } from '@/components/settings/ImageGenerationTab';
import { TtsTab } from '@/components/settings/TtsTab';
import { VisionAnalysisTab } from '@/components/settings/VisionAnalysisTab';
import {
  clearGlobalMcpConfig,
  deleteGlobalSkill,
  getGlobalMcpConfig,
  getGlobalSkills,
  getManagementMcpServers,
  importGlobalSkill,
  importGlobalSkillFolder,
  setGlobalMcpConfig,
  type McpServerSummary,
} from '@/services/management-client';

/** 顶部设置入口：从“弹窗”改为“全屏设置页（modal route）” */
export function SettingsDialog() {
  const location = useLocation();

  return (
    <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
      <Link to="/settings" state={{ backgroundLocation: location }}>
        <Settings2 className="h-4 w-4" />
      </Link>
    </Button>
  );
}

/** 全屏设置内容（左右分栏），用于 /settings 页面 */
export function SettingsContent({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');
  const menuGroups = useMemo(
    () => [
      {
        title: t('settings.menu.desktop'),
        items: [
          { id: 'general', label: t('settings.menu.general'), icon: Settings },
          { id: 'shortcuts', label: t('settings.menu.shortcuts'), icon: Keyboard },
        ],
      },
      {
        title: t('settings.menu.server'),
        items: [
          { id: 'providers', label: t('settings.menu.providers'), icon: Cpu },
          { id: 'models', label: t('settings.menu.models'), icon: Sparkles },
          { id: 'imageGeneration', label: t('settings.menu.imageGeneration'), icon: ImageIcon },
          { id: 'tts', label: t('settings.menu.tts', { defaultValue: '语音 / TTS' }), icon: Volume2 },
          { id: 'visionAnalysis', label: t('settings.menu.visionAnalysis', { defaultValue: '视觉分析' }), icon: ImageIcon },
          { id: 'memoryEnhancement', label: t('settings.menu.memoryEnhancement'), icon: BrainCircuit },
        ],
      },
      {
        title: t('settings.menu.extensions'),
        items: [
          { id: 'componentProviders', label: t('settings.menu.componentProviders'), icon: Settings2 },
          { id: 'skills', label: t('settings.menu.skills'), icon: FileText },
          { id: 'mcp', label: t('settings.menu.mcp'), icon: Server },
        ],
      },
      {
        title: 'Assets',
        items: [{ id: 'live2d', label: 'Live2D', icon: UploadCloud }],
      },
    ],
    [t],
  );

  const activeLabel = useMemo(() => {
    for (const group of menuGroups) {
      const match = group.items.find((item) => item.id === activeTab);
      if (match) return match.label;
    }
    return activeTab;
  }, [activeTab, menuGroups]);

  return (
    <div className="h-full w-full flex overflow-hidden bg-background">
      {/* 左侧边栏 */}
      <div className="w-[260px] bg-background-secondary/40 border-r border-border-light flex flex-col">
        {/* 顶部返回（贴近参考图：轻量、无强按钮感） */}
        <div className="h-12 flex items-center px-4">
          <button
            type="button"
            onClick={onBack}
            className={cn(
              // 胶囊返回按钮：淡色背景 + 图标标识，统一全局风格
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full',
              'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15',
              'text-[12px] font-medium text-foreground-secondary hover:text-foreground',
              'transition-apple select-none',
            )}
            aria-label="返回应用"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            返回
          </button>
        </div>

        <div className="flex-1 px-3 space-y-4 overflow-y-auto pt-4 pb-3">
          {menuGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <h4 className="px-2 text-[11px] font-medium text-foreground-tertiary mb-1">{group.title}</h4>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      // 二级菜单：显式左对齐（Button 基础样式可能包含 justify-center）
                      'w-full flex items-center justify-start gap-2 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-apple text-left',
                      isActive
                        ? 'bg-black/5 dark:bg-white/10 text-foreground'
                        : 'text-foreground-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {item.label}
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 overflow-y-auto bg-background relative">
        {/*
          这里是“全屏页面”，不在 Radix Dialog 的上下文中。
          不要使用 DialogTitle/DialogDescription，否则会触发：
          `DialogTitle` must be used within `Dialog` 的运行时错误。
        */}
        <div className="sr-only" aria-hidden="true">
          <h1>{t('settings.general')}</h1>
          <p>{t('settings.pagePending', { name: activeLabel })}</p>
        </div>

        <div className="p-10">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'providers' && <ProvidersTab />}
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'imageGeneration' && <ImageGenerationTab />}
          {activeTab === 'tts' && <TtsTab />}
          {activeTab === 'visionAnalysis' && <VisionAnalysisTab />}
          {activeTab === 'memoryEnhancement' && <MemoryEnhancementTab />}
          {activeTab === 'componentProviders' && <ComponentProvidersTab />}
          {activeTab === 'skills' && <SkillsTab />}
          {activeTab === 'mcp' && <McpTab />}
          {activeTab === 'live2d' && <Live2DTab />}
          {activeTab !== 'general' &&
            activeTab !== 'providers' &&
            activeTab !== 'models' &&
            activeTab !== 'imageGeneration' &&
            activeTab !== 'tts' &&
            activeTab !== 'visionAnalysis' &&
            activeTab !== 'memoryEnhancement' &&
            activeTab !== 'componentProviders' &&
            activeTab !== 'skills' &&
            activeTab !== 'mcp' &&
            activeTab !== 'live2d' && (
              <div className="flex items-center justify-center min-h-[60vh] text-foreground-secondary">
                {t('settings.pagePending', { name: activeLabel })}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

type JsonRecord = Record<string, unknown>;

type McpTransportType = 'stdio' | 'sse' | 'streamableHttp';

type McpConfigMode = 'mcpServers' | 'servers' | 'direct';

interface McpEditingForm {
  id?: string;
  name: string;
  description: string;
  type: McpTransportType;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  longRunning: boolean;
  timeout: string;
}

interface McpServerView {
  id: string;
  name: string;
  description?: string;
  type: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  longRunning?: boolean;
  timeout?: number;
  path?: string;
  connected: boolean;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return rows.length > 0 ? rows : undefined;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.trim().length > 0 && typeof item === 'string' && item.trim().length > 0) {
      output[key] = item;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeMcpType(value: unknown): McpTransportType {
  if (value === 'sse' || value === 'streamableHttp') {
    return value;
  }
  return 'stdio';
}

function parseKeyValueText(text: string): Record<string, string> | undefined {
  const rows = text
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  if (rows.length === 0) {
    return undefined;
  }

  const output: Record<string, string> = {};
  for (const row of rows) {
    const divider = row.indexOf('=');
    if (divider <= 0) {
      continue;
    }
    const key = row.slice(0, divider).trim();
    const value = row.slice(divider + 1).trim();
    if (key && value) {
      output[key] = value;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function stringifyKeyValueRecord(record?: Record<string, string>): string {
  if (!record) {
    return '';
  }
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseArgsText(text: string): string[] | undefined {
  const rows = text
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  return rows.length > 0 ? rows : undefined;
}

function pickJsonRecordMap(value: JsonRecord): Record<string, JsonRecord> {
  const output: Record<string, JsonRecord> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isJsonRecord(item)) {
      output[key] = item;
    }
  }
  return output;
}

function extractStoredMcpConfig(config: unknown): {
  mode: McpConfigMode;
  template: JsonRecord;
  map: Record<string, JsonRecord>;
} {
  if (!isJsonRecord(config)) {
    return { mode: 'mcpServers', template: {}, map: {} };
  }

  if (isJsonRecord(config.mcpServers)) {
    const map = pickJsonRecordMap(config.mcpServers);
    return {
      mode: 'mcpServers',
      template: { ...config },
      map,
    };
  }

  if (isJsonRecord(config.servers)) {
    const map = pickJsonRecordMap(config.servers);
    return {
      mode: 'servers',
      template: { ...config },
      map,
    };
  }

  const topLevelValues = Object.values(config);
  if (
    topLevelValues.length > 0 &&
    topLevelValues.every((value) => isJsonRecord(value))
  ) {
    const map = pickJsonRecordMap(config);
    return {
      mode: 'direct',
      template: {},
      map,
    };
  }

  return {
    mode: 'mcpServers',
    template: { ...config },
    map: {},
  };
}

function buildStoredMcpConfig(
  mode: McpConfigMode,
  template: JsonRecord,
  map: Record<string, JsonRecord>,
): unknown {
  if (mode === 'direct') {
    return map;
  }
  const next: JsonRecord = { ...template };
  if (mode === 'servers') {
    next.servers = map;
    return next;
  }
  next.mcpServers = map;
  return next;
}

function mapSummaryToView(summary: McpServerSummary, connected: boolean): McpServerView {
  const transport = isJsonRecord(summary.transport) ? summary.transport : {};
  return {
    id: summary.name,
    name: summary.name,
    type: normalizeMcpType(transport.type),
    command: toStringValue(transport.command) || undefined,
    args: toStringArray(transport.args),
    url: toStringValue(transport.url) || undefined,
    timeout: toNumberValue(summary.timeout_secs),
    connected,
  };
}

function mapStoredEntryToView(name: string, value: JsonRecord): McpServerView {
  const transport = isJsonRecord(value.transport) ? value.transport : value;
  return {
    id: name,
    name,
    description: toStringValue(value.description) || undefined,
    type: normalizeMcpType(transport.type ?? value.type),
    command: toStringValue(transport.command ?? value.command) || undefined,
    args: toStringArray(transport.args ?? value.args),
    env: toStringRecord(transport.env ?? value.env),
    url: toStringValue(transport.url ?? value.url) || undefined,
    headers: toStringRecord(transport.headers ?? value.headers),
    longRunning: Boolean(value.long_running ?? value.longRunning),
    timeout: toNumberValue(value.timeout_secs ?? value.timeout),
    path: toStringValue(value.path) || undefined,
    connected: false,
  };
}

function mapServerToForm(server: McpServerView): McpEditingForm {
  return {
    id: server.id,
    name: server.name,
    description: server.description ?? '',
    type: server.type,
    command: server.command ?? '',
    argsText: server.args?.join('\n') ?? '',
    envText: stringifyKeyValueRecord(server.env),
    url: server.url ?? '',
    headersText: stringifyKeyValueRecord(server.headers),
    longRunning: Boolean(server.longRunning),
    timeout: typeof server.timeout === 'number' ? String(server.timeout) : '',
  };
}

function createEmptyMcpForm(): McpEditingForm {
  return {
    name: '',
    description: '',
    type: 'stdio',
    command: '',
    argsText: '',
    envText: '',
    url: '',
    headersText: '',
    longRunning: false,
    timeout: '',
  };
}

function buildMcpEntryFromForm(form: McpEditingForm): JsonRecord {
  const transport: JsonRecord = { type: form.type };
  if (form.type === 'stdio') {
    if (form.command.trim()) {
      transport.command = form.command.trim();
    }
    const args = parseArgsText(form.argsText);
    if (args && args.length > 0) {
      transport.args = args;
    }
    const env = parseKeyValueText(form.envText);
    if (env) {
      transport.env = env;
    }
  } else {
    if (form.url.trim()) {
      transport.url = form.url.trim();
    }
    const headers = parseKeyValueText(form.headersText);
    if (headers) {
      transport.headers = headers;
    }
  }

  const entry: JsonRecord = {
    transport,
  };
  if (form.description.trim()) {
    entry.description = form.description.trim();
  }
  if (form.longRunning) {
    entry.long_running = true;
  }
  const timeout = toNumberValue(form.timeout);
  if (typeof timeout === 'number' && timeout > 0) {
    entry.timeout_secs = timeout;
  }
  return entry;
}

function parseImportMcpMap(rawJson: string): Record<string, JsonRecord> {
  const payload = JSON.parse(rawJson) as unknown;
  if (Array.isArray(payload)) {
    const map: Record<string, JsonRecord> = {};
    for (const item of payload) {
      if (!isJsonRecord(item)) {
        continue;
      }
      const name = toStringValue(item.name).trim();
      if (!name) {
        continue;
      }
      map[name] = item;
    }
    return map;
  }

  if (!isJsonRecord(payload)) {
    return {};
  }

  if (isJsonRecord(payload.mcpServers)) {
    return pickJsonRecordMap(payload.mcpServers);
  }
  if (isJsonRecord(payload.servers)) {
    return pickJsonRecordMap(payload.servers);
  }

  const maybeName = toStringValue(payload.name).trim();
  if (maybeName) {
    return {
      [maybeName]: payload,
    };
  }

  return pickJsonRecordMap(payload);
}

/** 通用设置页 */
function GeneralTab() {
  const { t, i18n } = useTranslation();
  const { mode, setMode, fontFamily, setFontFamily, fontSize, setFontSize } = useTheme();
  const {
    supported,
    preferences,
    currentVersion,
    checking,
    setAutoCheckOnStartup,
    setShowReleaseNotes,
    checkNow,
  } = useUpdateManager();

  const [autoLaunch, setAutoLaunchState] = useState(false);
  const [autoLaunchSaving, setAutoLaunchSaving] = useState(false);

  useEffect(() => {
    const loadAppSettings = async () => {
      // mock load
      setAutoLaunchState(false);
    };

    loadAppSettings();
  }, []);

  return (
    <div className="max-w-3xl animate-fade-in opacity-0">
      <h2 className="text-xl font-semibold mb-8">{t('settings.general')}</h2>

      {/* 外观 */}
      <div className="mb-10">
        <h3 className="text-[15px] font-medium text-foreground mb-4">{t('settings.appearance')}</h3>
        <div className="bg-background-secondary/30 rounded-2xl overflow-hidden border border-border-light/50 divide-y divide-border-light/50">

          {/* 语言 */}
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.language')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">{t('settings.languageDesc')}</p>
            </div>
            <div className="w-[140px]">
              <Select value={i18n.language} onValueChange={changeLanguage}>
                <SelectTrigger className="bg-transparent border-none shadow-none !ring-0 !ring-offset-0 focus:!ring-0 focus:!ring-offset-0 focus:ring-0 focus:ring-offset-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:outline-none data-[state=open]:!ring-0 data-[state=open]:!ring-offset-0 text-foreground-secondary hover:text-foreground justify-end gap-2 text-right">
                  <SelectValue className="w-full text-right" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">{t('language.zh')}</SelectItem>
                  <SelectItem value="en">{t('language.en')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 外观模式 */}
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.appearanceMode')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">{t('settings.appearanceModeDesc')}</p>
            </div>
            <div className="w-[140px]">
              <Select value={mode} onValueChange={(val: ThemeMode) => setMode(val)}>
                <SelectTrigger className="bg-transparent border-none shadow-none !ring-0 !ring-offset-0 focus:!ring-0 focus:!ring-offset-0 focus:ring-0 focus:ring-offset-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:outline-none data-[state=open]:!ring-0 data-[state=open]:!ring-offset-0 text-foreground-secondary hover:text-foreground justify-end gap-2 text-right">
                  <SelectValue className="w-full text-right" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">{t('theme.light')}</SelectItem>
                  <SelectItem value="dark">{t('theme.dark')}</SelectItem>
                  <SelectItem value="system">{t('theme.system')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 界面字体 */}
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.interfaceFont')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">{t('settings.interfaceFontDesc')}</p>
            </div>
            <div className="w-[180px]">
              <Select value={fontFamily} onValueChange={setFontFamily}>
                <SelectTrigger className="bg-transparent border-none shadow-none !ring-0 !ring-offset-0 focus:!ring-0 focus:!ring-offset-0 focus:ring-0 focus:ring-offset-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:outline-none data-[state=open]:!ring-0 data-[state=open]:!ring-offset-0 text-foreground-secondary hover:text-foreground justify-end gap-2 text-right">
                  <SelectValue className="w-full text-right" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="'Inter', 'Noto Sans SC', sans-serif">
                    {t('settings.fontInter')}
                  </SelectItem>
                  <SelectItem value="'Roboto', 'Noto Sans SC', sans-serif">
                    {t('settings.fontRoboto')}
                  </SelectItem>
                  <SelectItem value="'Cascadia Code', 'Noto Sans SC', monospace">
                    {t('settings.fontCascadiaCode')}
                  </SelectItem>
                  <SelectItem value="'Open Sans', 'Noto Sans SC', sans-serif">
                    {t('settings.fontOpenSans')}
                  </SelectItem>
                  <SelectItem value="system-ui, sans-serif">
                    {t('settings.fontSystem')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 字体大小 */}
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.fontSize')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">{t('settings.fontSizeDesc')}</p>
            </div>
            <div className="w-[140px]">
              <Select value={String(fontSize)} onValueChange={(val) => setFontSize(Number(val))}>
                <SelectTrigger className="bg-transparent border-none shadow-none !ring-0 !ring-offset-0 focus:!ring-0 focus:!ring-offset-0 focus:ring-0 focus:ring-offset-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:outline-none data-[state=open]:!ring-0 data-[state=open]:!ring-offset-0 text-foreground-secondary hover:text-foreground justify-end gap-2 text-right">
                  <SelectValue className="w-full text-right" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">{t('settings.fontSize12')}</SelectItem>
                  <SelectItem value="13">{t('settings.fontSize13')}</SelectItem>
                  <SelectItem value="14">{t('settings.fontSize14')}</SelectItem>
                  <SelectItem value="15">{t('settings.fontSize15')}</SelectItem>
                  <SelectItem value="16">{t('settings.fontSize16')}</SelectItem>
                  <SelectItem value="18">{t('settings.fontSize18')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

        </div>
      </div>

      {/* 更新 */}
      <div>
        <h3 className="text-[15px] font-medium text-foreground mb-4">{t('settings.update')}</h3>
        <div className="bg-background-secondary/30 rounded-2xl overflow-hidden border border-border-light/50 divide-y divide-border-light/50">

          {/* 启动时检查更新 */}
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.checkUpdateAtStart')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">
                {t('settings.checkUpdateAtStartDesc')}
                {supported && currentVersion ? ` · ${t('settings.currentVersionLabel', { version: currentVersion })}` : ''}
                {!supported ? ` · ${t('settings.updateUnsupportedRuntimeShort')}` : ''}
              </p>
            </div>
            <Switch
              checked={preferences.autoCheckOnStartup}
              onCheckedChange={setAutoCheckOnStartup}
              disabled={!supported}
            />
          </div>

          {/* 发行说明 */}
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.releaseNotes')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">{t('settings.releaseNotesDesc')}</p>
            </div>
            <Switch
              checked={preferences.showReleaseNotes}
              onCheckedChange={setShowReleaseNotes}
              disabled={!supported}
            />
          </div>

          {/* 检查更新 */}
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.checkNow')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">{t('settings.checkNowDesc')}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg bg-background gap-2"
              onClick={() => {
                void checkNow();
              }}
              disabled={checking || !supported}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', checking && 'animate-spin')} />
              {t('settings.checkNow')}
            </Button>
          </div>

        </div>
      </div>

      {/* 启动 */}
      <div className="mt-10">
        <h3 className="text-[15px] font-medium text-foreground mb-4">{t('settings.launch')}</h3>
        <div className="bg-background-secondary/30 rounded-2xl overflow-hidden border border-border-light/50 divide-y divide-border-light/50">
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="text-[15px] font-medium text-foreground">{t('settings.autoLaunch')}</p>
              <p className="text-sm text-foreground-secondary mt-0.5">{t('settings.autoLaunchDesc')}</p>
            </div>
            <Switch
              checked={autoLaunch}
              onCheckedChange={async (checked) => {
                setAutoLaunchSaving(true);
                try {
                  // mock set auto launch
                  setTimeout(() => {
                    setAutoLaunchState(checked);
                    setAutoLaunchSaving(false);
                  }, 500);
                } catch (error) {
                  console.error('[Settings] 设置开机启动失败:', error);
                  setAutoLaunchSaving(false);
                }
              }}
              disabled={autoLaunchSaving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Skills 设置页 */
function SkillsTab() {
  const { t } = useTranslation();
  const isDesktopRuntime = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const globalWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
    return Boolean(globalWindow.__TAURI_INTERNALS__);
  }, []);
  const [skills, setSkills] = useState<Array<SkillItem & { canDelete: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [desktopFolderPath, setDesktopFolderPath] = useState('');
  const [importName, setImportName] = useState('');
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 加载 Skills
  const loadSkills = async () => {
    setLoading(true);
    try {
      const payload = await getGlobalSkills();
      const customItems = payload.items.filter((item) => item.category === 'custom');
      const normalized = customItems.map((item) => ({
        id: item.id,
        metadata: {
          name: item.name,
          description: item.description?.trim() || '未提供功能描述',
          location: '',
        },
        path: item.path,
        isSystem: item.isSystem,
        isNew: item.isImported,
        canDelete: item.canDelete,
      }));
      setSkills(normalized.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)));
    } catch (error) {
      console.error('[Skills] 加载失败:', error);
      alert(t('settings.skillsImportFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 初始化加载
  useEffect(() => {
    loadSkills();
  }, []);

  // 删除 Skill
  const handleDelete = async (skillId: string) => {
    try {
      await deleteGlobalSkill(skillId);
      await loadSkills();
    } catch (error) {
      console.error('[Skills] 删除失败:', error);
      alert(t('settings.skillsDeleteFailed'));
    }
  };

  const openImportDialog = () => {
    setImportDialogOpen(true);
    setImportFiles([]);
    setDesktopFolderPath('');
    setImportName('');
  };

  const handlePickDesktopFolder = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const selected = await invoke<string | null>('pick_skill_folder');
      if (!selected || !selected.trim()) {
        return;
      }
      const normalized = selected.trim();
      setDesktopFolderPath(normalized);
      if (!importName.trim()) {
        const parts = normalized.split(/[\\/]/g).filter(Boolean);
        const guessed = parts[parts.length - 1];
        if (guessed) {
          setImportName(guessed);
        }
      }
    } catch (error) {
      console.error('[Skills] 选择本地文件夹失败:', error);
      setErrorMessage('打开文件夹选择器失败，请重试。');
      setErrorDialogOpen(true);
    }
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    try {
      if (isDesktopRuntime) {
        const sourcePath = desktopFolderPath.trim();
        if (!sourcePath) {
          throw new Error('请先选择本地技能文件夹');
        }
        await importGlobalSkill(sourcePath, true);
      } else {
        if (importFiles.length === 0) {
          throw new Error('请先选择技能文件夹');
        }
        await importGlobalSkillFolder(importFiles, {
          overwrite: true,
          name: importName.trim() || undefined,
        });
      }
      await loadSkills();
      setImportDialogOpen(false);
      setImportFiles([]);
      setDesktopFolderPath('');
      setImportName('');
    } catch (error) {
      console.error('[Skills] 导入失败:', error);
      setErrorMessage(error instanceof Error ? error.message : t('settings.skillsImportFailed'));
      setErrorDialogOpen(true);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-3xl animate-fade-in opacity-0">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-semibold">{t('settings.skillsTitle')}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={openImportDialog}
            disabled={importing}
          >
            <UploadCloud className={cn("w-3.5 h-3.5", importing && "animate-pulse")} />
            {t('settings.skillsImport')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => loadSkills()}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            {t('settings.refresh')}
          </Button>
        </div>
      </div>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>导入自定义SKILL</DialogTitle>
            <DialogDescription>
              {isDesktopRuntime
                ? '选择本地 skill 文件夹后将直接复制到服务端技能目录。'
                : '选择 skill 文件夹后上传，服务端会自动复制并安装。'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>选择技能文件夹</Label>
              {!isDesktopRuntime && (
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  // @ts-expect-error webkitdirectory 为非标准属性，主流浏览器和 WebView 支持
                  webkitdirectory=""
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setImportFiles(files);
                    if (!importName.trim() && files.length > 0) {
                      const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
                      if (rel) {
                        const top = rel.split('/')[0];
                        if (top) {
                          setImportName(top);
                        }
                      }
                    }
                  }}
                />
              )}
              <div className="rounded-xl border border-dashed border-border-light bg-background-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">上传技能文件夹</p>
                    <p className="text-xs text-foreground-tertiary mt-1">
                      {isDesktopRuntime
                        ? '点击右侧按钮选择一个包含 SKILL.md 的本地文件夹'
                        : '点击右侧按钮选择一个包含 SKILL.md 的文件夹'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      if (isDesktopRuntime) {
                        void handlePickDesktopFolder();
                        return;
                      }
                      folderInputRef.current?.click();
                    }}
                  >
                    选择文件夹
                  </Button>
                </div>
                <p className="text-xs text-foreground-tertiary mt-3">
                  {isDesktopRuntime
                    ? (desktopFolderPath
                      ? `已选择目录：${desktopFolderPath}`
                      : '尚未选择任何文件夹')
                    : (importFiles.length > 0
                      ? `已选择 ${importFiles.length} 个文件`
                      : '尚未选择任何文件夹')}
                </p>
              </div>
              <Label>技能名称（可选，默认取文件夹名）</Label>
              <Input
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="my-skill"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                void handleConfirmImport();
              }}
              disabled={
                importing ||
                (isDesktopRuntime ? !desktopFolderPath.trim() : importFiles.length === 0)
              }
            >
              {importing ? '导入中…' : '确认导入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">导入失败</DialogTitle>
            <DialogDescription className="text-foreground-secondary">
              {errorMessage || '请检查技能包结构、权限和路径后重试。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setErrorDialogOpen(false)}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Skills 列表 */}
      <div className="bg-background-secondary/30 rounded-2xl overflow-hidden border border-border-light/50">
        {loading ? (
          <div className="p-8 text-center text-foreground-secondary">
            {t('settings.loading')}
          </div>
        ) : skills.length === 0 ? (
          <div className="p-8 text-center text-foreground-secondary">
            暂无自定义 skill
          </div>
        ) : (
          skills.map((skill, index) => (
            <div
              key={skill.id}
              className={cn(
                "flex items-center justify-between p-5",
                index !== skills.length - 1 && "border-b border-border-light"
              )}
            >
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-[15px] font-medium text-foreground truncate">{skill.metadata.name}</h4>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                      自定义
                    </Badge>
                    {skill.isNew && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                        已导入
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-foreground-secondary line-clamp-1 mb-1">
                    {skill.metadata.description}
                  </p>
                </div>
              </div>
              {skill.canDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-sm text-destructive hover:text-destructive hover:bg-destructive/10 ml-4"
                  onClick={() => {
                    if (confirm(t('settings.skillsDeleteConfirm', { name: skill.metadata.name }))) {
                      handleDelete(skill.id);
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  {t('settings.delete')}
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {/* 说明 */}
      <div className="mt-6 p-4 bg-background-secondary/20 rounded-xl border border-border-light/30">
        <p className="text-xs text-foreground-secondary">
          {t('settings.skillsHint')}
        </p>
      </div>
    </div>
  );
}

/** MCP 设置页 */
function McpTab() {
  const { t } = useTranslation();
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([]);
  const [configMode, setConfigMode] = useState<McpConfigMode>('mcpServers');
  const [configTemplate, setConfigTemplate] = useState<JsonRecord>({});
  const [storedMcpMap, setStoredMcpMap] = useState<Record<string, JsonRecord>>({});
  const [loading, setLoading] = useState(false);
  const [editingServer, setEditingServer] = useState<McpEditingForm | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [jsonInput, setJsonInput] = useState('');

  // 加载 MCP 服务器
  const loadMcpServers = async () => {
    setLoading(true);
    try {
      const [runtime, globalConfig] = await Promise.all([
        getManagementMcpServers(),
        getGlobalMcpConfig(),
      ]);

      const extracted = extractStoredMcpConfig(globalConfig.config);
      setConfigMode(extracted.mode);
      setConfigTemplate(extracted.template);
      setStoredMcpMap(extracted.map);

      const connectedNames = new Set(runtime.connected.map((item) => item.name));
      const merged = new Map<string, McpServerView>();

      for (const [name, value] of Object.entries(extracted.map)) {
        const view = mapStoredEntryToView(name, value);
        view.connected = connectedNames.has(name);
        merged.set(name, view);
      }

      for (const item of runtime.configured) {
        const runtimeView = mapSummaryToView(item, connectedNames.has(item.name));
        const existing = merged.get(item.name);
        if (!existing) {
          merged.set(item.name, runtimeView);
          continue;
        }
        merged.set(item.name, {
          ...runtimeView,
          ...existing,
          connected: existing.connected || runtimeView.connected,
          description: existing.description ?? runtimeView.description,
          path: existing.path ?? runtimeView.path,
        });
      }

      setMcpServers(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error('[MCP] 加载失败:', error);
      alert(t('settings.mcpImportFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 初始化加载
  useEffect(() => {
    loadMcpServers();
  }, []);

  const handleSave = async () => {
    if (!editingServer) return;

    const serverName = editingServer.name.trim();
    if (!serverName) {
      alert(t('settings.mcpNamePlaceholder'));
      return;
    }

    try {
      const nextMap: Record<string, JsonRecord> = { ...storedMcpMap };
      const oldKey = editingServer.id;
      if (oldKey && oldKey !== serverName) {
        delete nextMap[oldKey];
      }
      nextMap[serverName] = buildMcpEntryFromForm({
        ...editingServer,
        name: serverName,
      });
      await setGlobalMcpConfig(buildStoredMcpConfig(configMode, configTemplate, nextMap));
      setStoredMcpMap(nextMap);
      setEditingServer(null);
      await loadMcpServers();
    } catch (error) {
      console.error('[MCP] 保存失败:', error);
      alert(t('settings.mcpCreateFailed'));
    }
  };

  const handleDelete = async (serverId: string) => {
    const target = mcpServers.find((item) => item.id === serverId);
    if (!target) return;
    if (!confirm(t('settings.mcpDeleteConfirm', { name: target.name }))) return;
    try {
      const nextMap: Record<string, JsonRecord> = { ...storedMcpMap };
      delete nextMap[serverId];
      await setGlobalMcpConfig(buildStoredMcpConfig(configMode, configTemplate, nextMap));
      setStoredMcpMap(nextMap);
      await loadMcpServers();
    } catch (error) {
      console.error('[MCP] 删除失败:', error);
      alert(t('settings.mcpDeleteFailed'));
    }
  };

  const handleImport = async () => {
    if (!jsonInput.trim()) {
      alert(t('settings.mcpImportEmpty'));
      return;
    }
    setImporting(true);
    try {
      const importedMap = parseImportMcpMap(jsonInput);
      if (Object.keys(importedMap).length === 0) {
        throw new Error('未检测到可导入的 MCP 服务');
      }

      const nextMap: Record<string, JsonRecord> = { ...storedMcpMap, ...importedMap };
      await setGlobalMcpConfig(buildStoredMcpConfig(configMode, configTemplate, nextMap));
      setStoredMcpMap(nextMap);
      setImportOpen(false);
      setJsonInput('');
      await loadMcpServers();
    } catch (error) {
      console.error('[MCP] 导入失败:', error);
      alert(t('settings.mcpImportFailed'));
    } finally {
      setImporting(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('确认清空全局 MCP 配置吗？')) {
      return;
    }
    try {
      await clearGlobalMcpConfig();
      setConfigMode('mcpServers');
      setConfigTemplate({});
      setStoredMcpMap({});
      await loadMcpServers();
    } catch (error) {
      console.error('[MCP] 清空失败:', error);
      alert(t('settings.mcpDeleteFailed'));
    }
  };

  return (
    <div className="max-w-3xl animate-fade-in opacity-0">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-semibold">{t('settings.mcpTitle')}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => setEditingServer(createEmptyMcpForm())}
          >
            <Settings2 className="w-3.5 h-3.5" />
            {t('settings.mcpCreate')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => setImportOpen(true)}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            {t('settings.mcpImport')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => loadMcpServers()}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            {t('settings.refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5 text-destructive hover:text-destructive"
            onClick={handleClear}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('settings.delete')}
          </Button>
        </div>
      </div>

      {/* MCP 列表 */}
      <div className="bg-background-secondary/30 rounded-2xl overflow-hidden border border-border-light/50">
        {loading ? (
          <div className="p-8 text-center text-foreground-secondary">
            {t('settings.loading')}
          </div>
        ) : mcpServers.length === 0 ? (
          <div className="p-8 text-center text-foreground-secondary">
            {t('settings.noItems')}
          </div>
        ) : (
          mcpServers.map((server, index) => (
            <div
              key={server.id}
              className={cn(
                "flex items-center justify-between p-5",
                index !== mcpServers.length - 1 && "border-b border-border-light"
              )}
            >
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <Server className="w-5 h-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-[15px] font-medium truncate text-foreground">
                      {server.name}
                    </h4>
                    <Badge variant="outline" className="text-[10px] font-normal text-foreground-tertiary px-1.5 py-0 h-5">
                      {server.type}
                    </Badge>
                  </div>
                  {server.path && (
                    <p className="text-xs text-foreground-tertiary truncate">
                      {server.path}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant={server.connected ? 'success' : 'secondary'}
                      className="text-[10px] px-1.5 py-0 h-5"
                    >
                      {server.connected ? t('status.online') : t('status.offline')}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-foreground-secondary hover:text-foreground"
                  onClick={() => setEditingServer(mapServerToForm(server))}
                >
                  <Settings2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-foreground-secondary hover:text-destructive"
                  onClick={() => handleDelete(server.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 说明 */}
      <div className="mt-6 p-4 bg-background-secondary/20 rounded-xl border border-border-light/30">
        <p className="text-xs text-foreground-secondary">
          {t('settings.mcpHint')}
        </p>
      </div>

      <Dialog open={!!editingServer} onOpenChange={(open) => !open && setEditingServer(null)}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-lg font-semibold">
              {editingServer?.id ? t('settings.mcpEditTitle') : t('settings.mcpCreateTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground-secondary">
              {t('settings.mcpCreateDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t('settings.mcpName')}
                </Label>
                <Input
                  value={editingServer?.name ?? ''}
                  onChange={(e) =>
                    setEditingServer((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                  }
                  placeholder={t('settings.mcpNamePlaceholder')}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t('settings.mcpType')}
                </Label>
                <Select
                  value={editingServer?.type ?? 'stdio'}
                  onValueChange={(value: 'stdio' | 'sse' | 'streamableHttp') =>
                    setEditingServer((prev) => (prev ? { ...prev, type: value } : prev))
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">{t('settings.mcpTypeStdio')}</SelectItem>
                    <SelectItem value="sse">{t('settings.mcpTypeSse')}</SelectItem>
                    <SelectItem value="streamableHttp">{t('settings.mcpTypeHttp')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground-secondary">
                {t('settings.mcpDescription')}
              </Label>
              <Input
                value={editingServer?.description ?? ''}
                onChange={(e) =>
                  setEditingServer((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                }
                placeholder={t('settings.mcpDescriptionPlaceholder')}
                className="h-9"
              />
            </div>

            {editingServer?.type === 'stdio' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground-secondary">
                    {t('settings.mcpCommand')}
                  </Label>
                  <Input
                    value={editingServer?.command ?? ''}
                    onChange={(e) =>
                      setEditingServer((prev) => (prev ? { ...prev, command: e.target.value } : prev))
                    }
                    placeholder={t('settings.mcpCommandPlaceholder')}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground-secondary">
                    {t('settings.mcpArgs')}
                  </Label>
                  <Textarea
                    value={editingServer?.argsText ?? ''}
                    onChange={(e) =>
                      setEditingServer((prev) => (prev ? { ...prev, argsText: e.target.value } : prev))
                    }
                    placeholder={t('settings.mcpArgsPlaceholder')}
                    className="min-h-[90px]"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground-secondary">
                    {t('settings.mcpUrl')}
                  </Label>
                  <Input
                    value={editingServer?.url ?? ''}
                    onChange={(e) =>
                      setEditingServer((prev) => (prev ? { ...prev, url: e.target.value } : prev))
                    }
                    placeholder={t('settings.mcpUrlPlaceholder')}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground-secondary">
                    {t('settings.mcpHeaders')}
                  </Label>
                  <Textarea
                    value={editingServer?.headersText ?? ''}
                    onChange={(e) =>
                      setEditingServer((prev) => (prev ? { ...prev, headersText: e.target.value } : prev))
                    }
                    placeholder={t('settings.mcpHeadersPlaceholder')}
                    className="min-h-[90px]"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t('settings.mcpEnv')}
                </Label>
                <Textarea
                  value={editingServer?.envText ?? ''}
                  onChange={(e) =>
                    setEditingServer((prev) => (prev ? { ...prev, envText: e.target.value } : prev))
                  }
                  placeholder={t('settings.mcpEnvPlaceholder')}
                  className="min-h-[90px]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t('settings.mcpTimeout')}
                </Label>
                <Input
                  type="number"
                  value={editingServer?.timeout ?? ''}
                  onChange={(e) =>
                    setEditingServer((prev) => (prev ? { ...prev, timeout: e.target.value } : prev))
                  }
                  placeholder="30"
                  className="h-9"
                />
                <div className="flex items-center justify-between pt-1">
                  <Label className="text-xs font-medium text-foreground-secondary">
                    {t('settings.mcpLongRunning')}
                  </Label>
                  <Switch
                    checked={editingServer?.longRunning ?? false}
                    onCheckedChange={(checked) =>
                      setEditingServer((prev) => (prev ? { ...prev, longRunning: checked } : prev))
                    }
                    className="data-[state=checked]:bg-accent"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-background-secondary/20">
            <DialogClose asChild>
              <Button variant="ghost" className="h-9">
                {t('settings.mcpCancel')}
              </Button>
            </DialogClose>
            <Button className="h-9" onClick={handleSave}>
              {t('settings.mcpSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-lg font-semibold">{t('settings.mcpImportTitle')}</DialogTitle>
            <DialogDescription className="text-sm text-foreground-secondary">
              {t('settings.mcpImportDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            <Textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={t('settings.mcpJsonPlaceholder')}
              className="min-h-[200px]"
            />
          </div>
          <DialogFooter className="px-6 py-4 border-t bg-background-secondary/20">
            <DialogClose asChild>
              <Button variant="ghost" className="h-9">
                {t('settings.mcpCancel')}
              </Button>
            </DialogClose>
            <Button className="h-9" onClick={handleImport} disabled={importing}>
              {t('settings.mcpImport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
