import type { TaskSnapshot } from '../../generated/contracts';

const labels: Record<string, string> = {
  'files.list': '列出文件', 'files.read_text': '读取文本', 'files.inspect_batch': '检查文件',
  'resources.read': '读取资料', 'artifacts.read': '读取产物', 'artifacts.export': '导出产物',
  'artifacts.create_text': '创建文本产物',
  'skills.read': '读取 Skill', 'skills.run_script': '执行 Skill 脚本',
  'memory.search': '查询记忆', 'memory.propose': '整理记忆', 'memory.remember': '保存记忆', 'model.generate': '模型回复',
  'run.finish': '提交答复', 'user.ask': '向用户提问', 'task.submit': '提交任务', 'task.await': '等待任务',
  'task.status': '查看任务状态', 'task.result': '读取任务结果', 'task.cancel': '停止任务',
};
export function knownOperationLabel(operation: string): string | undefined {
  return Object.hasOwn(labels, operation) ? labels[operation] : undefined;
}

export function operationLabel(operation: string, task?: TaskSnapshot): string {
  const mcp = task?.binding.config.catalog.mcp_tools[operation];
  if (mcp) return `MCP · ${mcp.original_name}`;
  return knownOperationLabel(operation) ?? (operation.startsWith('mcp.') ? 'MCP 工具调用' : '工具调用');
}
