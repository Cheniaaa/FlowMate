import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <span data-slot="native-select-wrapper" className="relative block min-w-0 max-w-full">
    <select data-slot="native-select"
      className={cn('ui-field-control peer h-control appearance-none py-0 ps-3 pe-8 forced-colors:appearance-auto', className)}
      {...props} />
    <ChevronDown aria-hidden className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50 forced-colors:hidden" />
  </span>;
}

export function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option {...props} />;
}
