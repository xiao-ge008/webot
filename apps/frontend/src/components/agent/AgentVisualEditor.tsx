import { Activity, Bot, Camera, Image as ImageIcon, UploadCloud, Volume2 } from 'lucide-react';

import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useResolvedRuntimeAssetSrc } from '@/lib/runtime-asset-url';

interface AgentVoiceOption {
  value: string;
  label: string;
  description?: string;
}

interface AgentVisualEditorProps {
  agentName: string;
  avatarUrl?: string;
  portraitUrl?: string;
  portraitEnabled: boolean;
  onPortraitEnabledChange: (value: boolean) => void;
  live2dEnabled: boolean;
  onLive2dEnabledChange: (value: boolean) => void;
  onUploadAvatar?: () => void;
  onUploadPortrait?: () => void;
  uploadingAvatar?: boolean;
  uploadingPortrait?: boolean;
  uploadDisabled?: boolean;
  voiceOptions?: AgentVoiceOption[];
  selectedVoiceValue?: string;
  onSelectedVoiceValueChange?: (value: string) => void;
}

export function AgentVisualEditor({
  agentName,
  avatarUrl,
  portraitUrl,
  portraitEnabled,
  onPortraitEnabledChange,
  live2dEnabled,
  onLive2dEnabledChange,
  onUploadAvatar,
  onUploadPortrait,
  uploadingAvatar,
  uploadingPortrait,
  uploadDisabled,
  voiceOptions = [],
  selectedVoiceValue,
  onSelectedVoiceValueChange,
}: AgentVisualEditorProps) {
  const resolvedPortraitUrl = useResolvedRuntimeAssetSrc(portraitUrl);
  const embodimentMode = typeof onSelectedVoiceValueChange === 'function';
  const previewMode = live2dEnabled
    ? 'live2d'
    : portraitEnabled && resolvedPortraitUrl
      ? 'portrait'
      : avatarUrl
        ? 'avatar'
        : 'empty';

  return (
    <div className="animate-fade-in space-y-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-5 flex flex-col gap-6">
          <Card className="overflow-hidden border-none rounded-[40px] shadow-2xl bg-card relative group">
            <div className="aspect-[3/4] relative flex flex-col items-center justify-center overflow-hidden bg-muted/20">
              {previewMode === 'live2d' ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-12 text-center bg-linear-to-b from-primary/5 to-primary/10">
                  <Bot className="w-24 h-24 text-primary opacity-20 animate-pulse-slow mb-6" />
                  <div className="px-4 py-1.5 bg-primary text-white rounded-full font-black text-[10px] tracking-widest uppercase shadow-xl shadow-primary/30">
                    Live2D
                  </div>
                  <p className="mt-8 text-xs font-bold text-muted-foreground opacity-60 max-w-[200px] leading-relaxed">
                    动态形象模式已开启，适合更强的角色陪伴感展示。
                  </p>
                </div>
              ) : previewMode === 'portrait' ? (
                <img src={resolvedPortraitUrl} alt={agentName} className="w-full h-full object-cover" />
              ) : previewMode === 'avatar' ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-6 bg-linear-to-b from-muted/5 to-muted/20">
                  <AgentAvatar
                    name={agentName || 'A'}
                    avatarUrl={avatarUrl}
                    size="xl"
                    className="w-40 h-40 rounded-full shadow-2xl"
                  />
                  <p className="text-xs font-bold text-muted-foreground">
                    当前仅展示头像，建议继续上传立绘获得更完整效果
                  </p>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-6 p-12 text-center">
                  <div className="w-20 h-20 rounded-full border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
                    <UploadCloud className="w-8 h-8 opacity-40" />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-60">暂无视觉内容</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-7 space-y-6">
          {embodimentMode ? (
            <>
              <Card className="rounded-3xl border bg-card/80 shadow-sm">
                <CardHeader className="p-6 pb-2">
                  <CardTitle className="text-base font-black tracking-tight">默认形象</CardTitle>
                </CardHeader>
                <CardContent className="p-6 pt-2 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border bg-background p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <AgentAvatar name={agentName || 'A'} avatarUrl={avatarUrl} size="xl" className="w-16 h-16" />
                        <div>
                          <div className="text-sm font-semibold">默认头像</div>
                          <div className="text-xs text-muted-foreground">列表、消息头和默认自我形象兜底。</div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs font-medium"
                        onClick={onUploadAvatar}
                        disabled={uploadDisabled || uploadingAvatar || !onUploadAvatar}
                      >
                        <ImageIcon className="w-4 h-4 mr-2" />
                        {uploadingAvatar ? '上传头像中...' : '上传头像'}
                      </Button>
                    </div>
                    <div className="rounded-2xl border bg-background p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-2xl overflow-hidden bg-muted/30 flex items-center justify-center">
                          {resolvedPortraitUrl ? (
                            <img src={resolvedPortraitUrl} alt={agentName} className="w-full h-full object-cover" />
                          ) : (
                            <Camera className="w-6 h-6 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-semibold">默认立绘</div>
                          <div className="text-xs text-muted-foreground">聊天展示、自我图片链优先使用，同时会自动作为个人视频的默认源图。</div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs font-medium"
                        onClick={onUploadPortrait}
                        disabled={uploadDisabled || uploadingPortrait || !onUploadPortrait}
                      >
                        <UploadCloud className="w-4 h-4 mr-2" />
                        {uploadingPortrait ? '上传立绘中...' : '上传立绘'}
                      </Button>
                      <div className="rounded-xl border border-dashed bg-muted/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                        不需要再单独设置视频源。上传立绘后，“用你当前形象生成视频”会优先复用这张图。
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border bg-card/80 shadow-sm">
                <CardHeader className="p-6 pb-2">
                  <CardTitle className="text-base font-black tracking-tight flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-primary" /> 默认声音
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 pt-2 space-y-5">
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase tracking-widest text-foreground/50">默认音色</Label>
                    <Select
                      value={selectedVoiceValue || '__none__'}
                      onValueChange={(value) => onSelectedVoiceValueChange?.(value === '__none__' ? '' : value)}
                    >
                      <SelectTrigger className="rounded-xl h-11 bg-muted/20 border-border shadow-inner">
                        <SelectValue placeholder="未指定" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">未指定，运行时走全局默认音色</SelectItem>
                        {voiceOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {voiceOptions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed bg-muted/20 px-4 py-8 text-sm text-muted-foreground text-center">
                      还没有全局音色可选。请先到设置页的 TTS 中配置全局音色。
                    </div>
                  ) : (
                    <div className="rounded-2xl border bg-muted/10 px-4 py-4 text-sm text-muted-foreground">
                      当前下拉只显示全局 TTS 中已配置好的音色。音色的新增、删除和参数调整统一去设置页完成。
                    </div>
                  )}
                </CardContent>
              </Card>

            </>
          ) : (
            <>
              <Card className="rounded-xl border bg-card/80 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex flex-col items-center justify-center text-center gap-2">
                    <AgentAvatar
                      name={agentName || 'A'}
                      avatarUrl={avatarUrl}
                      size="xl"
                      className="w-24 h-24 rounded-full shadow-md"
                    />
                    <div className="text-sm font-semibold">当前头像</div>
                    <div className="text-xs text-muted-foreground">
                      {avatarUrl ? '已设置头像，将用于列表与聊天头像展示' : '未设置头像，当前使用默认字母头像'}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs font-medium mt-2"
                      onClick={onUploadAvatar}
                      disabled={uploadDisabled || uploadingAvatar || !onUploadAvatar}
                    >
                      <ImageIcon className="w-4 h-4 mr-2" />
                      {uploadingAvatar ? '上传头像中...' : '上传头像'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={cn(
                  'rounded-xl border transition-colors',
                  portraitEnabled ? 'bg-accent/5 border-primary/20 shadow-sm' : 'bg-card shadow-sm opacity-90',
                )}
              >
                <CardHeader className="p-5 pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Camera className={cn('w-4 h-4', portraitEnabled ? 'text-primary' : 'text-muted-foreground')} />
                    立绘展示
                  </CardTitle>
                  <Switch checked={portraitEnabled} onCheckedChange={onPortraitEnabledChange} className="scale-75" />
                </CardHeader>
                <CardContent className="p-5 pt-2 space-y-5">
                  <p className="text-xs text-muted-foreground">只保留视觉操作本身：预览、上传、开关，不再暴露内部 URL。</p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs font-medium"
                      onClick={onUploadPortrait}
                      disabled={uploadDisabled || uploadingPortrait || !onUploadPortrait}
                    >
                      <UploadCloud className="w-4 h-4 mr-2" />
                      {uploadingPortrait ? '上传立绘中...' : '上传立绘'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={cn(
                  'rounded-xl border transition-colors',
                  live2dEnabled ? 'bg-accent/5 border-primary/20 shadow-sm' : 'bg-card shadow-sm opacity-90',
                )}
              >
                <CardHeader className="p-5 pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className={cn('w-4 h-4', live2dEnabled ? 'text-primary' : 'text-muted-foreground')} />
                    Live2D 形象
                  </CardTitle>
                  <Switch checked={live2dEnabled} onCheckedChange={onLive2dEnabledChange} className="scale-75" />
                </CardHeader>
                <CardContent className="p-5 pt-2 space-y-5">
                  <p className="text-xs text-muted-foreground">当前先保留统一入口，后续再接入具体动态模型配置。</p>
                  <Select disabled={!live2dEnabled}>
                    <SelectTrigger className="h-9 rounded-xl text-xs border-muted-foreground/10">
                      <SelectValue placeholder="选择 Live2D 模板" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="model1">Standard Logic Template</SelectItem>
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
