import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CommandMeta } from '../generated/contracts';
import { validate } from './validation';

export interface WindowSettings {
  quick_pinned: boolean;
  ball_enabled: boolean;
  shortcut: string | null;
  shortcut_error: string | null;
}
export interface PendingCounts { pending_questions: number; pending_approvals: number; pending_actions: number; unviewed_results: number }
export type WorkbenchTarget = { kind: 'run'; run_id: string } | { kind: 'task'; task_id: string } | { kind: 'tasks'; workspace_id: string | null } | { kind: 'assistants' } | { kind: 'memory' } | { kind: 'capabilities' } | { kind: 'mcp'; server_id: string | null; workspace_id: string | null };
export interface WorkbenchRequest { target: WorkbenchTarget | null; from_quick: boolean }
export const showWorkbench = (target: WorkbenchTarget | null) => invoke<void>('show_workbench', { target });
export const windowError = (error: unknown) => error instanceof Error ? error.message : String(error);
export const setQuickFormActive = (active: boolean) => invoke<void>('set_quick_form_active', { active });
export type SettingsSection = 'models' | 'assistant' | 'resources' | 'windows' | 'memory' | 'environments';
export interface SettingsNavigation { section: SettingsSection; from_quick: boolean }
export const openSettings = (section: SettingsSection) => invoke<void>('open_settings', { section });

export async function createWorkspaceFromDirectory(name: string, meta: CommandMeta) {
  validate('CommandMeta', meta);
  const result = await invoke<unknown>('create_workspace_from_directory', { name, meta });
  return result === null ? null : validate('WorkspaceDirectoryResult', result);
}

export async function retryWorkspaceFromDirectory(name: string, meta: CommandMeta) {
  validate('CommandMeta', meta);
  return validate('WorkspaceDirectoryResult', await invoke<unknown>('retry_workspace_from_directory', { name, meta }));
}

export async function checkWorkspaceDirectoryCommand(command_id: string) {
  const result = validate('CommandStatus', await invoke<unknown>('check_workspace_directory_command', { command_id }));
  return { status: result.status, result: result.result === null ? null : validate('WorkspaceDirectoryResult', result.result) };
}

export function useWindowSettings(label: 'quick' | 'main') {
  const [settings, setSettings] = useState<WindowSettings>();
  const [error, setError] = useState('');
  const revision = useRef(0);
  function install(value: WindowSettings) { revision.current++; setSettings(value); }
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    async function refresh() {
      const current = ++revision.current;
      try {
        const value = await invoke<WindowSettings>('window_settings');
        if (!disposed && current === revision.current) setSettings(value);
      } catch (error) {
        if (!disposed && current === revision.current) setError(windowError(error));
      }
    }
    async function subscribe() {
      const remove = await listen<null>('window-settings-changed', () => {
        if (!disposed) void refresh();
      }, { target: label });
      if (disposed) { remove(); return; }
      unlisten = remove;
      await refresh();
    }
    subscribe().catch(error => { if (!disposed) setError(windowError(error)); });
    return () => { disposed = true; unlisten?.(); };
  }, [label]);
  return { settings, install, error, setError };
}
