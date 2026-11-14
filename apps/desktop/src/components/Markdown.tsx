import { Children, isValidElement, useState, type MouseEvent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function absoluteHttpUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : '';
  } catch { return ''; }
}

const components: Components = { img: ({ alt }) => <span>{alt}</span> };
const policy = { skipHtml: true, remarkPlugins: [remarkGfm], urlTransform: absoluteHttpUrl };

export default function Markdown({ children }: { children: string }) {
  const [error, setError] = useState('');
  async function open(event: MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    setError('');
    try { await invoke('open_external', { url }); }
    catch { setError('无法打开外部链接，请检查系统浏览器设置'); }
  }
  return <div className="markdown-body">
    <ReactMarkdown {...policy} components={{ ...components, a: ({ href, children }) => href
      ? <a href={href} onClick={event => { void open(event, href); }} onAuxClick={event => { void open(event, href); }}>{children}</a>
      : <span>{children}</span> }}>{children}</ReactMarkdown>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function linkText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode; alt?: string }>(child)
    ? child.props.alt ?? linkText(child.props.children) : String(child)).join('');
}

export function artifactDocument(text: string, mediaType: 'text/plain' | 'text/markdown'): { srcDoc: string; links: { url: string; label: string }[] } {
  const links: { url: string; label: string }[] = [];
  const content = mediaType === 'text/plain' ? <pre>{text}</pre> : <ReactMarkdown {...policy} components={{ ...components,
    a: ({ href, children }) => {
      if (href) links.push({ url: href, label: linkText(children) });
      return <span>{children}</span>;
    },
  }}>{text}</ReactMarkdown>;
  const srcDoc = '<!doctype html>' + renderToStaticMarkup(<html lang="zh-CN"><head>
    <meta charSet="utf-8" />
    <meta httpEquiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'" />
    <style>{'body{font-family:system-ui,sans-serif;line-height:1.6;overflow-wrap:anywhere}pre{white-space:pre-wrap}table{border-collapse:collapse}th,td{border:1px solid;padding:.35rem}'}</style>
  </head><body className="markdown-body">{content}</body></html>);
  return { srcDoc, links };
}
