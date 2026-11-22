import type { ComponentProps } from 'react';
import { Check, Minus } from 'lucide-react';
import { Checkbox as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';

export function Checkbox({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="checkbox" className={cn(
    'ui-choice-control rounded-[4px] data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary text-primary-foreground',
    className,
  )} {...props}>
    <Primitive.Indicator className="group grid place-items-center">
      <Check aria-hidden className="size-3 group-data-[state=indeterminate]:hidden" />
      <Minus aria-hidden className="hidden size-3 group-data-[state=indeterminate]:block" />
    </Primitive.Indicator>
  </Primitive.Root>;
}
