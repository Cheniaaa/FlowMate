import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { McpClient, type McpQuery } from '../../api/mcp';
import type { McpServerView } from '../../generated/contracts';

interface Waiting { id: string; name: string; phase: 'waiting' | 'submitting' }
export function useMcpAdmission(client: RuntimeClient, workspaceId: string, sessionId: string, revision: number) {
  const mcp = useMemo(() => new McpClient(client.connection), [client]);
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [choice, setChoice] = useState<{ id: string; revision: number; name: string } | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const own = useRef<{ notice: Waiting; controller: AbortController } | null>(null);

  function publish(value: Waiting | null) {
    setWaiting(value);
    channel.current?.postMessage({ type: 'state', value });
  }
  function cancel() {
    if (waiting?.phase !== 'waiting') return;
    own.current?.controller.abort();
    channel.current?.postMessage({ type: 'cancel', id: waiting.id });
    publish(null);
  }
  useEffect(() => {
    setChoice(null); setServers([]); setWaiting(null); setLookupError('');
    if (!sessionId) return;
    const current = new BroadcastChannel(`flowmate:mcp-admission:${client.connection.base_url}:${sessionId}`);
    channel.current = current;
    current.onmessage = event => {
      if (event.data.type === 'state') setWaiting(event.data.value);
      if (event.data.type === 'hello' && own.current) current.postMessage({ type: 'state', value: own.current.notice });
      const active = own.current;
      if (event.data.type === 'cancel' && active && event.data.id === active.notice.id) active.controller.abort();
    };
    current.postMessage({ type: 'hello' });
    return () => { own.current?.controller.abort(); current.close(); channel.current = null; };
  }, [client, sessionId]);
  useEffect(() => {
    if (!workspaceId || !sessionId) return;
    let ignore = false;
    async function list(parameters: McpQuery) {
      const result: McpServerView[] = [];
      let cursor: string | undefined;
      do {
        const page = await mcp.mcpServers({ ...parameters, cursor });
        result.push(...page.items); cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return result;
    }
    void Promise.all([list({ scope_kind: 'user_global' }),
      list({ scope_kind: 'workspace', workspace_id: workspaceId })]).then(pages => {
      if (!ignore) {
        const available = pages.flat().filter(server =>
          server.config.scope.workspace_id === null || server.config.scope.workspace_id === workspaceId);
        setServers(available);
        setLookupError('');
      }
    }).catch(failure => { if (!ignore) setLookupError(failure instanceof Error ? failure.message : '无法读取服务状态'); });
    return () => { ignore = true; };
  }, [mcp, workspaceId, sessionId, revision, refresh]);

  const unavailable = servers.filter(server => server.config.enabled && !server.error_code && server.state !== 'connected'
    && server.state !== 'stopped' && server.state !== 'failed'
    && (server.selection === null || server.selection.selected_names.length > 0));

  const selectedServer = servers.find(server => server.config.id === choice?.id);
  const choiceIssue = choice && (!selectedServer ? '所选服务已不可用，请重新选择或清除等待。'
    : !selectedServer.config.enabled ? '所选服务已停用，请恢复连接或清除等待。'
      : selectedServer.config.revision !== choice.revision ? '所选连接已改变，请重新选择或清除等待。'
        : selectedServer.error_code || selectedServer.state === 'failed' ? '所选服务连接失败，请修复连接或清除等待。'
          : selectedServer.selection !== null && !selectedServer.selection.selected_names.length
            ? '所选服务的工具已全部关闭，请启用工具或清除等待。' : '');
  function select(id: string) {
    if (!id) { setChoice(null); return; }
    const server = servers.find(server => server.config.id === id)!;
    setChoice({ id, revision: server.config.revision, name: server.config.display_name });
  }
  async function send(serverId: string, deadlineSeconds: number, unchanged: () => boolean,
      submit: () => Promise<boolean>) {
    const server = servers.find(server => server.config.id === serverId);
    if (!server || choiceIssue) throw new Error((choiceIssue || '所选服务状态已改变，请重新选择。') + '本次输入未提交。');
    await navigator.locks.request(`flowmate:send:${client.connection.base_url}:${sessionId}`,
      { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('此会话正在另一窗口等待服务，本次输入未提交。');
        const controller = new AbortController();
        const notice: Waiting = { id: crypto.randomUUID(), name: server.config.display_name, phase: 'waiting' };
        own.current = { notice, controller };
        publish(notice);
        const timer = setTimeout(() => controller.abort(new Error('等待服务超时，本次输入未提交。')),
          deadlineSeconds * 1000);
        try {
          const ready = await mcp.prepareMcp(serverId, sessionId, commandMeta(server.config.revision), controller.signal);
          controller.signal.throwIfAborted();
          if (!unchanged()) throw new Error('草稿或会话已改变，本次输入未提交。');
          if (ready.state !== 'connected' || ready.error_code) throw new Error('所选服务连接失败，本次输入未提交。');
          notice.phase = 'submitting';
          publish({ ...notice });
          if (await submit()) setChoice(null);
        } catch (failure) {
          if (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== 'AbortError') {
            toast.error(failure instanceof Error ? failure.message : '等待服务失败，本次输入未提交。');
          }
        } finally {
          clearTimeout(timer);
          own.current = null;
          publish(null);
          setRefresh(value => value + 1);
        }
      });
  }
  return { selected: choice?.id ?? '', selectedName: choice?.name, selectedServer, choiceIssue,
    select, waiting, cancel, unavailable, lookupError, send,
    retry: () => setRefresh(value => value + 1) };
}
