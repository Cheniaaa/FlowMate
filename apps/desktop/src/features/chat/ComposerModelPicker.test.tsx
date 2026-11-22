import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { ModelConnection, ModelProfile } from '../../generated/contracts';
import { connection, model } from '../../test/fixtures';
import ComposerModelPicker, { type ComposerModelPickerProps } from './ComposerModelPicker';

const official: ModelConnection = { ...connection, id: 'direct', display_name: '官方连接', provider_preset_id: 'openai' };
const gateway: ModelConnection = { ...connection, id: 'gateway', display_name: '团队网关' };
const relay: ModelConnection = { ...connection, id: 'relay', display_name: '备用连接', provider_preset_id: 'openai' };
const directModel: ModelProfile = { ...model, id: 'direct-profile', connection_id: official.id, model_id: 'gpt-real-1', display_name: '同款模型' };
const gatewayModel: ModelProfile = { ...directModel, id: 'gateway-profile', connection_id: gateway.id };
const relayModel: ModelProfile = { ...directModel, id: 'relay-profile', connection_id: relay.id, model_id: 'gpt-real-2', display_name: '备用模型' };
const providerPresets = [{ id: 'openai', display_name: 'OpenAI' }];

function setup(overrides: Partial<ComposerModelPickerProps> = {}) {
  const user = userEvent.setup();
  const onModelChange = vi.fn();
  const onEffortChange = vi.fn();
  const onLoadCatalog = vi.fn(async () => {});
  const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
  const props: ComposerModelPickerProps = {
    models: [directModel, gatewayModel, relayModel],
    connections: [official, gateway, relay],
    providerPresets,
    recentModelIds: [],
    modelId: directModel.id,
    effortOptions: [],
    effort: null,
    onModelChange,
    onEffortChange,
    onLoadCatalog,
    ...overrides,
  };
  const view = render(<form onSubmit={onSubmit}>
    <textarea aria-label="消息" />
    <ComposerModelPicker {...props} />
  </form>);
  return { user, props, view, onModelChange, onEffortChange, onSubmit };
}

it('把实际最近使用的配置按顺序置顶，其余按真实连接的提供方分组且不重复', async () => {
  const { user } = setup({ recentModelIds: ['removed-profile', gatewayModel.id, relayModel.id, gatewayModel.id] });
  const trigger = screen.getByRole('button', { name: '选择模型' });
  expect(trigger.textContent).toContain('同款模型');
  await user.click(trigger);
  const recent = within(screen.getByRole('group', { name: '最近使用' })).getAllByRole('option');
  expect(recent.map(option => option.dataset.modelId)).toEqual(['gateway-profile', 'relay-profile']);
  const remaining = within(screen.getByRole('group', { name: 'OpenAI' })).getByRole('option', { name: /同款模型.*gpt-real-1.*官方连接/ });
  expect(remaining.getAttribute('aria-selected')).toBe('true');
  expect(screen.getAllByRole('option')).toHaveLength(3);
});

it('仅为同名同连接名的配置直接展示不同路径，按 endpoint 搜索并键盘选择准确的配置', async () => {
  const east = { ...official, display_name: '团队连接', endpoint: 'https://gateway.invalid/service/east/v1' };
  const west = { ...gateway, display_name: '团队连接', endpoint: 'https://gateway.invalid/service/west/v1' };
  const { user, props, view, onModelChange } = setup({
    connections: [east, west, relay],
    recentModelIds: [gatewayModel.id],
  });
  const trigger = screen.getByRole('button', { name: '选择模型' });
  expect(within(trigger).getByText(east.endpoint)).toBeTruthy();
  await user.click(trigger);
  const list = within(screen.getByRole('listbox', { name: '可用模型' }));
  const westOption = list.getByRole('option', { name: /团队连接.*gateway\.invalid\/service\/west\/v1/ });
  expect(within(westOption).getByText(west.endpoint)).toBeTruthy();
  expect(westOption.getAttribute('title')).not.toContain(gatewayModel.id);
  expect(list.getByRole('option', { name: /备用模型/ }).textContent).not.toContain(relay.endpoint);
  await user.type(screen.getByRole('combobox', { name: '搜索模型' }), 'gateway.invalid/service/west');
  expect(list.getAllByRole('option')).toEqual([westOption]);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith('gateway-profile');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' })));
  view.rerender(<form><textarea aria-label="消息" /><ComposerModelPicker {...props} modelId={gatewayModel.id} /></form>);
  expect(within(screen.getByRole('button', { name: '选择模型' })).getByText(west.endpoint)).toBeTruthy();
});

it('同名同址的配置优先使用不同的实际型号或协议', async () => {
  const chat = { ...official, display_name: '共享连接' };
  const responses: ModelConnection = { ...gateway, display_name: '共享连接', protocol: 'openai_responses' };
  const alternateModel = { ...relayModel, display_name: directModel.display_name, connection_id: official.id };
  const { user, props, view, onModelChange } = setup({
    connections: [chat, responses], models: [directModel, gatewayModel, alternateModel],
  });
  const trigger = screen.getByRole('button', { name: '选择模型' });
  expect(trigger.textContent).toContain('gpt-real-1');
  expect(trigger.textContent).toContain('OpenAI Chat Completions');
  expect(trigger.textContent).not.toContain(chat.endpoint);
  await user.click(trigger);
  const list = within(screen.getByRole('listbox', { name: '可用模型' }));
  expect(list.getByRole('option', { name: /gpt-real-2/ }).textContent).not.toContain('配置');
  const responsesOption = list.getByRole('option', { name: /gpt-real-1.*OpenAI Responses/ });
  expect(responsesOption.dataset.modelId).toBe('gateway-profile');
  await user.type(screen.getByRole('combobox', { name: '搜索模型' }), 'OpenAI Responses');
  expect(list.getAllByRole('option')).toEqual([responsesOption]);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith('gateway-profile');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' })));
  view.rerender(<form><textarea aria-label="消息" /><ComposerModelPicker {...props} modelId={alternateModel.id} /></form>);
  expect(trigger.textContent).toContain('gpt-real-2');
  expect(trigger.textContent).not.toContain('OpenAI');
});

it('同名同址同协议的账户配置用稳定标记区分，重排或增加配置也不改变原标记', async () => {
  const firstAccount = { ...official, display_name: '共享连接', secret_ref: 'synthetic-account-secret-first' };
  const secondAccount = { ...gateway, display_name: '共享连接', secret_ref: 'synthetic-account-secret-second' };
  const { user, props, view, onModelChange } = setup({
    models: [directModel, gatewayModel], connections: [firstAccount, secondAccount],
  });
  const trigger = screen.getByRole('button', { name: '选择模型' });
  await user.click(trigger);
  const list = within(screen.getByRole('listbox', { name: '可用模型' }));
  const readMarkers = () => Object.fromEntries(list.getAllByRole('option').map(option => [
    option.dataset.modelId,
    within(option).getByText(/^配置 [A-Z0-9-]+$/).textContent!,
  ]));
  const initial = readMarkers();
  expect(new Set(Object.values(initial)).size).toBe(2);
  expect(trigger.textContent).toContain(initial['direct-profile']);
  expect(trigger.getAttribute('title')).not.toContain('direct-profile');
  const additional = { ...directModel, id: 'an-earlier-profile' };
  view.rerender(<form><textarea aria-label="消息" /><ComposerModelPicker {...props}
    models={[additional, gatewayModel, directModel]} connections={[secondAccount, firstAccount]}
    recentModelIds={[gatewayModel.id]} /></form>);
  expect(readMarkers()).toMatchObject(initial);
  expect(document.body.innerHTML).not.toContain('synthetic-account-secret');
  await user.type(screen.getByRole('combobox', { name: '搜索模型' }), initial['gateway-profile']);
  expect(list.getByRole('option').dataset.modelId).toBe('gateway-profile');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith('gateway-profile');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' })));
  view.rerender(<form><textarea aria-label="消息" /><ComposerModelPicker {...props} modelId={gatewayModel.id} /></form>);
  expect(trigger.textContent).toContain(initial['gateway-profile']);
  expect(trigger.getAttribute('title')).not.toContain('gateway-profile');
});

it('可以按目录中的提供方名称搜索，缺少预设名称时显示真实连接名', async () => {
  const { user } = setup({
    connections: [official, { ...gateway, provider_preset_id: 'missing-preset' }, relay],
    providerPresets: [{ id: 'openai', display_name: 'Example Provider' }],
  });
  await user.click(screen.getByRole('button', { name: '选择模型' }));
  expect(screen.getByRole('group', { name: '团队网关' })).toBeTruthy();
  const search = screen.getByRole('combobox', { name: '搜索模型' });
  await user.type(search, 'Example Provider');
  const group = within(screen.getByRole('group', { name: 'Example Provider' }));
  expect(group.getAllByRole('option')).toHaveLength(2);
  expect(screen.queryByRole('group', { name: '团队网关' })).toBeNull();
});

it('按连接或型号 ID 搜索同名模型，选择时交付准确的配置 ID 并回到输入框', async () => {
  const { user, onModelChange } = setup();
  await user.click(screen.getByRole('button', { name: '选择模型' }));
  const search = screen.getByRole('combobox', { name: '搜索模型' });
  expect(document.activeElement).toBe(search);
  await user.type(search, '团队网关 GPT-REAL-1');
  await user.click(screen.getByRole('option', { name: /同款模型.*gpt-real-1.*团队网关/ }));
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith('gateway-profile');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' })));
});

it('保持当前搜索词，并匹配后续页到达的模型和连接', async () => {
  let finishPage: () => void = () => {};
  const page = new Promise<void>(resolve => { finishPage = resolve; });
  const onLoadCatalog = vi.fn(() => page);
  const { user, props, view } = setup({ models: [directModel], connections: [official], onLoadCatalog });
  await user.click(screen.getByRole('button', { name: '选择模型' }));
  expect(onLoadCatalog).toHaveBeenCalledTimes(1);
  await user.type(screen.getByRole('combobox', { name: '搜索模型' }), '团队网关');
  expect(screen.getByRole('status').textContent).toContain('加载');
  expect(screen.queryByText('未找到匹配模型')).toBeNull();
  view.rerender(<form><textarea aria-label="消息" /><ComposerModelPicker {...props} models={[directModel, gatewayModel]} connections={[official, gateway]} /></form>);
  await act(async () => finishPage());
  expect(screen.getByRole('option', { name: /同款模型.*团队网关/ })).toBeTruthy();
  expect((screen.getByRole('combobox', { name: '搜索模型' }) as HTMLInputElement).value).toBe('团队网关');
});

it('支持搜索输入的方向键和 Enter，并忽略确认 IME 的 Enter 与 Escape', async () => {
  const { user, onModelChange, onSubmit } = setup();
  const trigger = screen.getByRole('button', { name: '选择模型' });
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  const search = screen.getByRole('combobox', { name: '搜索模型' });
  const options = screen.getAllByRole('option');
  fireEvent.compositionStart(search);
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });
  fireEvent.keyDown(search, { key: 'Escape', code: 'Escape' });
  expect(screen.getByRole('combobox', { name: '搜索模型' })).toBe(search);
  expect(onModelChange).not.toHaveBeenCalled();
  fireEvent.compositionEnd(search);
  await user.keyboard('{ArrowDown}{ArrowDown}');
  expect(search.getAttribute('aria-activedescendant')).toBe(options[1].id);
  await user.keyboard('{Enter}');
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith('relay-profile');
  expect(onSubmit).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' })));
});

it('Escape 关闭模型菜单并将焦点返回消息，但外部点击保留点击目标的焦点', async () => {
  const { user } = setup();
  const trigger = screen.getByRole('button', { name: '选择模型' });
  await user.click(trigger);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' })));

  const outside = document.createElement('button');
  outside.textContent = '其他操作';
  document.body.appendChild(outside);
  try {
    await user.click(trigger);
    await user.click(outside);
    await waitFor(() => expect(screen.queryByRole('combobox', { name: '搜索模型' })).toBeNull());
    expect(document.activeElement).toBe(outside);
  } finally {
    outside.remove();
  }
});

it('Tab 关闭搜索菜单并继续到同一工具栏的下一项', async () => {
  const { user } = setup({ effortOptions: ['low'] });
  await user.click(screen.getByRole('button', { name: '选择模型' }));
  await user.tab();
  expect(screen.queryByRole('combobox', { name: '搜索模型' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '思考强度' }));
});

it('选择模型后的延迟回焦保留已经取得焦点的其他控件', async () => {
  const { user } = setup({ effortOptions: ['low'] });
  await user.click(screen.getByRole('button', { name: '选择模型' }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索模型' }), { key: 'Enter' });
  const next = screen.getByRole('button', { name: '思考强度' });
  next.focus();
  // Radix 在卸载后的下一次计时器回调里归还焦点。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.activeElement).toBe(next);
});

it('仅为明确可选的档位显示独立思考菜单，并支持选择默认值', async () => {
  const { user, props, view, onEffortChange } = setup({ effortOptions: ['low', 'high'], effort: 'high' });
  const thinking = screen.getByRole('button', { name: '思考强度' });
  expect(thinking.textContent).toContain('思考：高');
  await user.click(thinking);
  expect(screen.getByRole('menuitemradio', { name: '高' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('menuitemradio', { name: '中' })).toBeNull();
  await user.click(screen.getByRole('menuitemradio', { name: '默认' }));
  expect(onEffortChange).toHaveBeenCalledExactlyOnceWith(null);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' })));

  view.rerender(<form><textarea aria-label="消息" />
    <ComposerModelPicker {...props} effortOptions={[]} />
  </form>);
  expect(screen.queryByRole('button', { name: /思考/ })).toBeNull();
});
