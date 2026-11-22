import type { RunFeedback, RunSnapshot } from '../../generated/contracts';
import { Button } from '../../components/ui/button';

export const modelFailures: Readonly<Record<string, string>> = {
  credential_missing: '此连接尚未配置密钥。',
  model_authentication_failed: '服务商拒绝了此连接的凭据，请检查密钥和服务地址。',
  model_permission_denied: '此连接没有访问此模型的权限，请检查账号和所选型号。',
  model_timeout: '模型响应超时。',
  model_connection_failed: '无法连接到模型服务。',
  model_rate_limited: '模型服务请求过于频繁，请稍后再试。',
  model_provider_error: '模型服务未接受本次请求，请检查所选型号及任务中需要的能力。',
  vision_model_required: '当前型号无法处理图片。原图与工具文字已保留，可选择视觉模型继续。',
  vision_continued: '已改用所选视觉模型继续处理保存的图片。',
};

export default function RunFeedbackNotice({ run, feedback, onOpenConnection }: {
  run: RunSnapshot; feedback?: RunFeedback; onOpenConnection?: (id: string) => void;
}) {
  const config = run.config;
  if (config.kind !== 'agent') return null;
  const current = feedback && feedback.version >= run.version ? feedback : undefined;
  const receipt = current?.model_activity;
  const error = receipt?.error ?? current?.reason ?? run.reason;
  const description = receipt?.state === 'uncertain' && error === 'model_authentication_failed'
    ? '服务商拒绝了此前的请求，请检查密钥和模型访问权限。'
    : error && Object.hasOwn(modelFailures, error) && modelFailures[error];
  if (!description) return null;
  return <section className="task-feedback" aria-label="连接处理"><p>{description}</p>
    {onOpenConnection && <Button type="button" size="sm" onClick={() => onOpenConnection(current?.connection_id ?? config.model_profile.connection_id)}>检查连接</Button>}
  </section>;
}
