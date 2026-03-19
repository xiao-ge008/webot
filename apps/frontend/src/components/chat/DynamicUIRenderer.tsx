import React, { Suspense } from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import { ErrorBoundary } from 'react-error-boundary';
import {
  Renderer,
  defineRegistry,
  ActionProvider,
  StateProvider,
  VisibilityProvider,
  ValidationProvider,
} from '@json-render/react';
import { schema } from '@json-render/react/schema';
import { shadcnComponents } from '@json-render/shadcn';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import { defineCatalog, nestedToFlat } from '@json-render/core';
import type { ComponentRenderProps } from '@json-render/react';
import { genUiComponents } from '@/lib/genui-registry';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import * as ButtonUi from '@/components/ui/button';
import * as DialogUi from '@/components/ui/dialog';
import * as InputUi from '@/components/ui/input';
import * as LabelUi from '@/components/ui/label';
import * as ScrollAreaUi from '@/components/ui/scroll-area';
import * as SelectUi from '@/components/ui/select';
import * as SwitchUi from '@/components/ui/switch';
import * as TextareaUi from '@/components/ui/textarea';

const catalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,
  },
  actions: {} as any,
});

const { registry } = defineRegistry(catalog, {
  components: {
    ...shadcnComponents,
    ...genUiComponents,
  } as any,
  actions: {} as any,
});

const registryComponents = (registry as any).components ?? {};
const componentNameMap = new Map<string, string>(
  Object.keys(registryComponents).map((key) => [key.toLowerCase(), key]),
);
const SKILL_COMPONENT_CACHE_ENABLED = !import.meta.env.DEV;

const componentsCache: Record<string, any> = {};
const SKILL_IMPORT_TRANSIENT_RE = /Failed to fetch dynamically imported module|Importing a module script failed|skill:\/\//i;
const SKILL_NOT_FOUND_RE = /\b404\b|not found|ERR_FILE_NOT_FOUND|无法找到|未找到/i;
const SKILL_SCHEME_UNSUPPORTED_RE = /URL scheme ["']?skill["']? is not supported|ERR_UNKNOWN_URL_SCHEME|scheme.*not supported/i;
const HTML_TAGS = new Set([
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'pre',
  'code',
  'button',
  'input',
  'label',
  'a',
  'ul',
  'ol',
  'li',
]);

let babelStandalonePromise: Promise<any> | null = null;

interface DynamicUIRendererProps {
  schema: any;
  onAction?: (actionId: string, payload?: any) => void;
  agentId?: string;
  messageId?: string;
}

interface SkillSourcePayload {
  source: string;
  filePath?: string;
}

const ErrorFallback = ({ error }: { error: any }) => (
  <Card className="my-2 border-destructive/30 bg-destructive/5">
    <CardContent className="flex items-start gap-3 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-destructive">组件渲染失败</p>
        <p className="line-clamp-3 break-all font-mono text-xs text-destructive/80">
          {error?.message || String(error)}
        </p>
      </div>
    </CardContent>
  </Card>
);

function normalizeSpecTypes(spec: any): any {
  if (!spec || typeof spec !== 'object' || !spec.elements) return spec;

  const normalizedElements: Record<string, any> = {};
  for (const [key, el] of Object.entries(spec.elements)) {
    if (el && typeof el === 'object' && typeof (el as any).type === 'string') {
      const type = (el as any).type as string;
      if (!registryComponents[type]) {
        const mapped = componentNameMap.get(type.toLowerCase());
        if (mapped) {
          normalizedElements[key] = { ...(el as any), type: mapped };
          continue;
        }
      }
    }
    normalizedElements[key] = el;
  }

  return { ...spec, elements: normalizedElements };
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const currentWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(currentWindow.__TAURI__ || currentWindow.__TAURI_INTERNALS__);
}

function summarizeErrorText(raw: string, max = 220): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function isSchemeUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return SKILL_SCHEME_UNSUPPORTED_RE.test(message);
}

async function getBabelStandalone(): Promise<any> {
  if (!babelStandalonePromise) {
    babelStandalonePromise = import('@babel/standalone').then((mod) => (mod as any).default ?? mod);
  }
  return babelStandalonePromise;
}

async function compileSkillSourceToModule(source: string, filename: string): Promise<Record<string, unknown>> {
  const Babel = await getBabelStandalone();
  const transformed = Babel.transform(source, {
    filename,
    sourceType: 'module',
    presets: [
      ['typescript', { allExtensions: true, isTSX: true }],
      ['react', { runtime: 'automatic' }],
    ],
    plugins: ['transform-modules-commonjs'],
  })?.code as string | undefined;

  if (!transformed || !transformed.trim()) {
    throw new Error('技能源码编译结果为空');
  }

  const module = { exports: {} as Record<string, unknown> };
  const exportsObject = module.exports;

  const requireFn = (id: string) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return ReactJsxRuntime;
    if (id === 'react-dom') return ReactDOM;
    if (id === '@/components/ui/button') return ButtonUi;
    if (id === '@/components/ui/dialog') return DialogUi;
    if (id === '@/components/ui/input') return InputUi;
    if (id === '@/components/ui/label') return LabelUi;
    if (id === '@/components/ui/scroll-area') return ScrollAreaUi;
    if (id === '@/components/ui/select') return SelectUi;
    if (id === '@/components/ui/switch') return SwitchUi;
    if (id === '@/components/ui/textarea') return TextareaUi;
    throw new Error(`动态组件暂不支持导入依赖: ${id}`);
  };

  const executor = new Function('React', 'module', 'exports', 'require', transformed);
  executor(React, module, exportsObject, requireFn);

  const evaluated = module.exports;
  if (evaluated && typeof evaluated === 'object') {
    return evaluated as Record<string, unknown>;
  }
  if (typeof evaluated === 'function') {
    return { default: evaluated as unknown as (...args: any[]) => any };
  }
  throw new Error('技能源码执行后未导出组件');
}

async function importSkillFromTauri(componentName: string, agentId?: string): Promise<Record<string, unknown>> {
  if (!isTauriRuntime()) {
    throw new Error('当前环境不支持 skill:// 协议，且不是 Tauri 运行时');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const payload = await invoke<SkillSourcePayload>('load_skill_component_source', {
    componentName,
    agentId: agentId ?? null,
  });

  if (!payload?.source || typeof payload.source !== 'string') {
    throw new Error(`读取技能源码失败: ${componentName}`);
  }

  return compileSkillSourceToModule(payload.source, payload.filePath || `${componentName}.tsx`);
}

async function importSkillViaBlob(moduleUrl: string): Promise<Record<string, unknown>> {
  const response = await fetch(moduleUrl, { cache: 'no-store' });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`技能模块请求失败(${response.status}): ${summarizeErrorText(body)}`);
  }
  if (/^\s*Compilation Error:/i.test(body)) {
    throw new Error(summarizeErrorText(body, 360));
  }

  const blob = new Blob([body], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function importSkillModule(moduleUrl: string): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ moduleUrl);
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    if (!SKILL_IMPORT_TRANSIENT_RE.test(message)) {
      throw firstError;
    }
    return importSkillViaBlob(moduleUrl);
  }
}

function resolveComponentCacheKey(componentName: string, agentId?: string): string {
  return `${agentId || 'default'}::${componentName}`;
}

function getCachedComponent(componentName: string, agentId?: string): any | null {
  if (!SKILL_COMPONENT_CACHE_ENABLED) return null;
  const cacheKey = resolveComponentCacheKey(componentName, agentId);
  return componentsCache[cacheKey] ?? null;
}

async function loadSkill(componentName: string, agentId?: string): Promise<any> {
  const cacheKey = resolveComponentCacheKey(componentName, agentId);
  if (SKILL_COMPONENT_CACHE_ENABLED && componentsCache[cacheKey]) return componentsCache[cacheKey];

  const baseUrl = `skill://${componentName}/main.js`;
  const queryUrl = agentId ? `${baseUrl}?agentId=${encodeURIComponent(agentId)}` : baseUrl;
  const candidates = [queryUrl, baseUrl].filter((value, index, arr) => arr.indexOf(value) === index);

  let module: Record<string, unknown> | null = null;
  let lastError: unknown = null;

  for (const moduleUrl of candidates) {
    try {
      module = await importSkillModule(moduleUrl);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!module && (isTauriRuntime() || isSchemeUnsupportedError(lastError))) {
    module = await importSkillFromTauri(componentName, agentId);
  }

  if (!module) {
    throw (lastError instanceof Error ? lastError : new Error(`组件加载失败: ${componentName}`));
  }

  const picked =
    (module.default as any)
    ?? (module[componentName] as any)
    ?? Object.values(module).find((item) => typeof item === 'function');

  if (typeof picked !== 'function') {
    throw new Error(`组件模块缺少可用导出: ${componentName}`);
  }

  if (SKILL_COMPONENT_CACHE_ENABLED) {
    componentsCache[cacheKey] = picked;
  }
  return picked;
}

function renderMissingSkillFallback(componentName: string, element: any) {
  const props = element?.props && typeof element.props === 'object' ? element.props : {};
  const title = typeof props.title === 'string'
    ? props.title
    : typeof props.name === 'string'
      ? props.name
      : componentName;
  const content = typeof props.summary === 'string'
    ? props.summary
    : typeof props.description === 'string'
      ? props.description
      : typeof props.content === 'string'
        ? props.content
        : '组件加载失败，已展示文本兜底内容。';

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="break-words whitespace-pre-wrap pt-0 text-sm text-foreground/85">
        {content}
      </CardContent>
    </Card>
  );
}

const RecursiveRenderer = ({
  output,
  agentId,
  onAction,
  messageId,
}: {
  output: any;
  agentId?: string;
  onAction?: (actionId: string, payload?: any) => void;
  messageId?: string;
}) => {
  if (!output) return null;
  if (React.isValidElement(output)) {
    return output;
  }

  const isSchema = typeof output === 'object' && (output.root || output.type);
  if (!isSchema) {
    return output;
  }

  const isNested = !!output.type;
  const flat = isNested ? (nestedToFlat ? nestedToFlat(output) : output) : output;

  if (!flat || typeof flat !== 'object' || !flat.root || !flat.elements) {
    console.error('[GenUI] Invalid schema passed to RecursiveRenderer:', flat, 'Original:', output);
    return (
      <div className="m-2 overflow-auto rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        <strong>无效的界面结构：</strong>
        <pre className="mt-2 break-all text-[10px]">{JSON.stringify(flat || output, null, 2)}</pre>
      </div>
    );
  }

  const patchedElements: Record<string, any> = {};
  for (const [key, el] of Object.entries(flat.elements)) {
    const rawProps = (el as any).props || {};
    const safeProps = {
      ...rawProps,
      ...(typeof onAction === 'function' ? { __onAction: onAction } : {}),
      ...(agentId ? { __agentId: agentId } : {}),
      ...(messageId ? { __messageId: messageId } : {}),
    };
    patchedElements[key] = {
      ...(el as any),
      props: safeProps,
    };
  }

  const patchedFlat = { ...flat, elements: patchedElements };
  const normalizedFlat = normalizeSpecTypes(patchedFlat);

  return (
    <Renderer
      spec={normalizedFlat}
      registry={registry}
      fallback={(props) => <GenUIFallback {...props} agentId={agentId} onAction={onAction} />}
    />
  );
};

function DynamicComponent(
  { componentName, agentId, element, emit, onAction, messageId }: ComponentRenderProps & {
    componentName: string;
    agentId?: string;
    onAction?: (actionId: string, payload?: any) => void;
    messageId?: string;
  },
) {
  const cacheKey = React.useMemo(() => resolveComponentCacheKey(componentName, agentId), [componentName, agentId]);
  const forwardedAction = onAction
    || (typeof (element as any)?.props?.__onAction === 'function'
      ? (element as any).props.__onAction as (actionId: string, payload?: any) => void
      : undefined);
  const rawProps = (element as any)?.props;
  const patchedElement = messageId && rawProps && typeof rawProps === 'object'
      ? {
        ...(element as any),
        props: {
          ...rawProps,
          ...(agentId ? { __agentId: agentId } : {}),
          __messageId: messageId,
        },
      }
    : element;
  const [Component, setComponent] = React.useState<any>(() => getCachedComponent(componentName, agentId));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    const cached = componentsCache[cacheKey];
    if (cached) {
      setComponent(() => cached);
      setError(null);
      return () => {
        isMounted = false;
      };
    }

    setError(null);
    loadSkill(componentName, agentId)
      .then((component) => {
        if (!isMounted) return;
        setComponent(() => component);
      })
      .catch((loadError) => {
        if (!isMounted) return;
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        console.error(`[GenUI] 动态组件加载失败(${componentName}):`, message, loadError);
        if (SKILL_NOT_FOUND_RE.test(message)) {
          setError('__skill_module_missing__');
          return;
        }
        setError(message);
      });

    return () => {
      isMounted = false;
    };
  }, [agentId, cacheKey, componentName]);

  if (error === '__skill_module_missing__') return renderMissingSkillFallback(componentName, element);
  if (error) return <div className="p-2 text-sm text-destructive">组件加载失败：{error}</div>;
  if (!Component) {
    return (
      <Card className="border-border/60 bg-muted/15 shadow-none">
        <CardContent className="flex items-center gap-3 p-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground/85">正在加载组件模块…</div>
            <div className="text-xs text-muted-foreground">首次打开组件时需要先装载本地 UI 模块。</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  let output: any;
  try {
    output = Component({ element: patchedElement, emit, agentId, onAction: forwardedAction });
  } catch (renderError: any) {
    return <div className="p-2 text-sm text-destructive">组件渲染异常：{renderError?.message || String(renderError)}</div>;
  }

  return <RecursiveRenderer output={output} agentId={agentId} onAction={forwardedAction} messageId={messageId} />;
}

const GenUIFallback = (props: ComponentRenderProps & { agentId?: string; onAction?: (actionId: string, payload?: any) => void; messageId?: string }) => {
  const componentName = (props.element.type as string) || 'unknown';
  if (HTML_TAGS.has(componentName.toLowerCase()) && !genUiComponents[componentName]) {
    return null;
  }
  return <DynamicComponent componentName={componentName} agentId={props.agentId} onAction={props.onAction} {...props} />;
};

const DynamicUIRendererBase: React.FC<DynamicUIRendererProps> = ({ schema: uiSchema, onAction, agentId, messageId }) => {
  const schemaObj = uiSchema as any;
  const isNested = schemaObj?.type && !schemaObj?.root;
  const flatSpec = isNested ? (nestedToFlat ? nestedToFlat(schemaObj) : schemaObj) : schemaObj;
  const rendererSpec = flatSpec && flatSpec.elements ? flatSpec : (isNested ? schemaObj : flatSpec);

  const actionHandlers = React.useMemo(() => ({
    '*': async (params: any) => {
      const actionId = (
        (typeof params?.action === 'string' && params.action)
        || (typeof params?.actionId === 'string' && params.actionId)
        || (typeof params?.type === 'string' && params.type)
        || (typeof params?.name === 'string' && params.name)
        || (typeof params?.event === 'string' && params.event)
        || (typeof params?.id === 'string' && params.id)
        || 'unknown'
      );
      onAction?.(actionId, params);
    },
  }), [onAction]);

  if (!rendererSpec) return null;

  const patchedElements: Record<string, any> = {};
  if ((rendererSpec as any).elements) {
    for (const [key, el] of Object.entries((rendererSpec as any).elements)) {
      const rawProps = (el as any).props || {};
      const nextProps = {
        ...rawProps,
        ...(typeof onAction === 'function' ? { __onAction: onAction } : {}),
        ...(agentId ? { __agentId: agentId } : {}),
        ...(messageId ? { __messageId: messageId } : {}),
      };
      patchedElements[key] = {
        ...(el as any),
        props: nextProps,
      };
    }
  }

  const patchedSpec = (rendererSpec as any).elements
    ? { ...(rendererSpec as any), elements: patchedElements }
    : rendererSpec;
  const normalizedFlat = (patchedSpec as any).elements ? normalizeSpecTypes(patchedSpec) : patchedSpec;

  return (
    <div className="genui-renderer w-full">
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <Suspense fallback={<div className="flex justify-center p-4"><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" /></div>}>
          <StateProvider>
            <ValidationProvider>
              <VisibilityProvider>
                <ActionProvider handlers={actionHandlers as any}>
                  <Renderer
                    spec={normalizedFlat}
                    registry={registry}
                    fallback={(props) => <GenUIFallback {...props} agentId={agentId} onAction={onAction} messageId={messageId} />}
                  />
                </ActionProvider>
              </VisibilityProvider>
            </ValidationProvider>
          </StateProvider>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
};

export const DynamicUIRenderer = React.memo(
  DynamicUIRendererBase,
  (prev, next) => prev.schema === next.schema && prev.agentId === next.agentId && prev.messageId === next.messageId,
);
