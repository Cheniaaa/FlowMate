import { useRef, type ReactNode } from 'react';
import Button from './Button';
import { Dialog as Root, DialogContent, DialogTitle } from './ui/dialog';

export default function Dialog({ title, children, onClose, onReturnFocus }: { title: string; children: ReactNode; onClose: () => void; onReturnFocus?: () => void }) {
  // 带 autoFocus 的表单会先于 Radix mount 事件聚焦；在渲染前保留真实触发控件。
  const origin = useRef(document.activeElement as HTMLElement | null);
  return <Root open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="dialog" aria-describedby={undefined}
    onCloseAutoFocus={event => { event.preventDefault(); if (onReturnFocus) onReturnFocus(); else if (origin.current?.isConnected) origin.current.focus(); }}
    onEscapeKeyDown={event => { if (event.isComposing || event.keyCode === 229) event.preventDefault(); }}>
    <header><DialogTitle asChild><h2>{title}</h2></DialogTitle><Button aria-label="关闭对话框" onClick={onClose}>×</Button></header>{children}
  </DialogContent></Root>;
}
