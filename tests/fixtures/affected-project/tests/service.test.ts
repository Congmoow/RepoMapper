import { expect, test } from 'vitest';

import { service } from '../src/service';

test('service returns helper value', () => {
  expect(service()).toBe('ok');
});
