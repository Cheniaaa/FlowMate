import { useRef, type ComponentProps } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';

// 源自 https://ui.shadcn.com/r/styles/new-york-v4/dialog.json。
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({ className, children, onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, ...props }: ComponentProps<typeof Primitive.Content>) {
  const origin = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  return <Primitive.Portal><Primitive.Overlay className="ui-overlay ui-surface-motion fixed inset-0 bg-black/35" />
    <Primitive.Content data-slot="dialog-content" className={cn('ui-dialog ui-surface-motion [--ui-surface-offset:scale(0.98)] fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 shadow-xl outline-none', className)}
      onOpenAutoFocus={event => { origin.current = document.activeElement as HTMLElement; onOpenAutoFocus?.(event); }}
      onCloseAutoFocus={event => { onCloseAutoFocus?.(event); if (!event.defaultPrevented) { event.preventDefault(); if (origin.current?.isConnected) origin.current.focus(); } }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onEscapeKeyDown={event => { if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault(); else onEscapeKeyDown?.(event); }}
      {...props}>{children}</Primitive.Content>
  </Primitive.Portal>;
}
