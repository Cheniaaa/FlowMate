import { useRef, type ReactNode } from 'react';
type InteractionItem = { kind: 'question' | 'scope' | 'approval' | 'recovery'; id: string; title: string };
export default function InteractionPanel({ item, collapsed, onCollapse, children }: {
  item: InteractionItem; collapsed: boolean; onCollapse: () => void; children: ReactNode;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  return <section className={`interaction-panel interaction-panel--${item.kind}`} aria-label={item.title} onKeyDown={event => { if (event.key === 'Escape' && !collapsed) { event.preventDefault(); event.stopPropagation(); onCollapse(); toggle.current?.focus(); } }}>
    <header className="interaction-header"><strong>{item.title}</strong><button ref={toggle} aria-label={collapsed ? '展开待办' : '收起待办'} aria-expanded={!collapsed} onClick={onCollapse}>{collapsed ? '展开' : '收起'}</button></header>
    <div className="interaction-content" hidden={collapsed}>{children}</div>
  </section>;
}
