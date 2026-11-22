import type { ComponentProps } from 'react';
import { RadioGroup as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';

export function RadioGroup({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="radio-group" className={cn('grid min-w-0 gap-2', className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="radio-group-item" className={cn(
    'ui-choice-control rounded-full text-primary data-[state=checked]:border-primary',
    className,
  )} {...props}>
    <Primitive.Indicator className="size-2 rounded-full bg-current" />
  </Primitive.Item>;
}
