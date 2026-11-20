import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// 基于 shadcn/ui new-york-v4/button，保留项目的中文界面与主题。
const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      outline: 'border border-border bg-background hover:bg-secondary',
      ghost: 'border-transparent bg-transparent hover:bg-secondary',
      destructive: 'bg-destructive text-white hover:bg-destructive/90',
    },
    size: { default: 'min-h-9 px-3 py-2', sm: 'min-h-8 px-2 py-1', icon: 'size-9 p-0' },
  },
  defaultVariants: { variant: 'outline', size: 'default' },
});
export function Button({ className, variant, size, asChild = false, type = 'button', ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
