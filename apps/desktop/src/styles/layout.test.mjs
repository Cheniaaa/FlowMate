import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('桌面正式入口只加载 Tailwind 主题，没有旧的全局表单外观', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const theme = readFileSync(resolve(process.cwd(), 'src/styles/ui.css'), 'utf8');
  const layout = readFileSync(resolve(process.cwd(), 'src/styles/desktop-layout.css'), 'utf8');
  expect([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1])).toEqual(['/src/styles/ui.css']);
  expect(app).not.toMatch(/import ['"]\.\/styles\//);
  expect(theme).not.toMatch(/@import\s+['"].*\/app\.css['"]/);
  expect(layout).not.toMatch(/^ *(button|input|select|textarea)(?:[\s,:]|$)/m);
});

// 真实样式由浏览器截图脚本验证。这里只约束 CSS 无法从组件推导的原生窗口尺寸。
it('工作台保留侧栏与设置的布局尺寸，活动边保留原有线型', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/desktop-layout.css'), 'utf8');
  expect(css).toMatch(/\.workbench\s*\{[^}]*--sidebar-width:\s*220px/);
  expect(css).toMatch(/\.settings-body\s*\{[^}]*grid-template-columns:\s*174px minmax\(0, 1fr\)/);
  expect(css.match(/\.graph-edge--active\s*\{([^}]+)\}/)?.[1]).toBe(' stroke-width: 2; ');
});
