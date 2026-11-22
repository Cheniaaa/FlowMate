import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea"
    className={cn('ui-field-control min-h-12 resize-y px-3 py-2', className)} {...props} />;
}
