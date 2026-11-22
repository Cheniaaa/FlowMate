import { expect, it } from 'vitest';
import { validate } from './validation';
import { binding, id, pendingUserCommand, run } from '../test/fixtures';

const fileInputs = { [id]: { file_identity: 'a'.repeat(64), source_version: 'b'.repeat(64) } };

it('接纳、Run 与 Task 的文件固定记录均经生成契约保留', () => {
  expect(validate('RunSnapshot', { ...run, file_inputs: fileInputs }).file_inputs).toEqual(fileInputs);
  expect(validate('PendingUserCommand', { ...pendingUserCommand, file_inputs: fileInputs }).file_inputs).toEqual(fileInputs);
  expect(validate('TaskExecutionBinding', { ...binding, file_inputs: fileInputs }).file_inputs).toEqual(fileInputs);
});

it('文件固定记录不接受路径或无效内容版本', () => {
  expect(() => validate('RunSnapshot', { ...run, file_inputs: {
    [id]: { file_identity: 'C:/selected.xlsx', source_version: 'b'.repeat(64) },
  } })).toThrow();
  expect(() => validate('TaskExecutionBinding', { ...binding, file_inputs: {
    [id]: { file_identity: 'a'.repeat(64), source_version: 'changed' },
  } })).toThrow();
});
