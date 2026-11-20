import type { TaskSnapshot } from '../../generated/contracts';

const labels: Record<string, string> = {
  'resources.read': '读取资料', 'artifacts.read': '读取产物', 'artifacts.export': '导出产物',
  'skills.read': '读取 Skill', 'skills.run_script': '执行 Skill 脚本',
  'memory.search': '查询记忆', 'memory.propose': '整理记忆', 'model.generate': '模型回复',
};
export function operationLabel(operation: string, task?: TaskSnapshot): string {
  const mcp = task?.binding.config.catalog.mcp_tools[operation];
  if (mcp) return `MCP · ${mcp.original_name}`;
  return labels[operation] ?? (operation.startsWith('mcp.') ? 'MCP 工具调用' : '工具调用');
}
