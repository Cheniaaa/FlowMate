import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 只检查声明的布局契约，不能代替真实 WebView 的尺寸、DPI 或截图验收。
function rules() {
  const style = document.createElement('style');
  style.textContent = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8');
  document.head.append(style); const rules = [...style.sheet.cssRules]; style.remove(); return rules;
}
function declaration(rules, selector) {
  return rules.find(rule => rule.type === 1 && rule.selectorText === selector).style;
}
it('静态布局声明保留批准的侧栏/详情/设置尺寸，active 不强制把父关系改成虚线', () => {
  const root = rules();
  expect(declaration(root, '.workbench').getPropertyValue('--sidebar-width')).toBe('220px');
  expect(declaration(root, '.workbench--detail').getPropertyValue('grid-template-columns')).toContain('376px');
    expect(declaration(root, '.settings-body').getPropertyValue('grid-template-columns')).toContain('174px');
  expect(declaration(root, '.graph-edge--active').getPropertyValue('stroke-dasharray')).toBe('');
});
it('窄设置按 v2 横向分类/纵向内容，而不是另造 128px 竖侧栏', () => {
  const narrow = rules().filter(rule => rule.type === 4 && rule.conditionText === '(max-width: 760px)')
    .flatMap(media => [...media.cssRules]);
  expect(declaration(narrow, '.settings-shell').getPropertyValue('display')).toBe('flex');
  expect(declaration(narrow, '.settings-tabs').getPropertyValue('flex-direction')).toBe('row');
  expect(declaration(narrow, '.provider-grid').getPropertyValue('grid-template-columns')).toBe('repeat(2, minmax(0, 1fr))');
});
