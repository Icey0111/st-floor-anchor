import test from 'node:test';
import assert from 'node:assert/strict';

import { installChatEventHandlers } from '../src/events/chat-events.js';

test('chat events: CHAT_CHANGED waits for CHAT_LOADED preparation and preserves snapshot hiding', async () => {
  const handlers = new Map();
  const eventSource = { on: (type, handler) => handlers.set(type, handler) };
  const eventTypes = { CHAT_LOADED: 'loaded', CHAT_CHANGED: 'changed' };
  const log = [];
  let releasePreparation;
  const preparationGate = new Promise((resolve) => { releasePreparation = resolve; });

  installChatEventHandlers({
    eventSource,
    eventTypes,
    readActiveSnapshotFileName: () => 'legacy snapshot',
    setActiveSnapshotFileName: (fileName) => log.push(`active:${fileName}`),
    prepareCurrentChatStorage: async () => {
      log.push('prepare:start');
      await preparationGate;
      log.push('prepare:end');
    },
    refreshPanel: async () => { log.push('refresh'); },
  });

  const loaded = handlers.get('loaded')();
  await Promise.resolve();
  const changed = handlers.get('changed')();
  await Promise.resolve();

  assert.deepEqual(log, [
    'active:legacy snapshot',
    'prepare:start',
    'active:legacy snapshot',
  ]);

  releasePreparation();
  await Promise.all([loaded, changed]);
  assert.deepEqual(log, [
    'active:legacy snapshot',
    'prepare:start',
    'active:legacy snapshot',
    'prepare:end',
    'refresh',
    'refresh',
  ]);
});

test('chat events: preparation failure is isolated and refresh still runs', async () => {
  const handlers = new Map();
  const errors = [];
  let refreshes = 0;

  installChatEventHandlers({
    eventSource: { on: (type, handler) => handlers.set(type, handler) },
    eventTypes: { CHAT_LOADED: 'loaded', CHAT_CHANGED: 'changed' },
    prepareCurrentChatStorage: async () => { throw new Error('migration offline'); },
    refreshPanel: async () => { refreshes += 1; },
    onPreparationError: (error) => errors.push(error.message),
  });

  await handlers.get('loaded')();
  assert.deepEqual(errors, ['migration offline']);
  assert.equal(refreshes, 1);
});
