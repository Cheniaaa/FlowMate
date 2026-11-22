import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { skillHash, skillScope, skillView } from '../../test/skill-fixtures';
import SkillExecution from './SkillExecution';

afterEach(() => vi.unstubAllGlobals());

it('按项目和脚本类型发现环境，保留自动运行及重新检测入口', async () => {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url); urls.push(parsed);
    if (parsed.pathname.endsWith('/script-settings')) return Response.json({
      skill_id: skillView.version.skill_id, content_hash: skillHash, scope: skillScope,
      scripts: ['scripts/report.py', 'scripts/report.mjs'], binding: skillView.binding, permissions: [],
    });
    return Response.json({ items: [], next_cursor: null, watermark: '0' });
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  render(<SkillExecution client={client} version={skillView.version} scope={skillScope} onChanged={() => {}} />);
  await screen.findByText(/需要 Python、Node.js 解释器/);
  const discovery = urls.find(url => url.pathname.endsWith('/discover'))!;
  expect(discovery.searchParams.get('workspace_id')).toBe(skillScope.workspace_id);
  expect(discovery.searchParams.getAll('kind')).toEqual(['python', 'node']);
  expect(screen.getByText(/^按项目自动选择 ·/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '重新检测' }));
  expect(urls.filter(url => url.pathname.endsWith('/discover'))).toHaveLength(2);
  expect(screen.getByRole('button', { name: '选择已安装环境' })).toBeTruthy();
});
