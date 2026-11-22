import { Button } from '../../components/ui/button';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import type { useMcpAdmission } from './useMcpAdmission';

export default function McpAdmission({ admission }: { admission: ReturnType<typeof useMcpAdmission> }) {
  const { unavailable, selected, select, waiting, cancel, choiceIssue } = admission;
  if (waiting) return <span role="status">{waiting.phase === 'waiting' ? `正在等待 ${waiting.name}，输入尚未提交。` : '正在提交输入…'}
    {waiting.phase === 'waiting' && <Button onClick={cancel}>取消等待</Button>}</span>;
  if (admission.lookupError && !selected) return <Button title={admission.lookupError} onClick={admission.retry}>重读服务状态</Button>;
  if (!unavailable.length && !selected) return null;
  return <span className="composer-service-choice">
    <NativeSelect aria-label="发送前等待的服务" value={selected} onChange={event => select(event.target.value)}>
      <NativeSelectOption value="">正常发送</NativeSelectOption>
      {selected && !unavailable.some(server => server.config.id === selected) &&
        <NativeSelectOption value={selected}>本次使用 {admission.selectedName}</NativeSelectOption>}
      {unavailable.map(server => <NativeSelectOption key={server.config.id} value={server.config.id}>等 {server.config.display_name} 就绪后发送</NativeSelectOption>)}
    </NativeSelect>
    {choiceIssue && <span role="status">{choiceIssue}</span>}
    {admission.lookupError && <span role="status">暂时无法核对所选服务。<Button onClick={admission.retry}>重读服务状态</Button></span>}
    {selected && !choiceIssue && admission.selectedServer?.state === 'connected' &&
      <span role="status">所选服务已就绪，将用于本次发送。</span>}
  </span>;
}
