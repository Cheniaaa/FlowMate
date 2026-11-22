import type { ActivityView, ArtifactRef } from '../../generated/contracts';

const mediaNames: Record<ArtifactRef['media_type'], string> = {
  'text/plain': '文本产物',
  'text/markdown': 'Markdown 文档',
  'application/json': 'JSON 数据',
  'application/octet-stream': '二进制文件',
  'image/png': 'PNG 图片',
  'image/jpeg': 'JPEG 图片',
};

export function describeArtifacts(artifacts: readonly ArtifactRef[], activities: readonly ActivityView[]) {
  const filenames = new Map(activities.flatMap(activity => (activity.script_execution?.outputs ?? [])
    .filter(({ artifact }) => artifact.activity_id === activity.id && artifact.task_id === activity.task_id)
    .map(output => [output.artifact.id, output.relative_path] as const)));
  const unique = [...new Map(artifacts.map(artifact => [artifact.id, artifact])).values()];
  const nameCounts = new Map<string, number>();
  for (const artifact of unique) {
    const filename = filenames.get(artifact.id);
    if (filename) nameCounts.set(filename, (nameCounts.get(filename) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  return unique.map(artifact => {
    const filename = filenames.get(artifact.id);
    const group = filename ? `path:${filename}` : `media:${artifact.media_type}`;
    const count = (counts.get(group) ?? 0) + 1;
    counts.set(group, count);
    const label = filename
      ? nameCounts.get(filename)! > 1 ? `${filename} · 第 ${count} 项` : filename
      : `${mediaNames[artifact.media_type]} ${count}`;
    return { artifact, label };
  });
}
