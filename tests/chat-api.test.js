import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  clear() { this.#values.clear(); }
}

const storage = new MemoryStorage();
globalThis.localStorage = storage;

const host = await import('./fixtures/st-script.js');
const extensions = await import('./fixtures/extensions.js');
const {
  createSnapshot,
  deleteSnapshotFile,
  loadBranchPreview,
  migrateLegacyStorage,
  scanBranches,
} = await import('../src/store/chat-api.js');

function response(ok, payload = {}) {
  return {
    ok,
    json: async () => structuredClone(payload),
  };
}

function branchMeta(id, kind, fileName, { parent = null, mainChat = null } = {}) {
  const branch = { id, kind, reason: kind === 'active' ? 'root' : 'roll', file_name: fileName };
  if (parent !== null) branch.parent = parent;
  const chat_metadata = { st_floor: { schema: 3, branch } };
  if (mainChat) chat_metadata.main_chat = mainChat;
  return chat_metadata;
}

function catalogEntry(fileName, chatMetadata, { mes = 'body', chatItems = 1, fileSize = 100 } = {}) {
  return {
    file_name: `${fileName}.jsonl`,
    file_size: fileSize,
    chat_items: chatItems,
    mes,
    chat_metadata: chatMetadata,
  };
}

function reset({ avatar = 'avatar.png', chatId = 'root' } = {}) {
  storage.clear();
  host.resetHostState({ avatar, chatId });
  extensions.resetExtensionSettings();
  globalThis.fetch = undefined;
}

test('host API: failed snapshot save is retryable and does not commit dedupe state', async () => {
  reset({ avatar: 'save-failure.png' });
  host.chat.push({ is_user: true, mes: 'hello' });
  host.chat_metadata.st_floor = branchMeta('br_000', 'active', 'root').st_floor;
  let attempts = 0;
  host.hostState.saveChatImpl = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('disk full');
  };

  await assert.rejects(createSnapshot({ reason: 'roll' }), /disk full/);
  const retried = await createSnapshot({ reason: 'roll' });

  assert.equal(attempts, 2);
  assert.equal(retried.skipped, undefined);
  assert.equal(retried.meta.branch.parent, 'br_000');
});

test('host API: prune delete failure returns false and a later retry succeeds', async () => {
  reset({ avatar: 'delete-failure.png' });
  let attempts = 0;
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/chats/delete');
    attempts += 1;
    return response(attempts > 1);
  };

  assert.equal(await deleteSnapshotFile('snapshot'), false);
  assert.equal(await deleteSnapshotFile('snapshot'), true);
  assert.equal(attempts, 2);
});

test('host API: migration isolates partial save/delete failures and continues later rewrites', async (t) => {
  reset({ avatar: 'migration-failure.png' });
  t.mock.method(console, 'error', () => {});
  const root = 'root';
  const snapshot1 = 'root - [FA] roll 2026 br_201';
  const snapshot2 = 'root - [FA] roll 2026 br_202';
  const snapshot3 = 'root - [FA] roll 2026 br_203';
  const entries = {
    root: catalogEntry(root, branchMeta('br_200', 'active', root)),
    one: catalogEntry(snapshot1, branchMeta('br_201', 'snapshot', snapshot1, { parent: 'br_200', mainChat: root })),
    two: catalogEntry(snapshot2, branchMeta('br_202', 'snapshot', snapshot2, { parent: 'br_200', mainChat: root })),
    three: catalogEntry(snapshot3, branchMeta('br_203', 'snapshot', snapshot3, { parent: 'br_200', mainChat: root })),
  };
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body ?? '{}');
    calls.push({ url, body });
    if (url === '/api/characters/chats') return response(true, entries);
    if (url === '/api/chats/get') {
      const entry = Object.values(entries).find((candidate) => candidate.file_name === `${body.file_name}.jsonl`);
      return response(!!entry, [{ chat_metadata: structuredClone(entry?.chat_metadata ?? {}) }]);
    }
    if (url === '/api/chats/save') {
      return response(body.file_name !== snapshot1.replace(/br_201$/, 'br_000-1'));
    }
    if (url === '/api/chats/delete') {
      return response(body.chatfile !== `${snapshot2}.jsonl`);
    }
    throw new Error(`unexpected endpoint ${url}`);
  };

  const summary = await migrateLegacyStorage();
  const deletes = calls.filter((call) => call.url === '/api/chats/delete').map((call) => call.body.chatfile);
  const saves = calls.filter((call) => call.url === '/api/chats/save').map((call) => call.body.file_name);

  assert.equal(summary.idSteps, 1);
  assert.equal(summary.failures, 2);
  assert.ok(saves.some((name) => name.endsWith('br_000-3')));
  assert.ok(!deletes.includes(`${snapshot1}.jsonl`), 'save failure must preserve the source');
  assert.ok(deletes.includes(`${snapshot2}.jsonl`), 'delete failure was attempted after a safe destination save');
  assert.ok(deletes.includes(`${snapshot3}.jsonl`), 'later migration steps still run');
});

test('host API: mixed migrated root and legacy snapshot remain retryable with a stateful catalog', async (t) => {
  reset({ avatar: 'migration-retry.png' });
  t.mock.method(console, 'error', () => {});
  const root = 'root';
  const legacy = 'root - [FA] roll 2026 br_201';
  const migrated = legacy.replace(/br_201$/, 'br_000-1');
  const entries = {
    root: catalogEntry(root, branchMeta('br_000', 'active', root)),
    legacy: catalogEntry(legacy, branchMeta('br_201', 'snapshot', legacy, { parent: 'br_200', mainChat: root })),
  };
  let failNextSave = true;

  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body ?? '{}');
    if (url === '/api/characters/chats') return response(true, entries);
    if (url === '/api/chats/get') {
      const entry = Object.values(entries).find((candidate) => candidate.file_name === `${body.file_name}.jsonl`);
      return response(!!entry, [{ chat_metadata: structuredClone(entry?.chat_metadata ?? {}) }]);
    }
    if (url === '/api/chats/save') {
      if (failNextSave) {
        failNextSave = false;
        return response(false);
      }
      entries.migrated = catalogEntry(body.file_name, body.chat[0].chat_metadata);
      return response(true);
    }
    if (url === '/api/chats/delete') {
      const key = Object.keys(entries).find((name) => entries[name].file_name === body.chatfile);
      if (key) delete entries[key];
      return response(!!key);
    }
    throw new Error(`unexpected endpoint ${url}`);
  };

  const first = await migrateLegacyStorage();
  assert.equal(first.idSteps, 0);
  assert.equal(first.failures, 1);
  assert.equal(entries.root.chat_metadata.st_floor.branch.id, 'br_000');
  assert.ok(entries.legacy, 'failed legacy source remains available for retry');

  const second = await migrateLegacyStorage();
  assert.equal(second.idSteps, 1);
  assert.equal(second.failures, 0);
  assert.equal(entries.legacy, undefined);
  assert.equal(entries.migrated.file_name, `${migrated}.jsonl`);
  assert.equal(entries.migrated.chat_metadata.st_floor.branch.id, 'br_000-1');
  assert.equal(entries.migrated.chat_metadata.st_floor.branch.parent, 'br_000');
});

test('host API: failed migration source delete is deduplicated and completes on retry', async (t) => {
  reset({ avatar: 'migration-delete-retry.png' });
  t.mock.method(console, 'error', () => {});
  const root = 'root';
  const legacy = 'root - [FA] roll 2026 br_201';
  const migrated = legacy.replace(/br_201$/, 'br_000-1');
  const entries = {
    root: catalogEntry(root, branchMeta('br_200', 'active', root)),
    legacy: catalogEntry(legacy, branchMeta('br_201', 'snapshot', legacy, { parent: 'br_200', mainChat: root })),
  };
  let failNextDelete = true;

  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body ?? '{}');
    if (url === '/api/characters/chats') return response(true, entries);
    if (url === '/api/chats/get') {
      const entry = Object.values(entries).find((candidate) => candidate.file_name === `${body.file_name}.jsonl`);
      return response(!!entry, [{ chat_metadata: structuredClone(entry?.chat_metadata ?? {}) }]);
    }
    if (url === '/api/chats/save') {
      const key = body.file_name === root ? 'root' : 'migrated';
      entries[key] = catalogEntry(body.file_name, body.chat[0].chat_metadata);
      return response(true);
    }
    if (url === '/api/chats/delete') {
      if (failNextDelete) {
        failNextDelete = false;
        return response(false);
      }
      const key = Object.keys(entries).find((name) => entries[name].file_name === body.chatfile);
      if (key) delete entries[key];
      return response(!!key);
    }
    throw new Error(`unexpected endpoint ${url}`);
  };

  const first = await migrateLegacyStorage();
  assert.equal(first.idSteps, 0);
  assert.equal(first.failures, 1);
  assert.ok(entries.legacy);
  assert.equal(entries.migrated.file_name, `${migrated}.jsonl`);
  assert.equal(entries.root.chat_metadata.st_floor.branch.id, 'br_200');

  const second = await migrateLegacyStorage();
  assert.equal(second.idSteps, 2);
  assert.equal(second.failures, 0);
  assert.equal(entries.legacy, undefined);
  assert.equal(entries.root.chat_metadata.st_floor.branch.id, 'br_000');
  assert.equal(entries.migrated.chat_metadata.st_floor.branch.id, 'br_000-1');
});

test('host API: migration reports an unavailable catalog as a failure', async (t) => {
  reset({ avatar: 'migration-catalog-failure.png' });
  t.mock.method(console, 'error', () => {});
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/characters/chats');
    return response(false);
  };

  const summary = await migrateLegacyStorage();
  assert.equal(summary.failures, 1);
  assert.equal(summary.idSteps, 0);
});

test('host API: legacy rename failure is counted without blocking later files', async (t) => {
  reset({ avatar: 'rename-failure.png' });
  t.mock.method(console, 'error', () => {});
  const entries = {
    root: catalogEntry('root', branchMeta('br_000', 'active', 'root')),
    one: catalogEntry('legacy one', branchMeta('br_000-1', 'snapshot', 'legacy one', { parent: 'br_000', mainChat: 'root' })),
    two: catalogEntry('legacy two', branchMeta('br_000-2', 'snapshot', 'legacy two', { parent: 'br_000', mainChat: 'root' })),
  };
  const renamed = [];

  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body ?? '{}');
    if (url === '/api/characters/chats') return response(true, entries);
    if (url === '/api/chats/rename') {
      renamed.push(body.original_file);
      return response(body.original_file !== 'legacy one.jsonl');
    }
    throw new Error(`unexpected endpoint ${url}`);
  };

  const summary = await migrateLegacyStorage();
  assert.deepEqual(renamed, ['legacy one.jsonl', 'legacy two.jsonl']);
  assert.equal(summary.snapshotsRenamed, 1);
  assert.equal(summary.failures, 1);
});

test('host API: catalog failure falls back to the last derived index without full-chat reads', async () => {
  reset({ avatar: 'catalog-failure.png' });
  const entries = {
    root: catalogEntry('root', branchMeta('br_000', 'active', 'root'), { mes: 'cached root' }),
    child: catalogEntry(
      'root - [FA] roll br_000-1',
      branchMeta('br_000-1', 'snapshot', 'root - [FA] roll br_000-1', { parent: 'br_000', mainChat: 'root' }),
      { mes: 'cached child' },
    ),
  };
  let catalogAvailable = true;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url !== '/api/characters/chats') throw new Error(`unexpected endpoint ${url}`);
    return catalogAvailable ? response(true, entries) : response(false);
  };

  const fresh = await scanBranches();
  catalogAvailable = false;
  const cached = await scanBranches();

  assert.equal(fresh.nodes.size, 2);
  assert.equal(cached.nodes.size, 2);
  assert.equal(cached.get('br_000-1').preview, 'cached child');
  assert.deepEqual(calls, ['/api/characters/chats', '/api/characters/chats']);
});

test('host API: lazy preview failure rejects only that read and remains retryable', async () => {
  reset({ avatar: 'preview-failure.png' });
  const snapshot = 'root - [FA] roll br_000-1';
  const entries = {
    root: catalogEntry('root', branchMeta('br_000', 'active', 'root')),
    child: catalogEntry(
      snapshot,
      branchMeta('br_000-1', 'snapshot', snapshot, { parent: 'br_000', mainChat: 'root' }),
      { mes: '[The message is empty]', chatItems: 2 },
    ),
  };
  let previewAttempts = 0;
  globalThis.fetch = async (url) => {
    if (url === '/api/characters/chats') return response(true, entries);
    if (url === '/api/chats/get') {
      previewAttempts += 1;
      return previewAttempts === 1
        ? response(false)
        : response(true, [{ chat_metadata: {} }, { mes: 'earlier usable preview' }]);
    }
    throw new Error(`unexpected endpoint ${url}`);
  };

  const index = await scanBranches();
  assert.equal(index.get('br_000-1').preview, null);
  await assert.rejects(loadBranchPreview(snapshot), /preview read failed/);
  assert.equal(await loadBranchPreview(snapshot), 'earlier usable preview');
  assert.equal(previewAttempts, 2);
});
