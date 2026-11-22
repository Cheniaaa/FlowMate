import { useRef, type ComponentProps } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';

// shadcn/ui Sheet 与 Dialog 共用 Radix 焦点、Esc 和返回焦点语义。
export const Sheet = Primitive.Root;
export const SheetTitle = Primitive.Title;
export const SheetClose = Primitive.Close;
export function SheetContent({ className, children, onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, ...props }: ComponentProps<typeof Primitive.Content>) {
  const origin = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  return <Primitive.Portal><Primitive.Overlay className="ui-overlay ui-surface-motion fixed inset-0 bg-black/35" />
    <Primitive.Content aria-describedby={undefined} data-slot="sheet-content" className={cn('ui-sheet ui-surface-motion [--ui-surface-offset:translateX(0.5rem)] fixed inset-y-0 right-0 border-l border-border bg-background p-5 shadow-xl outline-none', className)}
      onOpenAutoFocus={event => { origin.current = document.activeElement as HTMLElement; onOpenAutoFocus?.(event); }}
      onCloseAutoFocus={event => { onCloseAutoFocus?.(event); if (!event.defaultPrevented) { event.preventDefault(); if (origin.current?.isConnected) origin.current.focus(); } }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onEscapeKeyDown={event => { if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault(); else onEscapeKeyDown?.(event); }}
      {...props}>{children}</Primitive.Content>
  </Primitive.Portal>;
}
