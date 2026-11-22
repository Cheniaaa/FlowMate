import type { ComponentProps } from 'react';
import { Label as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';

export function FieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('flex min-w-0 flex-col gap-3', className)} {...props} />;
}

export function FieldSet({ className, ...props }: ComponentProps<'fieldset'>) {
  return <fieldset data-slot="field-set" className={cn('m-0 flex min-w-0 flex-col gap-2 border-0 p-0', className)} {...props} />;
}

export function FieldLegend({ className, ...props }: ComponentProps<'legend'>) {
  return <legend data-slot="field-legend" className={cn('mb-1 p-0 text-sm font-medium text-foreground', className)} {...props} />;
}

export function Field({ className, orientation = 'vertical', ...props }: ComponentProps<'div'> & { orientation?: 'horizontal' | 'vertical' }) {
  return <div data-slot="field" data-orientation={orientation} className={cn(
    'group/field flex min-w-0 gap-1.5 text-sm data-[disabled=true]:opacity-50',
    orientation === 'horizontal' ? 'items-center gap-2' : 'flex-col',
    className,
  )} {...props} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="field-label" className={cn(
    'block text-sm font-medium text-foreground group-data-[invalid=true]/field:text-destructive', className,
  )} {...props} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="field-description" className={cn('m-0 text-xs text-muted-foreground', className)} {...props} />;
}

export function FieldError({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="field-error" role="alert" className={cn('m-0 text-xs text-destructive', className)} {...props} />;
}
