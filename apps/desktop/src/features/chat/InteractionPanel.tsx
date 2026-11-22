import { useId, useRef, type ReactNode, type Ref } from 'react';
import IconButton from '../../components/IconButton';
type InteractionItem = { kind: 'question' | 'scope' | 'approval' | 'recovery'; id: string; title: string };
export default function InteractionPanel({ ref, item, collapsed, onCollapse, children }: {
  ref?: Ref<HTMLElement>; item: InteractionItem; collapsed: boolean; onCollapse: () => void; children: ReactNode;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const composing = useRef(false);
   return <section ref={ref} tabIndex={-1} className={`interaction-panel interaction-panel--${item.kind}`} aria-label={item.title} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Escape' && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !collapsed) { event.preventDefault(); event.stopPropagation(); onCollapse(); toggle.current?.focus(); } }}>
    <header className="interaction-header"><strong>{item.title}</strong><IconButton ref={toggle} size="icon-sm" icon={collapsed ? 'expand' : 'collapse'}
      label={collapsed ? '展开待办' : '收起待办'} aria-expanded={!collapsed} aria-controls={contentId} onClick={onCollapse} /></header>
    <div id={contentId} className="interaction-content" hidden={collapsed}>{children}</div>
  </section>;
}
