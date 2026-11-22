import { glob, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { parseSync } from 'vite';

// 检查 JSX 节点，文档示例和字符串里的 HTML 不属于业务控件。
const desktop = fileURLToPath(new URL('../', import.meta.url));
const controls = new Set(['button', 'input', 'textarea', 'select']);
const violations = [];
for await (const file of glob('src/**/*.tsx', { cwd: desktop })) {
  const path = file.split(sep).join('/');
  if (path.startsWith('src/components/ui/') || path.startsWith('src/test/') || /\.(test|spec)\.tsx$/.test(path)) continue;
  const source = await readFile(join(desktop, file), 'utf8');
  const result = parseSync(path, source);
  if (result.errors.length) throw new Error(`解析 ${path} 失败\n${result.errors.map(error => error.message).join('\n')}`);
  const nodes = [result.program];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.type === 'JSXOpeningElement' && controls.has(node.name.name)) {
      violations.push(`${path}:${source.slice(0, node.start).split('\n').length} <${node.name.name}>`);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) nodes.push(...child.filter(item => item && typeof item.type === 'string'));
      else if (child && typeof child.type === 'string') nodes.push(child);
    }
  }
}

if (violations.length) {
  console.error(`${violations.length} 处业务控件需要使用 ${relative(desktop, join(desktop, 'src/components/ui'))}\n${violations.sort().join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('业务页面的按钮、输入框、文本域和选择框均通过共享组件检查。');
}
