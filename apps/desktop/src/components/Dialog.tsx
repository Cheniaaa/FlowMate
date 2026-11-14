import { useEffect, useRef, type ReactNode } from 'react';
import Button from './Button';

export default function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><Button aria-label="关闭对话框" onClick={onClose}>×</Button></header>{children}
  </dialog>;
}
