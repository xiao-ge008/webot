import * as React from 'react';
import { Check, Circle, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type OptionMode = 'single' | 'multiple';

interface OptionEntry {
  id: string;
  label: string;
  hint: string;
  prompt: string;
  value: string;
}

interface OptionSubmitPayload {
  mode: OptionMode;
  selected: Array<{
    id: string;
    label: string;
    value: string;
    prompt: string;
  }>;
  prompts: string[];
  prompt: string;
}

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseMode(value: unknown): OptionMode {
  return toSafeText(value).toLowerCase() === 'multiple' ? 'multiple' : 'single';
}

function normalizeOptions(props: Record<string, unknown>): OptionEntry[] {
  const rawList = Array.isArray(props.options)
    ? props.options
    : Array.isArray(props.items)
      ? props.items
      : Array.isArray(props.choices)
        ? props.choices
        : [];

  return rawList
    .map((entry, index): OptionEntry | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const row = entry as Record<string, unknown>;
      const label = toSafeText(row.label)
        || toSafeText(row.title)
        || toSafeText(row.text)
        || '';
      if (!label) {
        return null;
      }

      const prompt = toSafeText(row.prompt)
        || toSafeText(row.hiddenPrompt)
        || toSafeText(row.nextPrompt)
        || toSafeText(row.message)
        || toSafeText(row.value)
        || label;

      return {
        id: toSafeText(row.id) || `option-${index + 1}`,
        label,
        hint: toSafeText(row.hint) || toSafeText(row.description),
        prompt,
        value: toSafeText(row.value) || label,
      };
    })
    .filter((entry): entry is OptionEntry => Boolean(entry));
}

function buildSubmitPayload(mode: OptionMode, options: OptionEntry[], selectedIndexes: number[], joinWith: string): OptionSubmitPayload {
  const selected = selectedIndexes
    .map((index) => options[index])
    .filter((entry): entry is OptionEntry => Boolean(entry))
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      value: entry.value,
      prompt: entry.prompt,
    }));

  const prompts = selected.map((entry) => entry.prompt);
  return {
    mode,
    selected,
    prompts,
    prompt: prompts.join(joinWith),
  };
}

export function GenUIOptionSelector(ctx: unknown) {
  const props = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? ((ctx as { props: Record<string, unknown> }).props)
    : {};
  const emit = (ctx && typeof ctx === 'object' && 'emit' in ctx && typeof (ctx as { emit?: unknown }).emit === 'function')
    ? ((ctx as { emit: (name: string, payload?: unknown) => void }).emit)
    : undefined;
  const directOnAction = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? (((ctx as { props: Record<string, unknown> }).props.__onAction) as ((actionId: string, payload?: unknown) => void) | undefined)
    : undefined;

  const mode = parseMode(props.mode);
  const options = React.useMemo(() => normalizeOptions(props), [props]);
  const submitAction = toSafeText(props.submitAction, 'submit_option') || 'submit_option';
  const joinWith = toSafeText(props.joinWith, '\n') || '\n';
  const title = toSafeText(props.title, '请选择下一步');
  const description = toSafeText(props.description);
  const submitLabel = toSafeText(props.submitLabel, '提交选择') || '提交选择';
  const selectedLabel = toSafeText(props.selectedLabel, '已选择');
  const submittedLabel = toSafeText(props.submittedLabel, '已提交');
  const disabledAfterSubmit = props.disabledAfterSubmit !== false;
  const minSelect = clamp(Math.round(toNumber(props.minSelect, 1)), 1, 99);
  const maxSelect = clamp(Math.round(toNumber(props.maxSelect, options.length || 1)), 1, Math.max(options.length, 1));

  const [selectedIndexes, setSelectedIndexes] = React.useState<number[]>([]);
  const [submitted, setSubmitted] = React.useState(false);

  const isOptionDisabled = (index: number): boolean => {
    if (submitted && disabledAfterSubmit) return true;
    if (mode !== 'multiple') return false;
    if (selectedIndexes.includes(index)) return false;
    return selectedIndexes.length >= maxSelect;
  };

  const submitSelection = (indexes: number[]) => {
    if (indexes.length === 0) return;
    const payload = buildSubmitPayload(mode, options, indexes, joinWith);
    if (typeof directOnAction === 'function') {
      directOnAction(submitAction, payload);
    } else {
      emit?.(submitAction, payload);
    }
    if (disabledAfterSubmit) {
      setSubmitted(true);
    }
  };

  const handleSingleSelect = (index: number) => {
    if (submitted && disabledAfterSubmit) return;
    setSelectedIndexes([index]);
    submitSelection([index]);
  };

  const handleMultipleToggle = (index: number) => {
    if (submitted && disabledAfterSubmit) return;
    setSelectedIndexes((prev) => {
      if (prev.includes(index)) {
        return prev.filter((item) => item !== index);
      }
      if (prev.length >= maxSelect) {
        return prev;
      }
      return [...prev, index];
    });
  };

  const handleMultipleSubmit = () => {
    if (selectedIndexes.length < minSelect) return;
    submitSelection(selectedIndexes);
  };

  if (options.length === 0) {
    return (
      <div className="w-full rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
        OptionSelector 未收到有效选项，请传入 `props.options`。
      </div>
    );
  }

  return (
    <div className="w-full max-w-full min-w-0 rounded-xl border border-border/50 bg-card/35 px-3 py-2.5 space-y-2 overflow-hidden">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground truncate">{title}</div>
          {description ? <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{description}</div> : null}
        </div>
        <Badge variant="secondary" className="text-[10px] h-5 px-2 shrink-0">
          {mode === 'single' ? '单选' : '多选'}
        </Badge>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/45 bg-background/30 divide-y divide-border/40">
        {options.map((option, index) => {
          const selected = selectedIndexes.includes(index);
          const disabled = isOptionDisabled(index);
          return (
            <button
              key={option.id}
              type="button"
              className={cn(
                'w-full px-3 py-2 text-left transition-colors',
                selected ? 'bg-primary/10' : 'hover:bg-muted/35',
                disabled ? 'opacity-70 cursor-not-allowed' : '',
              )}
              onClick={() => {
                if (mode === 'single') {
                  handleSingleSelect(index);
                } else {
                  handleMultipleToggle(index);
                }
              }}
              disabled={disabled}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span className={cn('mt-[1px] shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}>
                  {selected ? <Check className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  <span className="text-[14px] leading-5 font-medium text-foreground break-words">{option.label}</span>
                  {option.hint ? <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground break-words">{option.hint}</span> : null}
                </span>
                {mode === 'single' && selected && submitted ? (
                  <Badge variant="secondary" className="text-[10px] h-5 px-2 shrink-0">{selectedLabel}</Badge>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {mode === 'multiple' ? (
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <div className="text-[11px] text-muted-foreground leading-4">
            已选 {selectedIndexes.length} 项，至少 {minSelect} 项，最多 {maxSelect} 项
          </div>
          <Button
            size="sm"
            onClick={handleMultipleSubmit}
            disabled={(submitted && disabledAfterSubmit) || selectedIndexes.length < minSelect}
          >
            <Send className="w-3.5 h-3.5 mr-1" />
            {(submitted && disabledAfterSubmit) ? submittedLabel : submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
