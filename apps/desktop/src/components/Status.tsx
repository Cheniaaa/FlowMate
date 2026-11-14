import type { ActivityView, TaskSnapshot } from '../generated/contracts';

const labels = { queued: '排队中', running: '运行中', waiting_user: '等待回答', waiting_approval: '待审批', waiting_children: '等待子任务',
  interrupted: '已中断', blocked_incompatible: '版本不兼容', completed: '已完成', failed: '失败', cancelled: '已取消',
  prepared: '待执行', dispatched: '执行中', succeeded: '成功', uncertain: '结果未确认' };
export default function Status({ state }: { state: TaskSnapshot['state'] | ActivityView['state'] }) {
  return <span className={`status status--${state}`}><span aria-hidden="true">●</span> {labels[state]}</span>;
}
