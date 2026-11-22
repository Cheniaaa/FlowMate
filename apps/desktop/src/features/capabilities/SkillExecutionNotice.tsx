import { openSettings } from '../../api/windows';
import { Button } from '../../components/ui/button';

const messages: Record<string, string> = {
  environment_interpreter_missing: '缺少此入口需要的解释器，请重新检测或选择已安装环境。',
  environment_executable_missing: '选定的解释器已不存在，请重新检测或选择已安装环境。',
  environment_selection_required: '项目有多个适用的环境，请在能力库中选择本次使用的环境。',
  environment_kind_mismatch: '所选解释器不适用于此入口，请在能力库中更换环境或入口。',
  script_dependency_missing: '解释器可用，脚本缺少依赖。请修复当前环境的依赖后从此任务继续。',
};

export default function SkillExecutionNotice({ error }: { error: string }) {
  if (error === 'script_input_changed') return <p>发送后输入文件已改变，请重新选择文件后继续当前任务。</p>;
  if (error === 'script_input_unbound') return <p>此任务没有固定文件版本，请重新选择文件并发送。</p>;
  const message = messages[error];
  return message ? <><p>{message}</p><Button onClick={() => void openSettings('environments')}>查看运行环境</Button></>
    : <p>可在任务中查看处理方式。</p>;
}
