import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  createEmptyComponentDefinition,
  createComponentDefinition,
  deleteComponentDefinition,
  listComponentDefinitions,
  updateComponentDefinition,
  type ComponentDefinition,
  type ComponentParameterMapping,
  type ComponentParamValueType,
  type ComponentProviderType,
  type ComponentReturnType,
  type WorkflowNode,
  type WorkflowNodeField,
} from '@/services/component-client';
import { invalidateComponentSkillRuntimeCaches } from '@/services/agent-client';
import {
  Boxes,
  BrainCircuit,
  FileJson2,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
} from 'lucide-react';

type JsonRecord = Record<string, unknown>;

interface ParsedWorkflowResult {
  requestUrl: string;
  appId: string;
  rawPayload: unknown;
  nodes: WorkflowNode[];
}

interface MappingDraft {
  id: string;
  nodeId: string;
  fieldName: string;
  parameterName: string;
  label: string;
  valueType: ComponentParamValueType;
  description: string;
  defaultValueText: string;
  defaultValue: unknown;
  required: boolean;
  options: unknown[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return '';
  }
}

function parseJsonText<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeEnglishName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function guessValueType(value: unknown): ComponentParamValueType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'string';
}

function normalizeFieldOptions(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
    return value;
  }
  return value.filter((item) => isRecord(item) || ['string', 'number', 'boolean'].includes(typeof item));
}

function readDefaultValue(value: unknown, fallback: unknown): unknown {
  return value !== undefined ? value : fallback;
}

function formatDefaultValueText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  return toPrettyJson(value);
}

function isLikelyLongPromptLikeField(fieldName: string): boolean {
  const key = fieldName.trim().toLowerCase();
  return /lyrics|lyric|tag|tags|prompt|style|theme|mood|desc|description|text|message|content|story|script/.test(key);
}

function sanitizeImportedDefaultValue(fieldName: string, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const compact = trimmed.replace(/\s+/g, ' ');
  if (isLikelyLongPromptLikeField(fieldName) && (trimmed.includes('\n') || compact.length > 48)) {
    return '';
  }
  if (compact.length > 180) {
    return '';
  }
  return trimmed;
}

function inferFieldDescription(fieldName: string, valueType: ComponentParamValueType, existing = ''): string {
  if (existing.trim()) {
    return existing.trim();
  }
  const key = fieldName.trim().toLowerCase();
  if (key.includes('lyrics') || key.includes('lyric')) return '真正歌词正文，支持分段换行。';
  if (key === 'tags' || key.includes('style') || key.includes('mood') || key.includes('theme') || key.includes('prompt')) {
    return '风格、情绪、乐器、节奏、主题等描述信息。';
  }
  if (key.includes('language') || key === 'lang') return '语言代码，例如 zh、en、ja。';
  if (key.includes('second') || key.includes('duration')) return '生成时长，单位秒。';
  if (key.includes('seed')) return '随机种子；留空或修改可得到不同结果。';
  if (key.includes('image') || key.includes('photo') || key.includes('cover')) return '图片 URL、上传资源 URL 或本地可访问路径。';
  if (key.includes('audio') || key.includes('music')) return '音频 URL 或音频相关输入。';
  if (key.includes('video')) return '视频 URL 或视频相关输入。';
  return valueType === 'json' ? 'JSON 结构化参数。' : '';
}

function inferFieldRequired(fieldName: string, currentDefaultValue: unknown, existing?: boolean): boolean {
  if (typeof existing === 'boolean') {
    return existing;
  }
  const key = fieldName.trim().toLowerCase();
  if (typeof currentDefaultValue === 'string' && currentDefaultValue.trim()) {
    return false;
  }
  return /lyrics|lyric|tags|tag|prompt|text|message|content|image|image_url|imageurl|src|url|path/.test(key);
}

type MappingRole = 'content' | 'descriptive' | 'language' | 'duration' | 'asset' | 'generic';

function getMappingRole(fieldName: string): MappingRole {
  const key = fieldName.trim().toLowerCase();
  if (key.includes('lyrics') || key.includes('lyric')) return 'content';
  if (key.includes('language') || key === 'lang') return 'language';
  if (key.includes('second') || key.includes('duration')) return 'duration';
  if (key.includes('image') || key.includes('photo') || key.includes('cover') || key === 'src' || key === 'url' || key === 'path') {
    return 'asset';
  }
  if (key.includes('tag') || key.includes('prompt') || key.includes('style') || key.includes('theme') || key.includes('mood') || key.includes('desc') || key.includes('text') || key.includes('message') || key.includes('content')) {
    return 'descriptive';
  }
  return 'generic';
}

function getMappingRoleLabel(fieldName: string): string {
  switch (getMappingRole(fieldName)) {
    case 'content':
      return '核心内容';
    case 'descriptive':
      return '描述承接';
    case 'language':
      return '语言控制';
    case 'duration':
      return '时长控制';
    case 'asset':
      return '资源输入';
    default:
      return '通用参数';
  }
}

function getMappingRoleHint(fieldName: string): string {
  switch (getMappingRole(fieldName)) {
    case 'content':
      return '这里应该传真实内容本身，例如歌词正文，不能只传主题简介。';
    case 'descriptive':
      return '这里适合承接风格、氛围、乐器、节奏、主题等额外要求。';
    case 'language':
      return '这里控制生成语言，建议只传语言代码。';
    case 'duration':
      return '这里控制长度或秒数，建议保持数字类型。';
    case 'asset':
      return '这里应该传 URL、上传资源地址或本地可访问路径。';
    default:
      return '保持命名清晰，避免让 AI 误判字段用途。';
  }
}

function wasLongDefaultValueIgnored(fieldName: string, value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return sanitizeImportedDefaultValue(fieldName, value) === '';
}

function createNodeField(fieldName: string, value: unknown, extra?: Partial<WorkflowNodeField>): WorkflowNodeField {
  const valueType = extra?.valueType || guessValueType(value);
  const defaultValue = sanitizeImportedDefaultValue(fieldName, readDefaultValue(extra?.defaultValue, value));
  return {
    fieldName,
    label: extra?.label || fieldName,
    valueType,
    description: inferFieldDescription(fieldName, valueType, extra?.description || ''),
    defaultValue,
    options: extra?.options ?? normalizeFieldOptions(value),
  };
}

function parseComfyuiWorkflow(rawText: string): ParsedWorkflowResult {
  const payload = parseJsonText<unknown>(rawText);
  if (!isRecord(payload)) {
    throw new Error('ComfyUI JSON 结构无效');
  }

  const nodes: WorkflowNode[] = [];

  if (Array.isArray(payload.nodes)) {
    for (const item of payload.nodes) {
      if (!isRecord(item)) continue;
      const nodeId = String(item.id ?? '').trim();
      if (!nodeId) continue;
      const inputs = isRecord(item.inputs) ? item.inputs : {};
      const fields = Object.entries(inputs).map(([key, value]) => createNodeField(key, value));
      nodes.push({
        nodeId,
        title: String(item.title || item.type || item.class_type || nodeId),
        nodeType: String(item.type || item.class_type || ''),
        fields,
        raw: item,
      });
    }
  }

  if (nodes.length === 0) {
    for (const [nodeId, item] of Object.entries(payload)) {
      if (!isRecord(item)) continue;
      const inputs = isRecord(item.inputs) ? item.inputs : {};
      const fields = Object.entries(inputs).map(([key, value]) => createNodeField(key, value));
      nodes.push({
        nodeId,
        title: String(item._meta && isRecord(item._meta) ? item._meta.title || item.class_type || nodeId : item.class_type || nodeId),
        nodeType: String(item.class_type || item.type || ''),
        fields,
        raw: item,
      });
    }
  }

  if (nodes.length === 0) {
    throw new Error('未能从 ComfyUI JSON 中解析出节点');
  }

  return {
    requestUrl: '',
    appId: '',
    rawPayload: payload,
    nodes,
  };
}

function extractCurlRequestUrl(text: string): string {
  const urlMatch = text.match(/POST\s+'([^']+)'/) || text.match(/POST\s+"([^"]+)"/) || text.match(/--request\s+POST\s+'([^']+)'/) || text.match(/--request\s+POST\s+"([^"]+)"/);
  return urlMatch?.[1]?.trim() || '';
}

function extractCurlDataRaw(text: string): string {
  const single = text.match(/--data-raw\s+'([\s\S]+)'/);
  if (single?.[1]) return single[1];
  const double = text.match(/--data-raw\s+"([\s\S]+)"/);
  if (double?.[1]) return double[1];
  const dataSingle = text.match(/--data\s+'([\s\S]+)'/);
  if (dataSingle?.[1]) return dataSingle[1];
  const dataDouble = text.match(/--data\s+"([\s\S]+)"/);
  if (dataDouble?.[1]) return dataDouble[1];
  return '';
}

function extractAppId(requestUrl: string): string {
  const match = requestUrl.match(/\/run\/ai-app\/([^/?]+)/);
  return match?.[1]?.trim() || '';
}

function parseRunninghubWorkflow(rawText: string): ParsedWorkflowResult {
  const trimmed = rawText.trim();
  const requestUrl = trimmed.startsWith('curl ') ? extractCurlRequestUrl(trimmed) : '';
  const jsonText = trimmed.startsWith('curl ') ? extractCurlDataRaw(trimmed) : trimmed;
  const payload = parseJsonText<unknown>(jsonText);
  if (!isRecord(payload) || !Array.isArray(payload.nodeInfoList)) {
    throw new Error('RunningHub 内容必须包含 nodeInfoList');
  }

  const grouped = new Map<string, WorkflowNode>();
  for (const item of payload.nodeInfoList) {
    if (!isRecord(item)) continue;
    const nodeId = String(item.nodeId ?? '').trim();
    if (!nodeId) continue;
    const current = grouped.get(nodeId) || {
      nodeId,
      title: `Node ${nodeId}`,
      nodeType: 'runninghub-node',
      fields: [],
      raw: [],
    };
    const fieldName = String(item.fieldName ?? '').trim();
    if (!fieldName) continue;
    current.fields.push(createNodeField(fieldName, item.fieldValue, {
      label: fieldName,
      description: String(item.description ?? ''),
      defaultValue: item.fieldValue ?? '',
      options: (() => {
        const rawFieldData = item.fieldData;
        if (typeof rawFieldData !== 'string') return [];
        try {
          const parsed = JSON.parse(rawFieldData) as unknown;
          if (Array.isArray(parsed)) {
            if (Array.isArray(parsed[0])) return normalizeFieldOptions(parsed[0]);
            return normalizeFieldOptions(parsed);
          }
          return [];
        } catch {
          return [];
        }
      })(),
    }));
    grouped.set(nodeId, current);
  }

  const nodes = Array.from(grouped.values()).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  if (nodes.length === 0) {
    throw new Error('未能从 RunningHub 数据中解析出节点');
  }

  return {
    requestUrl,
    appId: extractAppId(requestUrl),
    rawPayload: payload,
    nodes,
  };
}

function createMappingDraft(field: WorkflowNodeField, node: WorkflowNode, existing?: ComponentParameterMapping): MappingDraft {
  const defaultValue = existing ? existing.defaultValue : sanitizeImportedDefaultValue(field.fieldName, field.defaultValue);
  return {
    id: existing?.id || `${node.nodeId}__${field.fieldName}`,
    nodeId: node.nodeId,
    fieldName: field.fieldName,
    parameterName: existing?.parameterName || normalizeEnglishName(field.fieldName),
    label: existing?.label || field.label || field.fieldName,
    valueType: existing?.valueType || field.valueType || 'string',
    description: existing?.description || inferFieldDescription(field.fieldName, existing?.valueType || field.valueType || 'string', field.description || ''),
    defaultValue,
    defaultValueText: formatDefaultValueText(defaultValue),
    required: inferFieldRequired(existing?.parameterName || field.fieldName, defaultValue, existing?.required),
    options: existing?.options || field.options || [],
  };
}

function summarizeInlinePreview(value: string, max = 72): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max)}...`;
}

function buildMappingExampleValue(mapping: ComponentParameterMapping): unknown {
  const key = mapping.parameterName.trim().toLowerCase();
  if (mapping.valueType === 'number') {
    if (typeof mapping.defaultValue === 'number') return mapping.defaultValue;
    if (key.includes('duration') || key.includes('second')) return 120;
    return 1;
  }
  if (mapping.valueType === 'boolean') {
    return typeof mapping.defaultValue === 'boolean' ? mapping.defaultValue : true;
  }
  if (mapping.valueType === 'json') {
    return mapping.defaultValue ?? {};
  }
  if (
    typeof mapping.defaultValue === 'string'
    && mapping.defaultValue.trim()
    && !isLikelyLongPromptLikeField(mapping.parameterName)
    && mapping.defaultValue.trim().length <= 48
  ) {
    return summarizeInlinePreview(mapping.defaultValue, 72);
  }
  if (key.includes('lyrics')) return '请填写歌词正文，支持分段换行';
  if (key.includes('tag') || key.includes('prompt') || key.includes('style') || key.includes('desc')) {
    return '请填写风格、情绪、乐器、节奏与演唱方式等描述';
  }
  if (key.includes('language')) return 'zh';
  return `请填写${mapping.label || mapping.parameterName}`;
}

function buildPreviewExampleValues(draft: ComponentDefinition): Record<string, unknown> {
  const requiredMappings = draft.workflow.parameterMappings.filter((mapping) => mapping.required);
  const chosen = requiredMappings.length > 0
    ? requiredMappings
    : draft.workflow.parameterMappings.slice(0, 3);
  return Object.fromEntries(chosen.map((mapping) => [mapping.parameterName, buildMappingExampleValue(mapping)]));
}

function buildRenderPreview(draft: ComponentDefinition): Record<string, unknown> {
  return {
    type: draft.componentType || 'ExactComponentType',
    props: {
      autoRun: false,
      initialValues: buildPreviewExampleValues(draft),
    },
  };
}

function buildInvokePreview(draft: ComponentDefinition): Record<string, unknown> {
  return {
    type: 'ComponentInvokeAction',
    props: {
      componentName: draft.englishName || 'exact-component-name',
      params: buildPreviewExampleValues(draft),
      renderResult: draft.returnType !== 'text',
      exposeToAgent: true,
    },
  };
}

function StatsCard({
  title,
  value,
  icon: Icon,
  className,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <Card className="border-border-light/40 bg-card/50 shadow-none">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', className)}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="text-sm text-foreground-secondary">{title}</div>
          <div className="text-2xl font-black tracking-tight text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ComponentCenterPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ComponentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComponentDefinition>(createEmptyComponentDefinition('comfyui'));
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingDraft, setMappingDraft] = useState<MappingDraft | null>(null);
  const [workflowText, setWorkflowText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [editorTab, setEditorTab] = useState<'workflow' | 'mapping'>('workflow');
  const [lastParsedWorkflowText, setLastParsedWorkflowText] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const next = await listComponentDefinitions();
      setItems(next);
    } catch (error) {
      alert(error instanceof Error ? error.message : t('components.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const hasWorkflowSource = workflowText.trim().length > 0;
  const hasParsedWorkflow = draft.workflow.nodes.length > 0;
  const workflowNeedsReparse = !hasParsedWorkflow || workflowText.trim() !== lastParsedWorkflowText;
  const mappingTabDisabled = !hasWorkflowSource || workflowNeedsReparse;

  useEffect(() => {
    if (mappingTabDisabled && editorTab === 'mapping') {
      setEditorTab('workflow');
    }
  }, [editorTab, mappingTabDisabled]);

  const selectedNode = useMemo(
    () => draft.workflow.nodes.find((node) => node.nodeId === selectedNodeId) || null,
    [draft.workflow.nodes, selectedNodeId],
  );

  const stats = useMemo(() => {
    const comfyuiCount = items.filter((item) => item.providerType === 'comfyui').length;
    const runninghubCount = items.filter((item) => item.providerType === 'runninghub').length;
    const totalMappings = items.reduce((count, item) => count + item.workflow.parameterMappings.length, 0);
    return {
      comfyuiCount,
      runninghubCount,
      totalMappings,
    };
  }, [items]);

  const aiUsagePreview = useMemo(() => {
    const renderPreview = toPrettyJson(buildRenderPreview(draft));
    const invokePreview = toPrettyJson(buildInvokePreview(draft));
    const requiredParams = draft.workflow.parameterMappings
      .filter((mapping) => mapping.required)
      .map((mapping) => mapping.parameterName);
    return {
      renderType: draft.componentType || 'ExactComponentType',
      invokeName: draft.englishName || 'exact-component-name',
      requiredParams,
      renderPreview,
      invokePreview,
      preferInvoke: draft.returnType !== 'text',
    };
  }, [draft]);

  const openCreate = (providerType: ComponentProviderType) => {
    setEditingKey(null);
    const next = createEmptyComponentDefinition(providerType);
    setDraft(next);
    setWorkflowText('');
    setLastParsedWorkflowText('');
    setSelectedNodeId('');
    setEditorTab('workflow');
    setDialogOpen(true);
  };

  const openEdit = (item: ComponentDefinition) => {
    setEditingKey(item.englishName);
    setDraft(item);
    const serializedWorkflow = item.workflow.rawPayload == null ? '' : toPrettyJson(item.workflow.rawPayload);
    setWorkflowText(serializedWorkflow);
    setLastParsedWorkflowText(item.workflow.nodes.length > 0 ? serializedWorkflow.trim() : '');
    setSelectedNodeId(item.workflow.nodes[0]?.nodeId || '');
    setEditorTab('workflow');
    setDialogOpen(true);
  };

  const handleImportWorkflow = async () => {
    if (!workflowText.trim()) {
      alert(t('components.editor.workflowEmpty'));
      return;
    }
    setParsing(true);
    try {
      const parsed = draft.providerType === 'runninghub'
        ? parseRunninghubWorkflow(workflowText)
        : parseComfyuiWorkflow(workflowText);
      setDraft((prev) => ({
        ...prev,
        workflow: {
          ...prev.workflow,
          requestUrl: parsed.requestUrl,
          appId: parsed.appId,
          rawPayload: parsed.rawPayload,
          nodes: parsed.nodes,
          parameterMappings: prev.workflow.parameterMappings.filter((mapping) =>
            parsed.nodes.some((node) => node.nodeId === mapping.nodeId && node.fields.some((field) => field.fieldName === mapping.fieldName))),
        },
      }));
      setSelectedNodeId((current) => parsed.nodes.some((node) => node.nodeId === current) ? current : (parsed.nodes[0]?.nodeId || ''));
      setLastParsedWorkflowText(workflowText.trim());
      setEditorTab('mapping');
    } catch (error) {
      alert(error instanceof Error ? error.message : t('components.editor.workflowParseFailed'));
    } finally {
      setParsing(false);
    }
  };

  const handleComfyFileChange = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setWorkflowText(text);
    setEditorTab('workflow');
  };

  const openMappingEditor = (node: WorkflowNode, field: WorkflowNodeField) => {
    const existing = draft.workflow.parameterMappings.find((item) => item.nodeId === node.nodeId && item.fieldName === field.fieldName);
    setMappingDraft(createMappingDraft(field, node, existing));
    setMappingOpen(true);
  };

  const saveMapping = () => {
    if (!mappingDraft) return;
    if (!mappingDraft.parameterName.trim()) {
      alert(t('components.editor.parameterNameRequired'));
      return;
    }
    const nextMapping: ComponentParameterMapping = {
      id: mappingDraft.id,
      nodeId: mappingDraft.nodeId,
      fieldName: mappingDraft.fieldName,
      parameterName: normalizeEnglishName(mappingDraft.parameterName),
      label: mappingDraft.label.trim() || mappingDraft.fieldName,
      valueType: mappingDraft.valueType,
      description: mappingDraft.description.trim(),
      defaultValue: mappingDraft.defaultValue,
      required: mappingDraft.required,
      options: mappingDraft.options,
    };
    setDraft((prev) => {
      const filtered = prev.workflow.parameterMappings.filter((item) => !(item.nodeId === nextMapping.nodeId && item.fieldName === nextMapping.fieldName));
      return {
        ...prev,
        workflow: {
          ...prev.workflow,
          parameterMappings: [...filtered, nextMapping].sort((a, b) => a.parameterName.localeCompare(b.parameterName)),
        },
      };
    });
    setMappingOpen(false);
    setMappingDraft(null);
  };

  const removeMapping = (mapping: ComponentParameterMapping) => {
    setDraft((prev) => ({
      ...prev,
      workflow: {
        ...prev.workflow,
        parameterMappings: prev.workflow.parameterMappings.filter((item) => item.id !== mapping.id),
      },
    }));
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      alert(t('components.editor.nameRequired'));
      return;
    }
    const normalizedEnglishName = normalizeEnglishName(draft.englishName);
    if (!normalizedEnglishName) {
      alert(t('components.editor.englishNameRequired'));
      return;
    }
    if (draft.workflow.nodes.length === 0) {
      alert(t('components.editor.workflowRequired'));
      return;
    }
    const requiredMappings = draft.workflow.parameterMappings.filter((mapping) => mapping.required);
    if (
      draft.returnType !== 'text'
      && requiredMappings.length === 0
      && !window.confirm('当前组件没有标记任何必填参数。媒体生成类组件如果没有必填参数，AI 很容易乱补字段并错误调用。确定仍然保存吗？')
    ) {
      return;
    }
    setSaving(true);
    try {
      const payload: ComponentDefinition = {
        ...draft,
        englishName: normalizedEnglishName,
      };
      if (editingKey) {
        await updateComponentDefinition(editingKey, payload);
      } else {
        await createComponentDefinition(payload);
      }
      invalidateComponentSkillRuntimeCaches();
      setDialogOpen(false);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : t('components.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (englishName: string) => {
    if (!window.confirm(t('components.deleteConfirm'))) {
      return;
    }
    try {
      await deleteComponentDefinition(englishName);
      invalidateComponentSkillRuntimeCaches();
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : t('components.deleteFailed'));
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8 pb-20 animate-fade-in">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background-secondary/40 px-3 py-1 text-xs font-medium text-foreground-secondary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{t('components.badge')}</span>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-foreground">{t('components.title')}</h1>
          <p className="max-w-3xl text-sm leading-6 text-foreground-secondary">{t('components.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className="gap-2" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('settings.refresh')}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => openCreate('comfyui')}>
            <Plus className="h-4 w-4" />
            {t('components.actions.createComfyui')}
          </Button>
          <Button className="gap-2" onClick={() => openCreate('runninghub')}>
            <Plus className="h-4 w-4" />
            {t('components.actions.createRunninghub')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard title={t('components.stats.total')} value={items.length} icon={Boxes} className="bg-slate-900 text-white" />
        <StatsCard title="ComfyUI" value={stats.comfyuiCount} icon={Workflow} className="bg-sky-100 text-sky-600" />
        <StatsCard title="RunningHub" value={stats.runninghubCount} icon={BrainCircuit} className="bg-amber-100 text-amber-600" />
        <StatsCard title={t('components.stats.mappings')} value={stats.totalMappings} icon={Link2} className="bg-emerald-100 text-emerald-600" />
      </div>

      <div className="grid gap-4">
        {items.map((item) => (
          <Card key={item.englishName} className="border-border-light/50 bg-card/60 shadow-none">
            <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-lg font-semibold text-foreground">{item.name}</div>
                  <Badge variant="outline">{item.providerType}</Badge>
                  <Badge variant="secondary">{item.returnType}</Badge>
                </div>
                <div className="text-sm text-foreground-secondary">{item.description || t('components.emptyDescription')}</div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-foreground-tertiary">
                  <span>{t('components.labels.englishName')}: {item.englishName}</span>
                  <span>{t('components.labels.componentType')}: {item.componentType}</span>
                  <span>{t('components.labels.nodeCount', { count: item.workflow.nodes.length })}</span>
                  <span>{t('components.labels.mappingCount', { count: item.workflow.parameterMappings.length })}</span>
                </div>
                <div className="rounded-2xl border border-border-light/50 bg-background-secondary/20 px-3 py-2 text-xs text-foreground-secondary">
                  AI 渲染 type: <span className="font-mono text-foreground">{item.componentType}</span>
                  {' · '}
                  AI 调用 componentName: <span className="font-mono text-foreground">{item.englishName}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => openEdit(item)}>
                  <Pencil className="h-4 w-4" />
                  {t('components.actions.edit')}
                </Button>
                <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={() => void handleDelete(item.englishName)}>
                  <Trash2 className="h-4 w-4" />
                  {t('common.delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && items.length === 0 && (
          <Card className="border-dashed border-border-light/60 bg-background-secondary/20 shadow-none">
            <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <Boxes className="h-10 w-10 text-foreground-tertiary" />
              <div className="text-lg font-semibold text-foreground">{t('components.emptyTitle')}</div>
              <div className="max-w-xl text-sm leading-6 text-foreground-secondary">{t('components.emptyDesc')}</div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-6xl p-0">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>{editingKey ? t('components.editor.editTitle') : t('components.editor.createTitle')}</DialogTitle>
            <DialogDescription>{t('components.editor.description')}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[78vh] overflow-y-auto px-6 py-5">
            <div className="grid gap-6">
              <Card className="border-border-light/40 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">{t('components.editor.basic')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>{t('components.editor.providerType')}</Label>
                    <Select
                      value={draft.providerType}
                      onValueChange={(value: ComponentProviderType) => setDraft((prev) => ({
                        ...prev,
                        providerType: value,
                        workflow: {
                          ...prev.workflow,
                          requestUrl: value === 'runninghub' ? prev.workflow.requestUrl : '',
                          appId: value === 'runninghub' ? prev.workflow.appId : '',
                        },
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="comfyui">ComfyUI</SelectItem>
                        <SelectItem value="runninghub">RunningHub</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('components.editor.returnType')}</Label>
                    <Select
                      value={draft.returnType}
                      onValueChange={(value: ComponentReturnType) => setDraft((prev) => ({ ...prev, returnType: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="image">{t('components.returnTypes.image')}</SelectItem>
                        <SelectItem value="text">{t('components.returnTypes.text')}</SelectItem>
                        <SelectItem value="video">{t('components.returnTypes.video')}</SelectItem>
                        <SelectItem value="audio">{t('components.returnTypes.audio')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('components.editor.name')}</Label>
                    <Input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('components.editor.englishName')}</Label>
                    <Input
                      value={draft.englishName}
                      onChange={(event) => setDraft((prev) => ({ ...prev, englishName: normalizeEnglishName(event.target.value) }))}
                      placeholder="my-component"
                    />
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label>{t('components.editor.descriptionLabel')}</Label>
                    <Textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} className="min-h-[88px]" />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border-light/40 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">AI 使用预览</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-border-light/50 bg-background-secondary/20 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-foreground-tertiary">渲染通道</div>
                      <div className="mt-2 text-sm text-foreground-secondary">当参数还不完整，或者你想让 AI 先把组件卡片展示出来时使用。</div>
                      <div className="mt-3 text-sm text-foreground">type 必须精确写成 <span className="font-mono">{aiUsagePreview.renderType}</span></div>
                    </div>
                    <div className="rounded-2xl border border-border-light/50 bg-background-secondary/20 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-foreground-tertiary">调用通道</div>
                      <div className="mt-2 text-sm text-foreground-secondary">当参数已经齐全，且希望 AI 直接发起生成并把结果回填聊天时使用。</div>
                      <div className="mt-3 text-sm text-foreground">componentName 必须精确写成 <span className="font-mono">{aiUsagePreview.invokeName}</span></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm leading-6 text-emerald-900">
                    推荐策略：{aiUsagePreview.preferInvoke ? '图片 / 视频 / 音频组件在参数齐全时优先走调用通道，并设置 renderResult=true；参数不全时再走渲染通道。' : '文本类组件通常可以直接调用；如果需要用户补参或想先展示表单，再走渲染通道。'}
                    {aiUsagePreview.requiredParams.length > 0 ? ` 当前必填参数：${aiUsagePreview.requiredParams.join('、')}` : ' 当前还没有标记必填参数，这会显著增加 AI 乱补字段和错误调用的概率。'}
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>渲染通道 UI_JSON 示例</Label>
                      <Textarea value={aiUsagePreview.renderPreview} readOnly className="min-h-[220px] font-mono text-xs" />
                    </div>
                    <div className="grid gap-2">
                      <Label>调用通道 UI_JSON 示例</Label>
                      <Textarea value={aiUsagePreview.invokePreview} readOnly className="min-h-[220px] font-mono text-xs" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4">
                <div className="flex flex-col gap-3 rounded-3xl border border-border-light/40 bg-background-secondary/20 p-4">
                  <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <div className="text-base font-semibold text-foreground">{t('components.editor.workflowTitle')}</div>
                      <div className="mt-1 text-sm leading-6 text-foreground-secondary">{t('components.editor.workflowSourceHint')}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={hasWorkflowSource ? 'secondary' : 'outline'}>
                        {hasWorkflowSource ? t('components.editor.workflowLoaded') : t('components.editor.workflowPending')}
                      </Badge>
                      <Badge variant={!workflowNeedsReparse ? 'secondary' : 'outline'}>
                        {!workflowNeedsReparse
                          ? t('components.editor.workflowReady', { count: draft.workflow.nodes.length })
                          : t('components.editor.workflowNotParsed')}
                      </Badge>
                    </div>
                  </div>

                  <Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as 'workflow' | 'mapping')}>
                    <TabsList className="grid h-auto w-full grid-cols-2 rounded-3xl bg-white/80 p-1.5">
                      <TabsTrigger value="workflow" className="h-auto rounded-[20px] px-4 py-3">
                        <div className="flex items-center gap-3 text-left">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-600">
                            <Workflow className="h-5 w-5" />
                          </div>
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-foreground">{t('components.editor.workflowTab')}</div>
                            <div className="text-xs leading-5 text-foreground-secondary">{t('components.editor.workflowTabDesc')}</div>
                          </div>
                        </div>
                      </TabsTrigger>
                      <TabsTrigger
                        value="mapping"
                        disabled={mappingTabDisabled}
                        className="h-auto rounded-[20px] px-4 py-3 disabled:cursor-not-allowed disabled:opacity-100"
                      >
                        <div className="flex items-center gap-3 text-left">
                          <div className={cn(
                            'flex h-11 w-11 items-center justify-center rounded-2xl',
                            mappingTabDisabled ? 'bg-slate-200 text-slate-500' : 'bg-emerald-100 text-emerald-600',
                          )}>
                            <Link2 className="h-5 w-5" />
                          </div>
                          <div className="space-y-1">
                            <div className={cn('text-sm font-semibold', mappingTabDisabled ? 'text-slate-500' : 'text-foreground')}>
                              {t('components.editor.mappingTab')}
                            </div>
                            <div className={cn('text-xs leading-5', mappingTabDisabled ? 'text-slate-400' : 'text-foreground-secondary')}>
                              {mappingTabDisabled ? t('components.editor.mappingTabLockedDesc') : t('components.editor.mappingTabDesc')}
                            </div>
                          </div>
                        </div>
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {mappingTabDisabled ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                      {t('components.editor.mappingDisabledHint')}
                    </div>
                  ) : null}
                </div>

                {editorTab === 'workflow' ? (
                  <Card className="border-border-light/40 shadow-none">
                    <CardHeader>
                      <CardTitle className="text-base">{t('components.editor.workflowTitle')}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4">
                  {draft.providerType === 'comfyui' ? (
                    <div className="grid gap-3">
                      <Label>{t('components.editor.comfyImport')}</Label>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 text-sm text-foreground">
                          <Upload className="h-4 w-4" />
                          <span>{t('components.editor.chooseJson')}</span>
                          <input
                            type="file"
                            accept=".json,application/json"
                            className="hidden"
                            onChange={(event) => void handleComfyFileChange(event.target.files?.[0] || null)}
                          />
                        </label>
                        <Button
                          variant="outline"
                          className="gap-2"
                          onClick={() => void handleImportWorkflow()}
                          disabled={parsing || !workflowText.trim()}
                        >
                          <FileJson2 className="h-4 w-4" />
                          {parsing ? t('settings.loading') : t('components.editor.parseWorkflow')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>{t('components.editor.runninghubRequestUrl')}</Label>
                        <Input
                          value={draft.workflow.requestUrl}
                          onChange={(event) => setDraft((prev) => ({
                            ...prev,
                            workflow: { ...prev.workflow, requestUrl: event.target.value, appId: extractAppId(event.target.value) },
                          }))}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>{t('components.editor.runninghubAppId')}</Label>
                        <Input
                          value={draft.workflow.appId}
                          onChange={(event) => setDraft((prev) => ({
                            ...prev,
                            workflow: { ...prev.workflow, appId: event.target.value },
                          }))}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>{t('components.editor.instanceType')}</Label>
                        <Select
                          value={draft.workflow.runninghubInstanceType}
                          onValueChange={(value) => setDraft((prev) => ({
                            ...prev,
                            workflow: { ...prev.workflow, runninghubInstanceType: value },
                          }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">default (24G)</SelectItem>
                            <SelectItem value="plus">plus (48G)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border-light/50 bg-background-secondary/20 px-4 py-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">{t('components.editor.usePersonalQueue')}</div>
                            <div className="text-xs text-foreground-secondary">{t('components.editor.usePersonalQueueDesc')}</div>
                          </div>
                          <Switch
                            checked={draft.workflow.runninghubUsePersonalQueue}
                            onCheckedChange={(checked) => setDraft((prev) => ({
                              ...prev,
                              workflow: { ...prev.workflow, runninghubUsePersonalQueue: checked },
                            }))}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label>{draft.providerType === 'runninghub' ? t('components.editor.runninghubCurl') : t('components.editor.workflowJson')}</Label>
                    <Textarea
                      value={workflowText}
                      onChange={(event) => {
                        setWorkflowText(event.target.value);
                        if (editorTab !== 'workflow') {
                          setEditorTab('workflow');
                        }
                      }}
                      className="min-h-[220px] font-mono text-xs"
                      placeholder={draft.providerType === 'runninghub' ? 'curl --location --request POST ...' : '{\n  "1": { ... }\n}'}
                    />
                  </div>
                  {draft.providerType === 'runninghub' && (
                    <div className="flex justify-start">
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => void handleImportWorkflow()}
                        disabled={parsing || !workflowText.trim()}
                      >
                        <FileJson2 className="h-4 w-4" />
                        {parsing ? t('settings.loading') : t('components.editor.parseWorkflow')}
                      </Button>
                    </div>
                  )}
                    </CardContent>
                  </Card>

                ) : (
                  <Card className="border-border-light/40 shadow-none">
                    <CardHeader>
                      <CardTitle className="text-base">{t('components.editor.mappingTitle')}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="rounded-3xl border border-border-light/50 bg-background-secondary/20">
                    <div className="border-b px-4 py-3 text-sm font-medium text-foreground">{t('components.editor.nodeTree')}</div>
                    <ScrollArea className="h-[460px]">
                      <div className="grid gap-2 p-3">
                        {draft.workflow.nodes.map((node) => {
                          const selected = node.nodeId === selectedNodeId;
                          return (
                            <button
                              key={node.nodeId}
                              type="button"
                              onClick={() => setSelectedNodeId(node.nodeId)}
                              className={cn(
                                'rounded-2xl border px-3 py-3 text-left transition',
                                selected
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-border-light/50 bg-white/70 text-foreground hover:border-slate-300',
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-medium">{node.title || node.nodeId}</div>
                                <Badge variant={selected ? 'secondary' : 'outline'}>{node.nodeId}</Badge>
                              </div>
                              <div className={cn('mt-1 text-xs', selected ? 'text-white/70' : 'text-foreground-secondary')}>
                                {node.nodeType || t('components.editor.unknownNodeType')}
                              </div>
                            </button>
                          );
                        })}
                        {draft.workflow.nodes.length === 0 && (
                          <div className="px-3 py-12 text-center text-sm text-foreground-secondary">
                            {t('components.editor.nodeEmpty')}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-border-light/50 bg-white/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-foreground">
                            {selectedNode?.title || t('components.editor.selectNode')}
                          </div>
                          <div className="text-xs text-foreground-secondary">
                            {selectedNode ? `${selectedNode.nodeType || '-'} / ${selectedNode.nodeId}` : t('components.editor.nodeHint')}
                          </div>
                        </div>
                        {selectedNode ? (
                          <Badge variant="outline">{selectedNode.fields.length} fields</Badge>
                        ) : null}
                      </div>
                      <Separator className="my-4" />
                      <div className="grid gap-3">
                        {(selectedNode?.fields || []).map((field) => {
                          const mapping = draft.workflow.parameterMappings.find((item) => item.nodeId === selectedNode?.nodeId && item.fieldName === field.fieldName);
                          const recommendedRequired = inferFieldRequired(field.fieldName, sanitizeImportedDefaultValue(field.fieldName, field.defaultValue));
                          const ignoredLongDefault = wasLongDefaultValueIgnored(field.fieldName, field.defaultValue);
                          return (
                            <div key={field.fieldName} className="rounded-2xl border border-border-light/50 bg-background p-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="space-y-1">
                                  <div className="text-sm font-medium text-foreground">{field.label || field.fieldName}</div>
                                  <div className="text-xs text-foreground-secondary">{field.description || field.fieldName}</div>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground-tertiary">
                                    <span>{t('components.editor.fieldType')}: {field.valueType}</span>
                                    {field.options.length > 0 ? <span>{t('components.editor.fieldOptions', { count: field.options.length })}</span> : null}
                                    <span>角色: {getMappingRoleLabel(field.fieldName)}</span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {recommendedRequired ? (
                                      <Badge variant="secondary" className="text-[10px]">建议必填</Badge>
                                    ) : null}
                                    {ignoredLongDefault ? (
                                      <Badge variant="outline" className="text-[10px]">长默认值已忽略</Badge>
                                    ) : null}
                                  </div>
                                  <div className="text-[11px] leading-5 text-foreground-tertiary">
                                    {getMappingRoleHint(field.fieldName)}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {mapping ? <Badge>{mapping.parameterName}</Badge> : <Badge variant="outline">{t('components.editor.unmapped')}</Badge>}
                                  <Button variant="outline" size="sm" className="gap-2" onClick={() => selectedNode && openMappingEditor(selectedNode, field)}>
                                    <Link2 className="h-4 w-4" />
                                    {mapping ? t('components.actions.editMapping') : t('components.actions.createMapping')}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-border-light/50 bg-background-secondary/20 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-base font-semibold text-foreground">{t('components.editor.mappingList')}</div>
                        <Badge variant="outline">{draft.workflow.parameterMappings.length}</Badge>
                      </div>
                      <div className="grid gap-3">
                        {draft.workflow.parameterMappings.map((mapping) => (
                          <div key={mapping.id} className="flex flex-col gap-3 rounded-2xl border border-border-light/50 bg-white/80 p-4 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-foreground">{mapping.label || mapping.parameterName}</div>
                              <div className="text-xs text-foreground-secondary">
                                {mapping.nodeId} / {mapping.fieldName} → {mapping.parameterName}
                              </div>
                              <div className="text-xs text-foreground-tertiary">{mapping.description || t('components.editor.noMappingDescription')}</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={mapping.required ? 'default' : 'outline'} className="text-[10px]">
                                  {mapping.required ? '必填' : '可选'}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px]">
                                  {getMappingRoleLabel(mapping.parameterName || mapping.fieldName)}
                                </Badge>
                                {wasLongDefaultValueIgnored(mapping.parameterName || mapping.fieldName, mapping.defaultValue) ? (
                                  <Badge variant="outline" className="text-[10px]">长默认值已忽略</Badge>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{mapping.valueType}</Badge>
                              <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={() => removeMapping(mapping)}>
                                <Trash2 className="h-4 w-4" />
                                {t('common.delete')}
                              </Button>
                            </div>
                          </div>
                        ))}
                        {draft.workflow.parameterMappings.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-border-light/60 px-4 py-8 text-center text-sm text-foreground-secondary">
                            {t('components.editor.mappingEmpty')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                    </CardContent>
                  </Card>
                )}
            </div>
          </div>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button className="gap-2" onClick={() => void handleSave()} disabled={saving}>
              <Sparkles className="h-4 w-4" />
              {saving ? t('settings.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mappingOpen} onOpenChange={setMappingOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('components.editor.mappingDialogTitle')}</DialogTitle>
            <DialogDescription>{t('components.editor.mappingDialogDesc')}</DialogDescription>
          </DialogHeader>
          {mappingDraft ? (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t('components.editor.fieldSource')}</Label>
                  <Input value={`${mappingDraft.nodeId} / ${mappingDraft.fieldName}`} readOnly />
                </div>
                <div className="grid gap-2">
                  <Label>{t('components.editor.valueType')}</Label>
                  <Select
                    value={mappingDraft.valueType}
                    onValueChange={(value: ComponentParamValueType) => setMappingDraft((prev) => prev ? ({ ...prev, valueType: value }) : prev)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">string</SelectItem>
                      <SelectItem value="number">number</SelectItem>
                      <SelectItem value="boolean">boolean</SelectItem>
                      <SelectItem value="json">json</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>{t('components.editor.parameterName')}</Label>
                  <Input
                    value={mappingDraft.parameterName}
                    onChange={(event) => setMappingDraft((prev) => prev ? ({ ...prev, parameterName: normalizeEnglishName(event.target.value) }) : prev)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t('components.editor.parameterLabel')}</Label>
                  <Input
                    value={mappingDraft.label}
                    onChange={(event) => setMappingDraft((prev) => prev ? ({ ...prev, label: event.target.value }) : prev)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t('components.editor.mappingDescription')}</Label>
                <Textarea
                  value={mappingDraft.description}
                  onChange={(event) => setMappingDraft((prev) => prev ? ({ ...prev, description: event.target.value }) : prev)}
                  className="min-h-[84px]"
                />
              </div>
              <div className="grid gap-2">
                <Label>{t('components.editor.defaultValue')}</Label>
                <Textarea
                  value={mappingDraft.defaultValueText}
                  className="min-h-[84px] font-mono text-xs"
                  readOnly
                />
                <div className="rounded-2xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {t('components.editor.defaultValueLockedDesc')}
                </div>
                <div className="rounded-2xl border border-sky-200/70 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
                  <div>字段角色：{getMappingRoleLabel(mappingDraft.parameterName || mappingDraft.fieldName)}</div>
                  <div>{getMappingRoleHint(mappingDraft.parameterName || mappingDraft.fieldName)}</div>
                  {wasLongDefaultValueIgnored(mappingDraft.parameterName || mappingDraft.fieldName, mappingDraft.defaultValue) ? (
                    <div>检测到工作流里带了长默认提示词，组件中心已自动忽略，避免技能生成时把默认文案误当成用户输入。</div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border-light/50 bg-background-secondary/20 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{t('components.editor.required')}</div>
                  <div className="text-xs text-foreground-secondary">{t('components.editor.requiredDesc')}</div>
                </div>
                <Switch
                  checked={mappingDraft.required}
                  onCheckedChange={(checked) => setMappingDraft((prev) => prev ? ({ ...prev, required: checked }) : prev)}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMappingOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveMapping}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
