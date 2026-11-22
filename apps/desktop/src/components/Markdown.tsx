import { Children, createContext, isValidElement, useContext, useState, type CSSProperties, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, Root, RootContent } from 'hast';
import type { RunSnapshot, SessionContext } from '../generated/contracts';
import { Button } from './ui/button';
import readingCss from '../styles/reading.css?raw';

function absoluteHttpUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : '';
  } catch { return ''; }
}

const components: Components = { img: ({ alt }) => <span>{alt}</span> };
const policy = { skipHtml: true, remarkPlugins: [remarkGfm], urlTransform: absoluteHttpUrl };
const CitationContext = createContext<((id: string) => void) | undefined>(undefined);
export type EvidenceLabel = Pick<SessionContext['knowledge'][number], 'name' | 'start_line' | 'end_line' | 'historical'>;
const CitationButton: Components['button'] = ({ node, children }) => {
  const open = useContext(CitationContext);
  return <Button variant="link" size="xs" className="inline-flex px-0.5 text-left align-baseline whitespace-normal wrap-anywhere"
    aria-label={`查看引用 ${node!.properties.marker}${node!.properties.label ? ` · ${node!.properties.label}` : ''}`}
    onClick={() => open!(String(node!.properties.evidenceId))}>{children}</Button>;
};

function ChatCodeBlock({ children }: { children?: ReactNode }) {
  const code = Children.only(children) as ReactElement<{ className?: string; children?: string }>;
  const language = code.props.className?.replace(/^language-/, '');
  const [status, setStatus] = useState('');
  return <div className="chat-code-block">
    <div className="chat-code-header"><span>{language || '代码'}</span>
      <Button size="sm" variant="ghost" aria-label={language ? `复制 ${language} 代码` : '复制代码'} onClick={async () => {
        try { await navigator.clipboard.writeText(code.props.children ?? ''); setStatus('已复制'); }
        catch { setStatus('复制失败，请选中代码复制'); }
      }}>复制</Button><span role="status">{status}</span>
    </div>
    <pre>{code}</pre>
  </div>;
}

export default function Markdown({ children, citations, onOpenEvidence, evidenceLabels }: {
  children: string; citations?: NonNullable<RunSnapshot['output']>['citations']; onOpenEvidence?: (id: string) => void;
  evidenceLabels?: ReadonlyMap<string, EvidenceLabel>;
}) {
  const [error, setError] = useState('');
  const references = new Map((citations ?? []).filter(item => Number.isSafeInteger(item.marker) && item.marker > 0)
    .map(item => [String(item.marker), item.evidence_id]));
  // 只替换普通正文中的已发布标号；链接与代码始终走既有 Markdown 边界。
  function citationMarkers() {
    return (tree: Root) => {
      function walk(parent: Root | Element) {
        parent.children = parent.children.flatMap((node): RootContent[] => {
          if (node.type === 'element') {
            if (!['a', 'code', 'pre'].includes(node.tagName)) walk(node);
            return [node];
          }
          if (node.type !== 'text') return [node];
          const parts: RootContent[] = [];
          let offset = 0;
          for (const match of node.value.matchAll(/\[([1-9]\d*)\]/g)) {
            const evidenceId = references.get(match[1]);
            if (!evidenceId) continue;
            const item = evidenceLabels?.get(evidenceId);
            const label = item && `${item.name} · ${item.start_line === item.end_line ? `${item.start_line} 行` : `${item.start_line}–${item.end_line} 行`}${item.historical ? ' · 历史原文' : ''}`;
            parts.push({ type: 'text', value: node.value.slice(offset, match.index) },
              { type: 'element', tagName: 'button', properties: { evidenceId, marker: match[1], label },
                children: [{ type: 'text', value: label || match[0] }] });
            offset = match.index + match[0].length;
          }
          return parts.length ? [...parts, { type: 'text', value: node.value.slice(offset) }] : [node];
        }) as typeof parent.children;
      }
      walk(tree);
    };
  }
  async function open(event: MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    setError('');
    try { await invoke('open_external', { url }); }
    catch { setError('无法打开外部链接，请检查系统浏览器设置'); }
  }
  return <div className="markdown-body">
    <CitationContext value={onOpenEvidence}><ReactMarkdown {...policy} rehypePlugins={onOpenEvidence && references.size ? [citationMarkers] : []}
      components={{ ...components, pre: ChatCodeBlock,
      button: CitationButton,
      a: ({ href, children }) => href
      ? <a href={href} onClick={event => { void open(event, href); }} onAuxClick={event => { void open(event, href); }}>{children}</a>
      : <span>{children}</span> }}>{children}</ReactMarkdown></CitationContext>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function linkText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode; alt?: string }>(child)
    ? child.props.alt ?? linkText(child.props.children) : String(child)).join('');
}

export function artifactDocument(text: string, mediaType: 'text/plain' | 'text/markdown' | 'application/json', theme: 'light' | 'dark' = 'light'): { srcDoc: string; links: { url: string; label: string }[] } {
  const links: { url: string; label: string }[] = [];
  const content = mediaType !== 'text/markdown' ? <pre className={mediaType === 'text/plain' ? 'artifact-text artifact-prose' : 'artifact-text'}>{text}</pre> : <ReactMarkdown {...policy} components={{ ...components,
    a: ({ href, children }) => {
      if (href) links.push({ url: href, label: linkText(children) });
      return <span>{children}</span>;
    },
  }}>{text}</ReactMarkdown>;
  const themeStyles = getComputedStyle(document.documentElement);
  const readingTokens = ['--color-background', '--color-foreground', '--color-muted', '--color-muted-foreground', '--color-border', '--color-primary',
    '--font-sans', '--font-mono', '--spacing', '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-reading', '--text-reading--line-height'];
  const style: CSSProperties = { colorScheme: theme, ...Object.fromEntries(
    readingTokens.map(token => [token, themeStyles.getPropertyValue(token).trim()]),
  ) };
  const srcDoc = '<!doctype html>' + renderToStaticMarkup(<html lang="zh-CN" data-theme={theme} style={style}><head>
    <meta charSet="utf-8" />
    <meta httpEquiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'" />
    <style>{readingCss}</style>
  </head><body className="markdown-body artifact-reading">{content}</body></html>);
  return { srcDoc, links };
}
