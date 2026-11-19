// 原始 JSON 与秘密只能留在调用组件的内存中，不进入公共客户端或持久状态。
export function splitMcpJson(raw: string) {
  const value: unknown = JSON.parse(raw);
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  if (!object(value) || Object.keys(value).some(key => key !== 'mcpServers') || !object(value.mcpServers)) throw new Error('mcp_import_invalid');
  const servers: Record<string, unknown> = Object.create(null), secrets = new Map<string, string>();
  for (const [name, entry] of Object.entries(value.mcpServers)) {
    if (!object(entry) || Object.keys(entry).some(key => !['command', 'args', 'cwd', 'env', 'url', 'headers'].includes(key))) throw new Error('mcp_import_invalid');
    const sanitized = { ...entry };
    for (const key of ['env', 'headers']) {
      if (entry[key] === undefined) continue;
      if (!object(entry[key])) throw new Error('mcp_import_invalid');
      const markers: Record<string, { secret_slot: string }> = Object.create(null);
      for (const [field, content] of Object.entries(entry[key])) {
        if (typeof content !== 'string') throw new Error('mcp_import_invalid');
        let secret = content;
        if (key === 'headers') {
          if (field !== 'Authorization' || !content.startsWith('Bearer ')) throw new Error('mcp_import_invalid');
          secret = content.slice(7);
        }
        const slot = crypto.randomUUID();
        markers[field] = { secret_slot: slot };
        secrets.set(slot, secret);
      }
      sanitized[key] = markers;
    }
    servers[name] = sanitized;
  }
  return { sanitized_json: JSON.stringify({ mcpServers: servers }), secrets };
}
