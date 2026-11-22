import type { ComponentProps } from 'react';
import { DropdownMenu as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="dropdown-menu-content" sideOffset={sideOffset}
    className={cn('ui-menu ui-surface-motion [--ui-surface-offset:scale(0.98)] max-h-(--radix-dropdown-menu-content-available-height) min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg outline-none', className)}
    {...props} /></Primitive.Portal>;
}
export function DropdownMenuItem({ className, variant = 'default', ...props }: ComponentProps<typeof Primitive.Item> & { variant?: 'default' | 'destructive' }) {
  return <Primitive.Item data-slot="dropdown-menu-item" data-variant={variant} className={cn(
    'ui-control-motion flex min-h-control-sm cursor-pointer items-center gap-2 rounded-control px-2.5 py-1 text-sm outline-none data-[highlighted]:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    variant === 'destructive' && 'text-destructive data-[highlighted]:bg-destructive/10',
    className,
  )} {...props} />;
}
