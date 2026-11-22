import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);
// jsdom 不提供 ResizeObserver。Radix 用它同步表单中选择控件的尺寸。
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
