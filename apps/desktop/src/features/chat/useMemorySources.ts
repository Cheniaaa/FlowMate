import { useEffect, useMemo, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { memoryQuery, memoryScopeLabel, personalScope, type MemoryScope } from '../../api/memory';
import { windowError } from '../../api/windows';
import type { MemoryRecord } from '../../generated/contracts';

type Access = { allowed: boolean; reason: string; error?: string };
type ReadPolicy = { enabled: boolean; error?: string };

function useMemoryReadPolicy(client: RuntimeClient, scope: MemoryScope | undefined, revision: number) {
  const key = JSON.stringify([scope, revision]);
  const [data, setData] = useState<{ key: string; policy: ReadPolicy }>();
  useEffect(() => {
    if (!scope) return;
    let ignore = false;
    void client.memoryPolicy(memoryQuery(scope)).then(policy => {
      if (!ignore) setData({ key, policy: { enabled: policy.read_profile } });
    }, error => {
      if (!ignore) setData({ key, policy: { enabled: false, error: windowError(error) } });
    });
    return () => { ignore = true; };
  }, [client, key, scope]);
  return data?.key === key ? data.policy : undefined;
}

function useMemoryAccess(client: RuntimeClient, scope: MemoryScope | undefined, policy: ReadPolicy | undefined,
  destination: string | undefined, revision: number): Access | undefined {
  const key = JSON.stringify([scope, destination, revision]);
  const [data, setData] = useState<{ key: string; access: Access }>();
  const enabled = policy?.enabled;
  useEffect(() => {
    if (!scope || !destination || !enabled) return;
    let ignore = false;
    async function read(query: ReturnType<typeof memoryQuery>): Promise<Access> {
      let cursor: string | undefined;
      do {
        const page = await client.memoryGrants({ ...query, cursor });
        if (page.items.some(grant => grant.status === 'active' && grant.destination === destination
            && grant.purposes.includes('model_send')
            && grant.memory_scopes.some(allowed => allowed.kind === query.scope_kind
              && (allowed.workspace_id ?? undefined) === query.workspace_id))) {
          return { allowed: true, reason: '已选择并授权' };
        }
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return { allowed: false, reason: '目标模型未授权，本次排除' };
    }
    void read(memoryQuery(scope)).then(access => {
      if (!ignore) setData({ key, access });
    }, error => {
      if (!ignore) setData({ key, access: { allowed: false, reason: '状态未同步，本次排除', error: windowError(error) } });
    });
    return () => { ignore = true; };
  }, [client, destination, enabled, key, scope]);
  if (!scope) return undefined;
  if (!destination) return { allowed: false, reason: '目标模型未授权，本次排除' };
  if (policy?.error) return { allowed: false, reason: '状态未同步，本次排除', error: policy.error };
  if (enabled === false) return { allowed: false, reason: '读取已关闭，本次排除' };
  return enabled && data?.key === key ? data.access : undefined;
}

type RecordPage = {
  key: string;
  records: MemoryRecord[];
  next: string | null;
  loading?: boolean;
  error?: string;
};

function useMemoryRecordPages(client: RuntimeClient, scope: MemoryScope | undefined, revision: number, profileRules: boolean) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([scope, revision, profileRules, attempt]);
  const [data, setData] = useState<RecordPage>();
  useEffect(() => {
    if (!scope) return;
    let ignore = false;
    void client.memoryRecords({ ...memoryQuery(scope), status: 'confirmed', limit: 50, profile_rules: profileRules })
      .then(page => {
        if (!ignore) setData({ key, records: page.items, next: page.next_cursor });
      }, error => {
        if (!ignore) setData({ key, records: [], next: null, error: windowError(error) });
      });
    return () => { ignore = true; };
  }, [client, key, profileRules, scope]);
  const current = scope && data?.key === key ? data : undefined;
  async function more() {
    if (!scope || !current?.next || current.loading) return;
    const pending = { ...current, loading: true, error: undefined };
    setData(pending);
    try {
      const page = await client.memoryRecords({ ...memoryQuery(scope), status: 'confirmed', limit: 50,
        profile_rules: profileRules, cursor: current.next });
      setData(latest => latest === pending ? { key, records: [...current.records, ...page.items], next: page.next_cursor } : latest);
    } catch (error) {
      setData(latest => latest === pending ? { ...current, error: windowError(error) } : latest);
    }
  }
  return {
    records: current?.records.filter(record => record.status === 'confirmed'
      && (!record.expires_at || Date.parse(record.expires_at) > Date.now())) ?? [],
    loading: !!scope && (!current || !!current.loading),
    error: current?.error,
    more: current?.next && !current.error ? more : undefined,
    retry: current?.error ? (current.next ? more : () => setAttempt(value => value + 1)) : undefined,
  };
}

export function useMemorySources(client: RuntimeClient, selected: MemoryScope[], destination: string | undefined,
  revision: number, workspaceId: string, open: boolean) {
  const workspace = useMemo<MemoryScope | undefined>(() => workspaceId
    ? { kind: 'workspace', workspace_id: workspaceId, session_id: null } : undefined, [workspaceId]);
  const personalSelected = selected.some(scope => scope.kind === 'user_global');
  const projectSelected = selected.some(scope => scope.kind === 'workspace' && scope.workspace_id === workspaceId);
  const personalScopeToCheck = open || personalSelected ? personalScope : undefined;
  const selectedProject = projectSelected ? workspace : undefined;
  const personalPolicy = useMemoryReadPolicy(client, destination ? personalScopeToCheck : undefined, revision);
  const projectPolicy = useMemoryReadPolicy(client, open ? workspace : destination ? selectedProject : undefined, revision);
  const personal = useMemoryAccess(client, personalScopeToCheck, personalPolicy, destination, revision);
  const project = useMemoryAccess(client, selectedProject, projectPolicy, destination, revision);
  const projectRules = useMemoryRecordPages(client, open && projectPolicy?.enabled ? workspace : undefined, revision, true);
  const otherProject = useMemoryRecordPages(client, open && project?.allowed ? workspace : undefined, revision, false);
  const visiblePersonal = open && personal?.allowed ? personalScope : undefined;
  const personalRules = useMemoryRecordPages(client, visiblePersonal, revision, true);
  const otherPersonal = useMemoryRecordPages(client, personalSelected ? visiblePersonal : undefined, revision, false);
  const chosen = selected.filter(scope => scope.kind === 'user_global'
    || scope.kind === 'workspace' && scope.workspace_id === workspaceId);
  const access = (scope: MemoryScope) => scope.kind === 'user_global' ? personal : project;
  return {
    scopes: chosen.filter(scope => access(scope)?.allowed),
    loading: chosen.some(scope => !access(scope)),
    error: chosen.map(scope => access(scope)?.error).find(Boolean),
    descriptions: chosen.map(scope => `${memoryScopeLabel(scope)}：${access(scope)?.reason ?? '正在核对读取策略与目标授权'}`),
    previews: [
      { label: '项目默认规则', ...projectRules,
        error: projectRules.error ?? (open && !projectSelected ? projectPolicy?.error : undefined),
        loading: projectRules.loading || !!(open && workspace && !projectPolicy) },
      { label: '其他项目记忆', ...otherProject },
      { label: '个人默认规则', ...personalRules,
        error: personalRules.error ?? (open && !personalSelected ? personal?.error : undefined),
        loading: personalRules.loading || (open && !personal) },
      { label: '其他个人记忆', ...otherPersonal },
    ].filter(group => group.records.length || group.more || group.loading || group.error),
  };
}
