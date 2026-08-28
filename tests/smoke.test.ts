import { describe, expect, it } from 'vitest';

import * as engine from '../src/engine/index';

describe('engine module', () => {
  it('imports successfully', () => {
    expect(engine).toBeDefined();
  });
});
