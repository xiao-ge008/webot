import React, { useState } from 'react';
import { Maximize2, Minimize2, Eye, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface PromptEditorProps {
  value: string;
  onChange: (val: string) => void;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({ value, onChange }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPreview, setIsPreview] = useState(false);

  return (
    <div className={cn(
      "relative border rounded-md flex flex-col bg-background transition-all duration-200",
      isFullscreen ? "fixed inset-0 z-[100] m-0 rounded-none h-screen w-screen" : "min-h-[300px]"
    )}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex gap-1">
          <Button 
            variant={isPreview ? "default" : "ghost"} 
            size="sm" 
            onClick={() => setIsPreview(!isPreview)}
            className="h-7 text-xs"
          >
            {isPreview ? <Code className="w-3 h-3 mr-1"/> : <Eye className="w-3 h-3 mr-1"/>}
            {isPreview ? "编辑" : "预览"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Markdown</span>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="h-7 w-7"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5"/> : <Maximize2 className="w-3.5 h-3.5"/>}
          </Button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 relative overflow-hidden">
        {!isPreview ? (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full resize-none border-0 focus-visible:ring-0 p-3 text-sm font-mono leading-relaxed"
            placeholder="在这里输入智能体的核心系统提示词..."
          />
        ) : (
          <div className="absolute inset-0 overflow-auto p-3 text-sm">
            <pre className="whitespace-pre-wrap font-sans">{value || '无内容'}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
