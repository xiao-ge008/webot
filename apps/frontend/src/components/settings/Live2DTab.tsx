import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { UploadCloud, RefreshCw, Save, Copy, FileJson, Check, ExternalLink, Github, Play } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Live2dModelConfig, Live2dMotion, Live2dExpression } from '@/shared/desktop/types';
import { Live2DViewer } from './Live2DViewer';

export function Live2DTab() {
    const { t } = useTranslation();
    const [models, setModels] = useState<Live2dModelConfig[]>([]);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [selectedModel, setSelectedModel] = useState<Live2dModelConfig | null>(null);

    // Github Download states
    const [githubUrl, setGithubUrl] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [githubDialogOpen, setGithubDialogOpen] = useState(false);

    // Form states
    const [motions, setMotions] = useState<Live2dMotion[]>([]);
    const [expressions, setExpressions] = useState<Live2dExpression[]>([]);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);
    const [previewMotion, setPreviewMotion] = useState<string | undefined>();
    const [previewExpression, setPreviewExpression] = useState<string | undefined>();

    // Load models
    const loadModels = async () => {
        setLoading(true);
        try {
            // mock list
            const data: Live2dModelConfig[] = [];
            setModels(data);
            if (selectedModel) {
                const updated = data.find((m) => m.id === selectedModel.id);
                if (updated) {
                    setSelectedModel(updated);
                    setMotions(updated.motions);
                    setExpressions(updated.expressions);
                } else {
                    setSelectedModel(null);
                }
            }
        } catch (error) {
            console.error('[Live2D] Failed to load models:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadModels();
    }, []);

    const handleImport = async () => {
        setImporting(true);
        try {
            // mock import
            setTimeout(() => {
                setImporting(false);
            }, 500);
        } catch (error) {
            console.error('[Live2D] Import failed:', error);
            alert('导入失败');
        }
    };

    const handleDownloadGithub = async () => {
        if (!githubUrl.trim()) return;
        setDownloading(true);
        try {
            // mock download
            setTimeout(() => {
                setDownloading(false);
                setGithubDialogOpen(false);
                setGithubUrl('');
                alert('下载成功！');
            }, 1000);
        } catch (error) {
            console.error('[Live2D] Github download failed:', error);
            alert('下载失败，请检查网络链接是否正确');
            setDownloading(false);
        }
    };

    const handleSelectModel = (model: Live2dModelConfig) => {
        setSelectedModel(model);
        setMotions([...model.motions]);
        setExpressions([...model.expressions]);
        setPreviewMotion(undefined);
        setPreviewExpression(undefined);
    };

    const updateMotion = (index: number, field: 'descriptionCh' | 'descriptionEn', value: string) => {
        const newMotions = [...motions];
        newMotions[index] = { ...newMotions[index], [field]: value };
        setMotions(newMotions);
    };

    const updateExpression = (index: number, field: 'descriptionCh' | 'descriptionEn', value: string) => {
        const newExprs = [...expressions];
        newExprs[index] = { ...newExprs[index], [field]: value };
        setExpressions(newExprs);
    };

    const handleSaveConfig = async () => {
        if (!selectedModel) return;
        setSaving(true);
        try {
            // mock save
            setTimeout(() => {
                alert('保存成功');
                setSaving(false);
                loadModels();
            }, 500);
        } catch (error) {
            console.error('[Live2D] Save failed:', error);
            alert('保存失败');
            setSaving(false);
        }
    };

    const generatePrompt = () => {
        if (!selectedModel) return '';
        let prompt = `【Live2D 控制系统】\n您当前绑定了专属 Live2D 模型。您可以通过在回复中插入特定代码来控制模型的动作和表情。\n\n`;

        if (motions.length > 0) {
            prompt += `## 可用动作 (Motions)\n使用格式: 触发动作\n`;
            motions.forEach(m => {
                const desc = m.descriptionCh || m.descriptionEn || '未命名动作';
                prompt += `- [${m.group}:${m.name}] : ${desc}\n`;
            });
        }

        if (expressions.length > 0) {
            prompt += `\n## 可用表情 (Expressions)\n使用格式: 触发表情\n`;
            expressions.forEach(e => {
                const desc = e.descriptionCh || e.descriptionEn || '未命名表情';
                prompt += `- [${e.name}] : ${desc}\n`;
            });
        }

        prompt += `\n**使用规则**：当您处于特定的情绪或进行特定动作时，请自由使用上述动作或表情增强表现力。`;
        return prompt;
    };

    const handleCopyPrompt = async () => {
        const prompt = generatePrompt();
        if (!prompt) return;
        try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Failed to copy', e);
        }
    };

    return (
        <div className="max-w-4xl animate-fade-in opacity-0">
            <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-semibold">Live2D 资产管理</h2>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 gap-1.5"
                        onClick={handleImport}
                        disabled={importing}
                    >
                        <UploadCloud className={cn("w-3.5 h-3.5", importing && "animate-pulse")} />
                        导入本地资源
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 gap-1.5"
                        onClick={() => setGithubDialogOpen(true)}
                    >
                        <Github className="w-3.5 h-3.5" />
                        下载模型
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 gap-1.5"
                        onClick={() => loadModels()}
                        disabled={loading}
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                        {t('settings.refresh')}
                    </Button>
                </div>
            </div>

            <div className="flex gap-6 h-[50vh]">
                {/* Left Side: Model List */}
                <div className="w-1/3 bg-background-secondary/30 rounded-2xl overflow-hidden border border-border-light/50 flex flex-col">
                    <div className="p-3 border-b border-border-light/50 font-medium text-sm text-foreground-secondary">
                        已安装模型 ({models.length})
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {models.length === 0 && !loading && (
                            <div className="text-center p-4 text-xs text-foreground-tertiary flex flex-col items-center gap-2 mt-4">
                                <p>暂无模型，请导入或下载模型</p>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-primary hover:text-primary hover:bg-primary/10 flex items-center gap-1 mt-2 px-3 py-1.5 rounded-full h-auto"
                                    onClick={() => setGithubDialogOpen(true)}
                                >
                                    获取开源模型 <ExternalLink className="w-3 h-3" />
                                </Button>
                            </div>
                        )}
                        {models.map(model => (
                            <div
                                key={model.id}
                                onClick={() => handleSelectModel(model)}
                                className={cn(
                                    "p-3 rounded-lg cursor-pointer transition-colors border",
                                    selectedModel?.id === model.id
                                        ? "bg-primary/10 border-primary/30"
                                        : "bg-background hover:bg-black/5 dark:hover:bg-white/5 border-transparent"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-accent/10 flex items-center justify-center shrink-0">
                                        <FileJson className="w-4 h-4 text-accent" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-medium truncate">{model.name}</h4>
                                        <p className="text-[10px] text-foreground-tertiary truncate">{model.modelJsonFile}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Side: Config UI */}
                <div className="w-2/3 bg-background-secondary/30 rounded-2xl border border-border-light/50 flex flex-col">
                    {!selectedModel ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-foreground-tertiary text-sm space-y-4">
                            <UploadCloud className="w-10 h-10 opacity-20" />
                            <p>请在左侧选择模型或上传新模型</p>
                            {models.length === 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-primary hover:text-primary hover:bg-transparent flex items-center gap-1 text-xs h-auto p-0"
                                    onClick={() => setGithubDialogOpen(true)}
                                >
                                    去 GitHub 获取测试模型 <ExternalLink className="w-3 h-3" />
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="p-4 border-b border-border-light/50 flex items-center justify-between bg-background/50">
                                <div>
                                    <h3 className="font-semibold">{selectedModel.name}</h3>
                                    <div className="flex gap-2 mt-1">
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                            动作: {motions.length}
                                        </Badge>
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                            表情: {expressions.length}
                                        </Badge>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" className="h-8 gap-1" onClick={handleCopyPrompt}>
                                        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                                        复制提示词
                                    </Button>
                                    <Button size="sm" className="h-8 gap-1" onClick={handleSaveConfig} disabled={saving}>
                                        <Save className="w-3.5 h-3.5" />
                                        保存配置
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-col flex-1 overflow-hidden">
                                {selectedModel && (
                                    <div className="h-[240px] border-b border-border-light/50 bg-black/5 dark:bg-white/5 shrink-0 relative">
                                        <Live2DViewer
                                            modelConfig={selectedModel}
                                            currentMotion={previewMotion}
                                            currentExpression={previewExpression}
                                        />
                                    </div>
                                )}

                                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                                    <div>
                                        <h4 className="text-sm font-semibold mb-3 border-b pb-2">内置动作 (Motions)</h4>
                                        {motions.length === 0 && <p className="text-xs text-foreground-tertiary">无</p>}
                                        <div className="space-y-4">
                                            {motions.map((m, idx) => (
                                                <div key={idx} className="flex flex-col gap-1.5 p-2 border border-transparent hover:border-border/50 rounded-lg group">
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="w-6 h-6 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => setPreviewMotion(m.file)}
                                                            title="播放动作"
                                                        >
                                                            <Play className="w-3.5 h-3.5" />
                                                        </Button>
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {m.group}:{m.name}
                                                        </Badge>
                                                        <span className="text-xs text-foreground-tertiary truncate">{m.file}</span>
                                                    </div>
                                                    <div className="flex gap-3">
                                                        <div className="flex-1">
                                                            <Input
                                                                placeholder="中文说明 (如: 挥手打招呼)"
                                                                className="h-8 text-xs"
                                                                value={m.descriptionCh || ''}
                                                                onChange={(e) => updateMotion(idx, 'descriptionCh', e.target.value)}
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onKeyDown={(e) => e.stopPropagation()}
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <Input
                                                                placeholder="English Desc (e.g. Wave hello)"
                                                                className="h-8 text-xs"
                                                                value={m.descriptionEn || ''}
                                                                onChange={(e) => updateMotion(idx, 'descriptionEn', e.target.value)}
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onKeyDown={(e) => e.stopPropagation()}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <h4 className="text-sm font-semibold mb-3 border-b pb-2">内置表情 (Expressions)</h4>
                                        {expressions.length === 0 && <p className="text-xs text-foreground-tertiary">无</p>}
                                        <div className="space-y-4">
                                            {expressions.map((e, idx) => (
                                                <div key={idx} className="flex flex-col gap-1.5 p-2 border border-transparent hover:border-border/50 rounded-lg group">
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="w-6 h-6 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => setPreviewExpression(e.file)}
                                                            title="播放表情"
                                                        >
                                                            <Play className="w-3.5 h-3.5" />
                                                        </Button>
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {e.name}
                                                        </Badge>
                                                        <span className="text-xs text-foreground-tertiary truncate">{e.file}</span>
                                                    </div>
                                                    <div className="flex gap-3">
                                                        <div className="flex-1">
                                                            <Input
                                                                placeholder="中文说明 (如: 害羞脸红)"
                                                                className="h-8 text-xs"
                                                                value={e.descriptionCh || ''}
                                                                onChange={(e) => updateExpression(idx, 'descriptionCh', e.target.value)}
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onKeyDown={(e) => e.stopPropagation()}
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <Input
                                                                placeholder="English Desc (e.g. Blushing)"
                                                                className="h-8 text-xs"
                                                                value={e.descriptionEn || ''}
                                                                onChange={(e) => updateExpression(idx, 'descriptionEn', e.target.value)}
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onKeyDown={(e) => e.stopPropagation()}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={githubDialogOpen} onOpenChange={setGithubDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>从 GitHub 下载 Live2D 模型</DialogTitle>
                        <DialogDescription>
                            请输入特定模型文件夹的链接。支持开源模型库（例如：<a href="https://github.com/imuncle/live2d/tree/master/model/shizuku" target="_blank" rel="noreferrer" className="text-primary hover:underline">imuncle/live2d...</a>）。<br />
                            <span className="text-destructive font-medium">注意：必须是指向某一个人物文件夹的链接，不能是包含多个子目录的根文件夹。</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="flex flex-col gap-2">
                            <Input
                                id="github-url"
                                placeholder="https://github.com/owner/repo/tree/master/path/model-folder"
                                value={githubUrl}
                                onChange={(e) => setGithubUrl(e.target.value)}
                                disabled={downloading}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGithubDialogOpen(false)} disabled={downloading}>取消</Button>
                        <Button onClick={handleDownloadGithub} disabled={downloading || !githubUrl.trim()}>
                            {downloading ? '下载中...' : '开始下载'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
