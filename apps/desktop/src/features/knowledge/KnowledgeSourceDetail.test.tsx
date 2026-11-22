import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { job, source } from './knowledge-fixtures';
import KnowledgeSourceDetail from './KnowledgeSourceDetail';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });

it.each([
  ['knowledge_encoding_unsupported', null, /UTF-8/],
  ['grant_required', 1, /许可/],
  ['knowledge_embedding_unavailable', 1, /检索模型/],
  ['knowledge_index_write_failed', 1, /索引.*重试|重试.*索引/],
] as const)('失败 %s 在折叠外说明下一步与旧资料可用性，无 task 也能更新', async (reason, activeVersion, guidance) => {
  const update = vi.fn(), user = userEvent.setup();
  const failed = { ...job, status: 'failed' as const, reason, task: null };
  const current = { ...source, status: activeVersion ? 'active' as const : 'failed' as const,
    active_version: activeVersion, latest_job: failed, origin_hint: null, added_at: null };
  render(<KnowledgeSourceDetail client={runtime()} source={current} jobs={[]} busy={false}
    onCancel={vi.fn()} onBack={vi.fn()} onChanged={vi.fn()} onUpdate={update} />);
  const detail = screen.getByRole('region', { name: '资料详情' });
  const hint = within(detail).getByText(guidance);
  expect(hint.closest('details')).toBeNull();
  const availability = within(detail).getByText(activeVersion ? /当前资料仍可用/ : /此文件尚不可用/);
  expect(availability.closest('details')).toBeNull();
  expect(within(detail).queryByRole('button', { name: '查看处理任务' })).toBeNull();
  await user.click(within(detail).getByText('操作与处理记录'));
  await user.click(within(detail).getByRole('button', { name: '更新文件' }));
  expect(update).toHaveBeenCalledOnce();
  expect(document.body.textContent).not.toContain(reason);
});

it('source 的 latest_job 为当前事实，未翻全的旧 running 历史不显示更新中或提供取消', () => {
  const current = { ...source, latest_job: { ...job, status: 'completed' as const }, origin_hint: null, added_at: null };
  render(<KnowledgeSourceDetail client={runtime()} source={current} jobs={[{ ...job, id: source.id, status: 'running' }]}
    busy={false} onCancel={vi.fn()} onBack={vi.fn()} onChanged={vi.fn()} onUpdate={vi.fn()} />);
  const detail = screen.getByRole('region', { name: '资料详情' });
  expect(within(detail).queryByText(/新版处理中/)).toBeNull();
  expect(within(detail).queryByRole('button', { name: '取消处理', hidden: true })).toBeNull();
});
