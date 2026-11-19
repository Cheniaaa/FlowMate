import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { ArtifactRef } from '../../generated/contracts';
import { id, secondId } from '../../test/fixtures';
import ArtifactPanel from './ArtifactPanel';

it('二进制详情可定位来源和导出固定产物，打开详情不会读取正文', () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const reads = vi.spyOn(client, 'artifactContent').mockImplementation(() => new Promise(() => {}));
  const artifact: ArtifactRef = { id, version: 2, content_hash: 'f'.repeat(64), media_type: 'application/octet-stream',
    task_id: secondId, activity_id: id, dependencies: [] };
  const saved = vi.fn(() => new Promise<void>(() => {}));
  const source = vi.fn();
  render(<ArtifactPanel artifact={artifact} client={client} onExport={saved} onSelectSource={source} />);
  expect(reads).not.toHaveBeenCalled();
  expect(screen.queryByTitle('产物预览')).toBeNull();
  expect(screen.queryByRole('navigation', { name: '产物分段' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '定位来源' }));
  expect(source).toHaveBeenCalledExactlyOnceWith(secondId, id);
  fireEvent.click(screen.getByRole('button', { name: '导出产物' }));
  expect(saved).toHaveBeenCalledExactlyOnceWith(artifact);
});
