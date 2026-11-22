import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// 基于 shadcn/ui new-york-v4/button，保留项目的中文界面与主题。
const buttonVariants = cva('inline-flex min-w-0 max-w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium ui-control-motion ui-control-focus disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0', {
  variants: {
    variant: {
      default: 'border border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
      outline: 'border border-border bg-background text-foreground hover:bg-secondary',
      secondary: 'border border-transparent bg-secondary text-foreground hover:bg-secondary/75',
      ghost: 'border border-transparent bg-transparent text-foreground hover:bg-secondary',
      destructive: 'border border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90',
      link: 'border border-transparent bg-transparent text-primary underline-offset-4 hover:underline',
    },
    size: {
      default: 'min-h-control px-3 py-1.5',
      xs: 'min-h-control-xs gap-1 px-1.5 py-0.5 text-xs',
      sm: 'min-h-control-sm gap-1.5 px-2.5 py-1',
      lg: 'min-h-control-lg px-4 py-2',
      icon: 'size-control shrink-0 p-0',
      'icon-xs': 'size-control-xs shrink-0 p-0',
      'icon-sm': 'size-control-sm shrink-0 p-0',
      'icon-lg': 'size-control-lg shrink-0 p-0',
    },
  },
  defaultVariants: { variant: 'outline', size: 'default' },
});
export function Button({ className, variant = 'outline', size = 'default', asChild = false, type, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" data-variant={variant} data-size={size} type={asChild ? undefined : type ?? 'button'}
    className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
