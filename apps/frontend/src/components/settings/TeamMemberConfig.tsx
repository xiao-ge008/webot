import { useState, useCallback } from 'react';
import {
    Shield, Search, Globe, FileText,
    FileEdit, FileMinus, Database, Bot, Sparkles,
    ChevronDown, ChevronUp, User, Plus, Trash2, RefreshCw
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { cn } from '@/lib/utils';
import { PromptEditor } from '@/components/PromptEditor';

export interface ToolConfig {
    id: string;
    name: string;
    icon: LucideIcon;
    enabled: boolean;
    description: string;
}

export interface TeamMember {
    id: string;
    name: string;
    role: string;
    avatarUrl?: string;
    systemPrompt: string;
    model: string;
    tools: ToolConfig[];
}

interface TeamToolCatalogItem {
    id: string;
    name: string;
    icon: LucideIcon;
    description: string;
    defaultEnabled: boolean;
}

export const TEAM_TOOL_CATALOG: readonly TeamToolCatalogItem[] = [
    { id: 'sys_search', name: '系统搜索', icon: Search, defaultEnabled: true, description: '允许搜索本地文件和知识库' },
    { id: 'web_request', name: '网络请求', icon: Globe, defaultEnabled: true, description: '允许访问外部互联网 API' },
    { id: 'file_read', name: '文件读取', icon: FileText, defaultEnabled: true, description: '允许读取工作区文件内容' },
    { id: 'file_write', name: '文件写入', icon: FileEdit, defaultEnabled: false, description: '允许创建或修改工作区文件' },
    { id: 'file_delete', name: '文件删除', icon: FileMinus, defaultEnabled: false, description: '允许删除工作区文件 (谨慎开启)' },
    { id: 'mcp_tools', name: 'MCP 工具', icon: Database, defaultEnabled: true, description: '允许调用已配置的 MCP 服务工具' },
] as const;

export function createTeamMemberTools(
    enabledToolIds?: readonly string[],
    overrides?: Readonly<Record<string, { name?: string; enabled?: boolean }>>,
): ToolConfig[] {
    const enabledSet = enabledToolIds ? new Set(enabledToolIds) : null;
    return TEAM_TOOL_CATALOG.map((item) => {
        const override = overrides?.[item.id];
        const enabled = override?.enabled ?? (enabledSet ? enabledSet.has(item.id) : item.defaultEnabled);
        return {
            id: item.id,
            name: override?.name || item.name,
            icon: item.icon,
            enabled,
            description: item.description,
        };
    });
}

interface TeamMemberConfigProps {
    members: TeamMember[];
    onChange: (members: TeamMember[]) => void;
    modelOptions: { modelId: string; displayName: string }[];
    onRefresh?: () => void | Promise<void>;
    refreshing?: boolean;
}

export function TeamMemberConfig({
    members,
    onChange,
    modelOptions,
    onRefresh,
    refreshing = false,
}: TeamMemberConfigProps) {
    const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

    const addMember = useCallback(() => {
        const newMember: TeamMember = {
            id: `member-${Date.now()}`,
            name: `新成员 ${members.length + 1}`,
            role: '子智能体',
            systemPrompt: '',
            model: modelOptions[0]?.modelId || 'gpt-4o',
            tools: createTeamMemberTools(),
        };
        onChange([...members, newMember]);
        setExpandedMemberId(newMember.id);
    }, [members, onChange, modelOptions]);

    const removeMember = useCallback((id: string) => {
        onChange(members.filter(m => m.id !== id));
        if (expandedMemberId === id) setExpandedMemberId(null);
    }, [members, onChange, expandedMemberId]);

    const updateMember = useCallback((id: string, updates: Partial<TeamMember>) => {
        onChange(members.map(m => m.id === id ? { ...m, ...updates } : m));
    }, [members, onChange]);

    const toggleTool = useCallback((memberId: string, toolId: string) => {
        onChange(members.map(m => {
            if (m.id === memberId) {
                return {
                    ...m,
                    tools: m.tools.map(t => t.id === toolId ? { ...t, enabled: !t.enabled } : t)
                };
            }
            return m;
        }));
    }, [members, onChange]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Bot className="w-5 h-5 text-primary" />
                        团队成员配置
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        协作子智能体配置。每个成员可独立配置模型、提示词和工具权限。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={() => {
                            void onRefresh?.();
                        }}
                        size="sm"
                        className="rounded-xl gap-2"
                        disabled={!onRefresh || refreshing}
                    >
                        <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
                        刷新
                    </Button>
                    <Button onClick={addMember} size="sm" className="rounded-xl gap-2 shadow-lg shadow-primary/10">
                        <Plus className="w-4 h-4" />
                        添加成员
                    </Button>
                </div>
            </div>

            <div className="grid gap-4">
                {members.map((member) => (
                    <Card key={member.id} className={cn(
                        "border shadow-none overflow-hidden transition-all duration-300",
                        expandedMemberId === member.id ? "ring-2 ring-primary/20 border-primary/30" : "hover:border-primary/20"
                    )}>
                        {/* Header / Summary */}
                        <div
                            className="p-4 flex items-center justify-between cursor-pointer bg-card/50"
                            onClick={() => setExpandedMemberId(expandedMemberId === member.id ? null : member.id)}
                        >
                            <div className="flex items-center gap-4">
                                <div className="relative">
                                    <AgentAvatar name={member.name} size="md" className="rounded-lg shadow-sm" />
                                    <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary rounded-full border-2 border-card" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold flex items-center gap-2">
                                        {member.name}
                                        <Badge variant="secondary" className="text-[9px] font-black uppercase h-4 px-1 opacity-60">
                                            {member.role}
                                        </Badge>
                                    </h4>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                                            <Sparkles className="w-2.5 h-2.5" />
                                            {modelOptions.find(o => o.modelId === member.model)?.displayName || member.model}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground opacity-30">•</span>
                                        <span className="text-[10px] text-muted-foreground font-medium">
                                            {member.tools.filter(t => t.enabled).length} 个工具可用
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                    onClick={() => removeMember(member.id)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                                <Separator orientation="vertical" className="h-4 mx-1" />
                                {expandedMemberId === member.id ? <ChevronUp className="w-4 h-4 opacity-50" /> : <ChevronDown className="w-4 h-4 opacity-50" />}
                            </div>
                        </div>

                        {/* Details */}
                        {expandedMemberId === member.id && (
                            <CardContent className="p-6 pt-2 space-y-6 border-t bg-background/50 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                    {/* Basic Info */}
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-foreground/70 flex items-center gap-2">
                                                <User className="w-3.5 h-3.5" /> 成员名称
                                            </Label>
                                            <Input
                                                value={member.name}
                                                onChange={e => updateMember(member.id, { name: e.target.value })}
                                                className="rounded-xl bg-background shadow-sm"
                                                placeholder="例如: 财务助理"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-foreground/70 flex items-center gap-2">
                                                <Shield className="w-3.5 h-3.5" /> 角色标识
                                            </Label>
                                            <Input
                                                value={member.role}
                                                onChange={e => updateMember(member.id, { role: e.target.value })}
                                                className="rounded-xl bg-background shadow-sm"
                                                placeholder="例如: 前端开发 / 测试评审"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-foreground/70 flex items-center gap-2">
                                                <Sparkles className="w-3.5 h-3.5" /> 模型
                                            </Label>
                                            <Select
                                                value={member.model}
                                                onValueChange={val => updateMember(member.id, { model: val })}
                                            >
                                                <SelectTrigger className="rounded-xl shadow-sm bg-background">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl">
                                                    {modelOptions.map(opt => (
                                                        <SelectItem key={opt.modelId} value={opt.modelId}>
                                                            {opt.displayName}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {/* Avatar & Permissions summary */}
                                    <div className="p-4 rounded-2xl border border-dashed bg-muted/30 flex items-center gap-6">
                                        <div className="flex flex-col items-center gap-2">
                                            <AgentAvatar name={member.name} size="lg" className="rounded-xl shadow-md ring-4 ring-background" />
                                            <Button variant="ghost" size="sm" className="h-7 text-[10px] font-bold text-primary">修改头像</Button>
                                        </div>
                                        <div className="flex-1 space-y-2">
                                            <h5 className="text-[11px] font-black uppercase text-muted-foreground tracking-widest opacity-60">权限概览</h5>
                                            <div className="flex flex-wrap gap-1.5 font-medium">
                                                {member.tools.filter(t => t.enabled).map(t => (
                                                    <Badge key={t.id} variant="secondary" className="bg-background text-[9px] border-primary/10">
                                                        {t.name}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* System Prompt */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-bold text-foreground/70 flex items-center gap-2">
                                            <FileText className="w-3.5 h-3.5" /> 成员提示词 (System Prompt)
                                        </Label>
                                        <Badge variant="outline" className="text-[9px] opacity-50 uppercase">Private Prompt</Badge>
                                    </div>
                                    <div className="rounded-xl border bg-background overflow-hidden min-h-[160px] shadow-sm">
                                        <PromptEditor
                                            value={member.systemPrompt}
                                            onChange={val => updateMember(member.id, { systemPrompt: val })}
                                        />
                                    </div>
                                </div>

                                {/* Permissions / Tools */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-bold text-foreground/70 flex items-center gap-2">
                                            <Shield className="w-3.5 h-3.5" /> 工具与能力开关
                                        </Label>
                                        <span className="text-[10px] text-muted-foreground italic">开启后成员在委派中可使用对应功能</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {member.tools.map((tool) => (
                                            <div
                                                key={tool.id}
                                                className={cn(
                                                    "p-3 rounded-xl border flex items-center justify-between transition-all",
                                                    tool.enabled ? "bg-primary/5 border-primary/20 shadow-sm" : "bg-muted/20 border-border/50 opacity-60"
                                                )}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-lg flex items-center justify-center",
                                                        tool.enabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                                    )}>
                                                        <tool.icon className="w-4 h-4" />
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <span className="text-[11px] font-bold leading-none">{tool.name}</span>
                                                        <p className="text-[9px] text-muted-foreground line-clamp-1 opacity-70">{tool.description}</p>
                                                    </div>
                                                </div>
                                                <Switch
                                                    checked={tool.enabled}
                                                    onCheckedChange={() => toggleTool(member.id, tool.id)}
                                                    className="scale-75"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        )}
                    </Card>
                ))}

                {members.length === 0 && (
                    <div className="p-12 border-2 border-dashed rounded-3xl text-center space-y-4 bg-muted/5 border-muted-foreground/10">
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto opacity-20">
                            <Bot className="w-8 h-8" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-bold text-foreground opacity-60">暂无团队成员</p>
                            <p className="text-xs text-muted-foreground font-medium opacity-40">主智能体目前是“光杆司令”，请在配置后添加协作专家</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
