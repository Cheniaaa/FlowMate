import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input"
    className={cn('ui-field-control h-control px-3 file:mr-2 file:h-full file:font-medium', className)}
    {...props} />;
}
