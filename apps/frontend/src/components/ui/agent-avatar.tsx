import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden rounded-xl',
  {
    variants: {
      size: {
        sm: 'w-8 h-8 text-xs',
        md: 'w-9 h-9 text-sm',
        default: 'w-12 h-12 text-lg',
        lg: 'w-14 h-14 text-xl',
        xl: 'w-20 h-20 text-3xl',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

interface AgentAvatarProps extends VariantProps<typeof avatarVariants> {
  /** 智能体名称，取首字作为 fallback */
  name: string;
  /** 头像图片 URL */
  avatarUrl?: string;
  /** 主题色，用于 fallback 背景 */
  color?: string;
  className?: string;
}

/** 智能体头像组件：图片优先，无图降级为 name 首字 + 主题色背景 */
function AgentAvatar({ name, avatarUrl, color = '#6e6e73', size, className }: AgentAvatarProps) {
  const firstChar = name.charAt(0).toUpperCase();

  return (
    <AvatarPrimitive.Root className={cn(avatarVariants({ size }), className)}>
      {avatarUrl && (
        <AvatarPrimitive.Image
          src={avatarUrl}
          alt={name}
          className="aspect-square h-full w-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center font-bold text-white"
        style={{ backgroundColor: color }}
        delayMs={0}
      >
        {firstChar}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { AgentAvatar, avatarVariants };
export type { AgentAvatarProps };
