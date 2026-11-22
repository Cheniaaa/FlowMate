import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

type WindowQueries = Pick<typeof screen, 'findByRole'>;

export async function openComposerModelOption(
  user: UserEvent, modelId: string, windowQueries: WindowQueries = screen, timeout?: number,
) {
  const trigger = await windowQueries.findByRole('button', { name: '选择模型' }, { timeout });
  await waitFor(() => expect(trigger).toHaveProperty('disabled', false), { timeout });
  await user.click(trigger);
  return waitFor(() => {
    const list = screen.getByRole('listbox', { name: '可用模型' });
    const options = within(list).getAllByRole('option').filter(option => option.dataset.modelId === modelId);
    expect(options).toHaveLength(1);
    return options[0];
  }, { timeout });
}

export async function selectComposerModel(...args: Parameters<typeof openComposerModelOption>) {
  const [user] = args;
  await user.click(await openComposerModelOption(...args));
}

export async function expectComposerModel(...args: Parameters<typeof openComposerModelOption>) {
  const [user] = args;
  const option = await openComposerModelOption(...args);
  await waitFor(() => expect(option.getAttribute('aria-selected')).toBe('true'));
  await user.keyboard('{Escape}');
}
