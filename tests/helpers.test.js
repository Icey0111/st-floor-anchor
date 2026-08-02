import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSnapshotName,
  sanitizeFileName,
  isSnapshotFileName,
  SNAPSHOT_FILE_MARKER,
  filterChatListPayload,
  computeChatPreview,
  parseChatList,
  metaFromChatJson,
  createSnapshotDedupe,
  computeChatFingerprint,
  createFingerprintStore,
} from '../src/store/helpers.js';

test('helpers: snapshot name is unique and safe', () => {
  const name = buildSnapshotName('My Chat: "test"', { reason: 'roll', branchId: 'br_201', now: new Date(2026, 7, 2, 10, 5, 30) });
  assert.equal(name, 'My Chat test - [FA] roll 2026-08-02-10-05-30 br_201');
  assert.ok(!/[<>:"/\\|?*]/.test(name));
  assert.ok(name.length < 200);
});

test('helpers: sanitize strips unsafe characters and trims', () => {
  assert.equal(sanitizeFileName('a<b>c:d'), 'abcd');
  assert.equal(sanitizeFileName('  hello   world  '), 'hello world');
});

test('helpers: snapshot file marker detection', () => {
  assert.ok(isSnapshotFileName('My Chat - [FA] roll 2026-08-02 br_201.jsonl'));
  assert.ok(isSnapshotFileName('My Chat br_201 [FA]'));
  assert.ok(!isSnapshotFileName('My Chat - roll 2026-08-02 br_201'));
  assert.ok(!isSnapshotFileName(null));
  assert.equal(SNAPSHOT_FILE_MARKER, '[FA]');
});

test('helpers: chat list filter hides snapshots, keeps native chats', () => {
  const simpleList = [
    { file_name: 'My Chat.jsonl', file_id: 'My Chat' },
    { file_name: 'My Chat - [FA] roll 2026-08-02 br_201.jsonl', file_id: 'My Chat - [FA] roll 2026-08-02 br_201' },
    { file_name: 'Another Chat.jsonl', file_id: 'Another Chat' },
  ];
  assert.deepEqual(filterChatListPayload(simpleList).map((x) => x.file_name), [
    'My Chat.jsonl',
    'Another Chat.jsonl',
  ]);

  const fullList = [
    { file_name: 'My Chat', file_id: 'My Chat', message_count: 3 },
    { file_name: 'Legacy Snapshot br_202 [FA]', file_id: 'Legacy Snapshot br_202 [FA]', message_count: 5 },
  ];
  assert.deepEqual(filterChatListPayload(fullList).map((x) => x.file_name), ['My Chat']);

  const searchResults = [
    { file_name: 'My Chat', preview_message: 'hi' },
    { file_name: 'My Chat - [FA] delete 2026-08-02 br_202', preview_message: 'bye' },
  ];
  assert.deepEqual(filterChatListPayload(searchResults).map((x) => x.file_name), ['My Chat']);

  // Plain object payloads (e.g. { error: true }) pass through untouched.
  assert.deepEqual(filterChatListPayload({ error: true }), { error: true });
  assert.deepEqual(filterChatListPayload(null), null);
  assert.deepEqual(filterChatListPayload([]), []);
});

test('helpers: chat list filter accepts a custom hidden-entry predicate', () => {
  const list = [
    { file_name: 'normal-1' },
    { file_name: 'legacy-active-snapshot' },
    { file_name: 'normal-2' },
  ];
  const isHidden = (entry) => entry.file_name === 'legacy-active-snapshot';
  assert.deepEqual(filterChatListPayload(list, isHidden).map((x) => x.file_name), ['normal-1', 'normal-2']);
  assert.deepEqual(filterChatListPayload({ list }, isHidden).list.map((x) => x.file_name), ['normal-1', 'normal-2']);
});

test('helpers: chat preview uses last non-empty message, collapses and truncates', () => {
  const chat = [
    { name: 'User', is_user: true, mes: 'Hello there.' },
    { name: 'AI', is_user: false, mes: '' },
    { name: 'AI', is_user: false, mes: '  你好，欢迎来到\n  这家小酒馆。  ' },
  ];
  assert.equal(computeChatPreview(chat), '你好，欢迎来到 这家小酒馆。');
  assert.equal(computeChatPreview(chat, 6), '你好，欢迎来');
  assert.equal(computeChatPreview([{ mes: 'single line' }]), 'single line');
  assert.equal(computeChatPreview([]), '');
  assert.equal(computeChatPreview(null), '');
});

test('helpers: chat preview uses display_text but never reasoning', () => {
  const displayText = [{ name: 'AI', mes: '', extra: { display_text: 'tool result: success' } }];
  assert.equal(computeChatPreview(displayText, 30), 'tool result: success');
  // A thinking-only last message (empty body + reasoning) must be skipped in
  // favour of the previous real message.
  const thinkingThenBody = [
    { name: 'User', mes: 'Hello, tavern keeper.' },
    { name: 'AI', mes: '', extra: { reasoning: 'Let me think step by step.' } },
  ];
  assert.equal(computeChatPreview(thinkingThenBody, 30), 'Hello, tavern keeper.');
  // Reasoning must never be shown even when it is the only content.
  const onlyThinking = [{ name: 'AI', mes: '', extra: { reasoning: 'Let me think...' } }];
  assert.equal(computeChatPreview(onlyThinking), '');
  const allEmpty = [{ name: 'AI', mes: '', extra: {} }, { name: 'User', mes: '   ' }];
  assert.equal(computeChatPreview(allEmpty), '');
});

test('helpers: chat preview strips markup tags and XML comments', () => {
  const dreamPlot = [{
    name: 'AI',
    mes: '<dream_plot><dream_body><!-- 草稿：醒来 --><!-- 分析：合理 -->她睁开了眼睛，四周是木质小屋。</dream_body></dream_plot>',
  }];
  assert.equal(computeChatPreview(dreamPlot, 30), '她睁开了眼睛，四周是木质小屋。');
  const pureMarkup = [{ name: 'AI', mes: '<dream_plot></dream_plot>' }, { name: 'User', mes: '正文' }];
  assert.equal(computeChatPreview(pureMarkup), '正文');
});

test('helpers: chat preview removes preset status-bar blocks entirely', () => {
  const withStatusBar = [{
    name: 'AI',
    mes: '<dream_plot><dream_body><dream_scene><date>2012年4月10日</date><time>傍晚 5:36</time><location>Eldoria 森林空地</location></dream_scene>'
      + '<!-- 草稿 -->她睁开了眼睛，四周是木质小屋。</dream_body>'
      + '<dream_after_format><dream_summary>梦境摘要</dream_summary><dream_done/></dream_after_format></dream_plot>',
  }];
  assert.equal(computeChatPreview(withStatusBar, 30), '她睁开了眼睛，四周是木质小屋。');
  // A message that is ONLY a status bar yields no preview; fall back to the previous message.
  const onlyStatusBar = [
    { name: 'User', mes: '我推开了酒馆的门。' },
    { name: 'AI', mes: '<dream_scene><date>2012年</date><time>傍晚</time><location>酒馆</location></dream_scene>' },
  ];
  assert.equal(computeChatPreview(onlyStatusBar, 30), '我推开了酒馆的门。');
});

test('helpers: chat preview defaults to 30 chars and honours custom filter blocks', () => {
  assert.equal(computeChatPreview([{ mes: 'a'.repeat(40) }]), 'a'.repeat(30));
  const custom = [{ name: 'AI', mes: '<mypreset_bar>状态栏文字</mypreset_bar>她走进了森林。' }];
  // Without config, the unknown tag is stripped but its text remains.
  assert.equal(computeChatPreview(custom, 30), '状态栏文字 她走进了森林。');
  // With the tag configured, the whole block is removed.
  assert.equal(computeChatPreview(custom, 30, { filterBlocks: ['mypreset_bar'] }), '她走进了森林。');
  // Angle-bracket notation and case are normalised; default blocks still work.
  assert.equal(computeChatPreview(custom, 30, { filterBlocks: ['<Mypreset_Bar>'] }), '她走进了森林。');
});

test('helpers: parse chat list response', () => {
  const data = { a: { file_name: 'one.jsonl' }, b: { file_name: 'two.jsonl' }, c: {} };
  assert.deepEqual(parseChatList(data), ['one', 'two']);
  assert.deepEqual(parseChatList(null), []);
  assert.deepEqual(parseChatList({}), []);
});

test('helpers: extract meta from fetched chat JSON', () => {
  const chatJson = [
    { chat_metadata: { st_floor: { schema: 3, branch: { id: 'br_200', kind: 'active', reason: 'root' } } } },
    { name: 'AI', mes: 'hi' },
  ];
  const meta = metaFromChatJson(chatJson);
  assert.equal(meta.branch.id, 'br_200');
  assert.equal(metaFromChatJson([]), null);
  assert.equal(metaFromChatJson([{ chat_metadata: {} }]), null);
});

test('helpers: snapshot dedupe per chat+reason', () => {
  const isDupe = createSnapshotDedupe(400);
  assert.equal(isDupe('chatA', 'roll'), false);
  assert.equal(isDupe('chatA', 'roll', Date.now() + 100), true);
  assert.equal(isDupe('chatA', 'delete', Date.now() + 100), false);
  assert.equal(isDupe('chatA', 'roll', Date.now() + 500), false);
});

test('helpers: fingerprint ignores volatile metadata, detects content change', () => {
  const base = [
    { id: 'm1', name: 'User', is_user: true, mes: 'Hello', send_date: '2026-08-02T10:00:00.000Z', token_count: 3 },
    { id: 'm2', name: 'AI', is_user: false, mes: 'Hi', send_date: '2026-08-02T10:00:05.000Z', extra: { reasoning: 'x' }, token_count: 4 },
  ];
  const sameContent = [
    { id: 'm1', name: 'User', is_user: true, mes: 'Hello', send_date: '2026-08-02T99:99:99.000Z', token_count: 999 },
    { id: 'm2', name: 'AI', is_user: false, mes: 'Hi', send_date: '2026-08-02T99:99:99.000Z', extra: { reasoning: 'x' }, token_count: 999 },
  ];
  const changed = [
    { id: 'm1', name: 'User', is_user: true, mes: 'Hello', send_date: 'x' },
    { id: 'm2', name: 'AI', is_user: false, mes: 'Hi there', send_date: 'x' },
  ];
  assert.equal(computeChatFingerprint(base), computeChatFingerprint(sameContent));
  assert.notEqual(computeChatFingerprint(base), computeChatFingerprint(changed));
});

test('helpers: fingerprint store persists per branch', () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };
  const store = createFingerprintStore(storage);
  assert.equal(store.get('br_200:roll'), null);
  store.set('br_200:roll', 'fp-1');
  assert.equal(store.get('br_200:roll'), 'fp-1');
  const store2 = createFingerprintStore(storage);
  assert.equal(store2.get('br_200:roll'), 'fp-1');
  assert.equal(store2.get('br_200:delete'), null);
});
