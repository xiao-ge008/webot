import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { cn } from '@/lib/utils';
import { listManagementAgents } from '@/services/management-client';
import { createChatGroup } from '@/services/group-client';
import { DEFAULT_GROUP_LIMITS } from '@/types/group';
import { mapManagementAgentToUi } from '@/components/chat/chat-page-helpers';
import {
    Users,
    Search,
    CheckCircle2,
    Info,
    Hash,
    Plus,
    X,
} from 'lucide-react';

export function CreateGroupPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const [agentsLoading, setAgentsLoading] = useState(true);
    const [agents, setAgents] = useState<Array<ReturnType<typeof mapManagementAgentToUi>>>([]);
    const [agentsLoadError, setAgentsLoadError] = useState('');

    const [name, setName] = useState('');
    const [groupId, setGroupId] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
    const [isCreating, setIsCreating] = useState(false);

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        setName(newName);
        if (!groupId) {
            setGroupId(newName.toLowerCase().replace(/[^a-z0-9]/g, '-'));
        }
    };

    const addTag = () => {
        if (tagInput && !tags.includes(tagInput)) {
            setTags([...tags, tagInput]);
            setTagInput('');
        }
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(t => t !== tagToRemove));
    };

    const toggleAgent = (agentId: string) => {
        setSelectedAgentIds(prev =>
            prev.includes(agentId)
                ? prev.filter(id => id !== agentId)
                : [...prev, agentId]
        );
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setAgentsLoading(true);
            setAgentsLoadError('');
            try {
                const rows = await listManagementAgents();
                if (cancelled) return;
                setAgents(rows.map(mapManagementAgentToUi));
            } catch (error) {
                if (cancelled) return;
                setAgents([]);
                setAgentsLoadError(error instanceof Error ? error.message : String(error));
            } finally {
                if (!cancelled) setAgentsLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, []);

    const filteredAgents = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return agents;
        return agents.filter(agent =>
            agent.name.toLowerCase().includes(query) ||
            agent.expertise.some(e => e.toLowerCase().includes(query))
        );
    }, [agents, searchQuery]);

    const handleCreate = async () => {
        if (!name.trim() || selectedAgentIds.length === 0) return;
        if (isCreating) return;
        setIsCreating(true);
        try {
            const leaderAgentId = selectedAgentIds[0];
            const group = await createChatGroup({
                groupId: groupId.trim() || undefined,
                name: name.trim(),
                description: description.trim(),
                tags,
                leaderAgentId,
                memberAgentIds: selectedAgentIds,
                groupMode: 'leader_dispatch',
                limits: DEFAULT_GROUP_LIMITS,
                applyCollaborationAcl: true,
            });
            navigate(`/group-chat/${encodeURIComponent(group.groupId)}`);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <main className="flex justify-center px-6 pt-24 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="w-full max-w-4xl">
                    {/* 居中头部操作区 */}
                    <div className="flex flex-col items-center text-center gap-6 mb-12">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                                <Users className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <h1 className="text-2xl font-black tracking-tight">{t('home.createGroup.title')}</h1>
                                <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest opacity-60 mt-0.5">
                                    {t('home.groups.createDesc')}
                                </p>
                            </div>
                        </div>
                        <Button
                            size="lg"
                            disabled={!name || selectedAgentIds.length === 0 || isCreating}
                            onClick={handleCreate}
                            className="rounded-full px-12 font-black uppercase tracking-widest text-[11px] h-11 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl shadow-primary/20 transition-all hover:scale-105 active:scale-95"
                        >
                            {isCreating ? t('common.loading', { defaultValue: '创建中...' }) : t('home.createGroup.submit')}
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-6">

                    {/* 基础资料卡片 */}
                    <Card className="border-none shadow-none bg-card/40 rounded-4xl overflow-hidden ring-1 ring-border/50">
                        <CardHeader className="pb-4 pt-8 px-8">
                            <CardTitle className="text-base font-black flex items-center gap-2 uppercase tracking-tight">
                                <Info className="w-4 h-4 text-primary" />
                                {t('home.createGroup.basicInfo')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6 px-8 pb-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="group-name" className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">{t('home.createGroup.name')}</Label>
                                    <Input
                                        id="group-name"
                                        placeholder={t('home.createGroup.namePlaceholder')}
                                        value={name}
                                        onChange={handleNameChange}
                                        className="h-12 bg-background/50 border-muted-foreground/10 rounded-xl focus-visible:ring-primary/30 transition-all font-medium"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center ml-1">
                                        <Label htmlFor="group-id" className="text-[11px] font-black uppercase tracking-widest opacity-70">{t('home.createGroup.groupId', { defaultValue: 'Group ID' })}</Label>
                                        <Badge variant="outline" className="text-[9px] font-black opacity-50 uppercase tracking-tighter">System Unique</Badge>
                                    </div>
                                    <Input
                                        id="group-id"
                                        placeholder="e.g. project-x"
                                        value={groupId}
                                        onChange={(e) => setGroupId(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
                                        className="h-12 bg-muted/30 border-muted-foreground/10 rounded-xl focus-visible:ring-primary/30 transition-all font-mono text-xs font-bold"
                                    />
                                    <p className="text-[10px] text-muted-foreground ml-1 mt-1 font-medium">{t('home.createGroup.groupIdDesc', { defaultValue: '仅支持由英文字母、数字和连字符组成' })}</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="group-desc" className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">{t('home.createGroup.description')}</Label>
                                <Textarea
                                    id="group-desc"
                                    placeholder={t('home.createGroup.descriptionPlaceholder')}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="min-h-[100px] bg-background/50 border-muted-foreground/10 rounded-2xl resize-none focus-visible:ring-primary/30 p-4 transition-all"
                                />
                            </div>

                            <div className="space-y-3">
                                <Label className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">{t('home.createGroup.tags')}</Label>
                                <div className="flex flex-wrap gap-2 min-h-[32px]">
                                    {tags.map(tag => (
                                        <Badge key={tag} variant="secondary" className="pl-3 pr-2 py-1 gap-1.5 rounded-full border-none bg-primary/10 text-primary group transition-all">
                                            <span className="text-[10px] font-black uppercase tracking-widest">{tag}</span>
                                            <X className="w-3 h-3 cursor-pointer opacity-50 group-hover:opacity-100" onClick={() => removeTag(tag)} />
                                        </Badge>
                                    ))}
                                    {tags.length === 0 && (
                                        <span className="text-[10px] text-muted-foreground font-bold italic opacity-40 ml-1 py-1 uppercase">{t('home.createGroup.noTags')}</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground opacity-30" />
                                        <Input
                                            placeholder={t('home.createGroup.addTag')}
                                            value={tagInput}
                                            onChange={(e) => setTagInput(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                                            className="pl-9 bg-background/50 border-muted-foreground/10 rounded-xl h-10 transition-all"
                                        />
                                    </div>
                                    <Button variant="secondary" onClick={addTag} className="rounded-xl px-4 h-10">
                                        <Plus className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 成员选择卡片 */}
                    <Card className="border-none shadow-none bg-card/40 rounded-4xl overflow-hidden ring-1 ring-border/50">
                        <CardHeader className="pb-4 pt-8 px-8">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-base font-black flex items-center gap-2 uppercase tracking-tight">
                                    <Users className="w-4 h-4 text-primary" />
                                    {t('home.createGroup.selectMembers')}
                                </CardTitle>
                                <Badge variant="secondary" className="rounded-full px-3 py-1 bg-primary/10 text-primary font-black text-[10px] uppercase tracking-widest">
                                    {t('home.createGroup.selectedCount', { count: selectedAgentIds.length })}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 px-8 pb-8">
                            <div className="relative">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground opacity-30" />
                                <Input
                                    placeholder={t('home.createGroup.searchAgents')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-10 h-11 bg-background/50 border-muted-foreground/10 rounded-2xl transition-all"
                                />
                            </div>

                            <Separator className="bg-border/20" />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                {agentsLoading && (
                                    <div className="col-span-full py-12 text-center space-y-3 opacity-60">
                                        <Users className="w-10 h-10 text-muted-foreground mx-auto animate-pulse" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">
                                            {t('common.loading', { defaultValue: '加载中...' })}
                                        </p>
                                    </div>
                                )}
                                {!agentsLoading && agentsLoadError && (
                                    <div className="col-span-full py-12 text-center space-y-3 opacity-70">
                                        <Users className="w-10 h-10 text-muted-foreground mx-auto" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">
                                            {t('home.createGroup.noAgentsFound', { defaultValue: '加载智能体失败' })}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">{agentsLoadError}</p>
                                    </div>
                                )}
                                {!agentsLoading && !agentsLoadError && filteredAgents.map(agent => {
                                    const isSelected = selectedAgentIds.includes(agent.id);
                                    return (
                                        <div
                                            key={agent.id}
                                            onClick={() => toggleAgent(agent.id)}
                                            className={cn(
                                                "group relative flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer select-none",
                                                isSelected
                                                    ? "border-primary bg-primary/5 shadow-sm"
                                                    : "border-border/40 hover:border-primary/40 hover:bg-primary/5 bg-background/20"
                                            )}
                                        >
                                            <AgentAvatar
                                                name={agent.name}
                                                avatarUrl={agent.avatarUrl}
                                                color={agent.color}
                                                size="default"
                                                className="w-10 h-10 rounded-xl group-hover:scale-105 transition-transform"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-black text-sm truncate">{agent.name}</p>
                                                <p className="text-[10px] text-muted-foreground font-black uppercase tracking-tighter opacity-50">
                                                    {agent.expertise[0]}
                                                </p>
                                            </div>
                                            {isSelected && (
                                                <div className="bg-primary text-primary-foreground rounded-full p-0.5 shadow-sm">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {!agentsLoading && !agentsLoadError && filteredAgents.length === 0 && (
                                    <div className="col-span-full py-12 text-center space-y-3 opacity-30">
                                        <Users className="w-10 h-10 text-muted-foreground mx-auto" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">{t('home.createGroup.noAgentsFound')}</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
                </div>
            </main>
        </div>
    );
}
