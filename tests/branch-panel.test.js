import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewLoadCoordinator } from '../src/ui/branch-panel.js';

test('branch panel: replacement rows share an in-flight preview and receive its result', async () => {
  const coordinator = createPreviewLoadCoordinator();
  let resolvePreview;
  let attempts = 0;
  const loader = () => {
    attempts += 1;
    return new Promise((resolve) => { resolvePreview = resolve; });
  };

  const originalRow = coordinator.load('root', 'snapshot', loader);
  const replacementRow = coordinator.load('root', 'snapshot', loader);
  await Promise.resolve();
  assert.equal(attempts, 1);
  assert.equal(originalRow, replacementRow);

  resolvePreview('shared preview');
  assert.equal(await originalRow, 'shared preview');
  assert.equal(await replacementRow, 'shared preview');
});

test('branch panel: failed preview loads are removed so a rerender can retry', async () => {
  const coordinator = createPreviewLoadCoordinator();
  await assert.rejects(
    coordinator.load('root', 'snapshot', async () => { throw new Error('offline'); }),
    /offline/,
  );
  assert.equal(await coordinator.load('root', 'snapshot', async () => 'recovered'), 'recovered');
});
