/**
 * ST-facing store layer. Thin glue over verified SillyTavern 1.18.0 APIs:
 * - snapshot:  saveChat({ chatName, withMetadata, chatData }) writes a NEW
 *              chat file without switching (same primitive checkpoints use)
 * - switch:    openCharacterChat(fileName)
 * - scan:      /api/characters/chats (list) + /api/chats/get (read meta)
 * - delete:    /api/chats/delete (panel prune)
 *
 * Solo chats only in v1 (groups throw inside ST's saveChat).
 */
import {
  chat,
  chat_metadata,
  characters,
  this_chid,
  getRequestHeaders,
  getCurrentChatDetails,
  saveChat,
  openCharacterChat,
  getCurrentChatId,
  addOneMessage,
  saveCharacterDebounced,
  saveMetadata,
} from '/script.js';
import { selected_group } from '/scripts/group-chats.js';
import { getStFloorSettings } from '../settings.js';
import { shouldDeleteRewriteSource } from './mutation-policy.js';
import { createOperationQueue } from './operation-queue.js';
import { createPanelIndexCache } from './index-cache.js';

import { createBranchMeta, readBranchMeta } from '../model/metadata.js';
import { PanelIndex } from '../model/panel-index.js';
import {
  ROOT_BRANCH_ID,
  createOrphanRootMeta,
  createBranchIdCounter,
  filterMetasToCurrentTree,
  planMigrateLegacyIds,
  resolveTreeRootByChain,
} from '../model/branches.js';
import {
  buildSnapshotName,
  parseChatListEntries,
  getChatListEntryToken,
  metaFromChatJson,
  computeChatFingerprint,
  createFingerprintStore,
  isSnapshotFileName,
  sanitizeFileName,
  SNAPSHOT_FILE_MARKER,
  computeChatPreview,
} from './helpers.js';

const fingerprints = createFingerprintStore();
const branchIds = createBranchIdCounter(); // per-parent counters, root = br_000
const INTERNAL_HEADER = { 'X-StFloor-Internal': '1' };
const storeOperations = createOperationQueue();
const panelIndexCache = createPanelIndexCache();
const latestFileTokens = new Map();

function getCurrentAvatarUrl() {
  return characters?.[this_chid]?.avatar ?? '';
}

function getMainChatName() {
  return getCurrentChatDetails()?.sessionName ?? characters?.[this_chid]?.chat ?? 'chat';
}

/**
 * Persist the adopted root metadata without racing ST chat switches.
 *
 * ST's own saveMetadataDebounced only guards character/group changes, not chat
 * file changes, so a pending metadata save from the previous chat could fire
 * after the user switched to another chat of the same character and save the
 * wrong chat_metadata under the wrong file name (causing integrity errors).
 * This plugin-local schedule captures the chat id and skips the save if the
 * active chat changed before the timer fires.
 */
let rootMetadataSaveTimer = null;
let rootMetadataChatId = null;
let rootMetadataCharacterId = null;

function scheduleRootMetadataSave() {
  const chatId = getCurrentChatId();
  const characterId = this_chid;
  if (rootMetadataSaveTimer !== null) {
    clearTimeout(rootMetadataSaveTimer);
  }
  rootMetadataChatId = chatId;
  rootMetadataCharacterId = characterId;
  rootMetadataSaveTimer = setTimeout(async () => {
    rootMetadataSaveTimer = null;
    if (getCurrentChatId() !== rootMetadataChatId || this_chid !== rootMetadataCharacterId) {
      return;
    }
    try {
      await saveMetadata();
    } catch (error) {
      console.error('[Floor Anchor] failed to persist adopted root metadata:', error);
    }
  }, 1000);
}

/**
 * Persist a corrected `main_chat` into a snapshot file's header so the tree
 * membership survives reloads. Only called for files whose recorded main_chat
 * is missing or points at a file that no longer exists.
 */
async function persistMainChat(avatarUrl, fileName, mainChat) {
  try {
    const getResponse = await fetch('/api/chats/get', {
      method: 'POST',
      headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
      body: JSON.stringify({ ch_name: characters?.[this_chid]?.name ?? '', file_name: fileName, avatar_url: avatarUrl }),
      cache: 'no-cache',
    });
    if (!getResponse.ok) return false;
    const chatJson = await getResponse.json();
    if (!Array.isArray(chatJson) || !chatJson[0]?.chat_metadata) return false;
    if (chatJson[0].chat_metadata.main_chat === mainChat) return true;
    chatJson[0].chat_metadata.main_chat = mainChat;
    const saveResponse = await fetch('/api/chats/save', {
      method: 'POST',
      headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
      body: JSON.stringify({
        ch_name: characters?.[this_chid]?.name ?? '',
        file_name: fileName,
        chat: chatJson,
        avatar_url: avatarUrl,
        force: true,
      }),
    });
    return saveResponse.ok;
  } catch (error) {
    console.error(`[Floor Anchor] main_chat repair failed for ${fileName}:`, error);
    return false;
  }
}

/**
 * Raw scan: use ST's character-chat listing for cheap file-change fields and
 * first-line metadata when the host provides it. Hosts whose catalog omits
 * chat_metadata (e.g. TauriTavern) fall back to per-file header reads, so
 * snapshots remain discoverable everywhere.
 */
async function fetchAllBranchMetas(avatarUrl) {
  const currentFileName = getCurrentChatId() ?? null;
  const settings = getStFloorSettings();
  const previewKey = getPreviewSettingsKey(settings);
  const cachedScope = panelIndexCache.read(avatarUrl, currentFileName, previewKey);
  const cachedByFile = new Map(
    (cachedScope?.index?.nodes ?? [])
      .filter((node) => typeof node?.fileName === 'string')
      .map((node) => [node.fileName, node]),
  );
  const listResponse = await fetch('/api/characters/chats', {
    method: 'POST',
    headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
    body: JSON.stringify({ avatar_url: avatarUrl, metadata: true }),
  });
  if (!listResponse.ok) return { names: [], metas: [], previews: new Map(), failed: true };

  const listPayload = await listResponse.json();
  if (listPayload?.error === true) return { names: [], metas: [], previews: new Map(), failed: true };
  const entries = parseChatListEntries(listPayload);
  const names = entries.map((entry) => entry.fileName);
  const metas = [];
  const previews = new Map(); // file name -> cached preview state for plain chats
  const tokenScope = new Map();

  for (const entry of entries) {
    const name = entry.fileName;
    const previewToken = getChatListEntryToken(entry);
    tokenScope.set(name, previewToken);
    const cached = cachedByFile.get(name);
    const cachedPreview = previewToken && cached?.previewToken === previewToken && typeof cached.preview === 'string'
      ? cached.preview
      : null;
    // The catalog already supplies the last message body. Use it when it
    // produces a valid preview; only ambiguous/empty cases need a lazy full
    // chat read so they can fall back to an earlier non-empty body.
    const catalogPreview = cachedPreview === null && Number(entry.chat_items) > 0
      ? computeChatPreview(
          [{ mes: entry.mes === '[The message is empty]' ? '' : entry.mes }],
          settings.previewMaxLength,
          { filterBlocks: settings.filterBlocks },
        )
      : '';
    const preview = cachedPreview ?? (Number(entry.chat_items) === 0 ? '' : (catalogPreview || null));
    const catalogMeta = readBranchMeta(entry.chat_metadata ?? null);
    let meta = catalogMeta;

    // Some hosts (e.g. TauriTavern's /api/characters/chats) do not include
    // chat_metadata in the catalog even when asked. For entries without
    // catalog metadata, fall back to the v0.1.11 per-file header read so
    // snapshots remain discoverable. Hosts that do provide catalog metadata
    // keep the single-request fast path.
    const hasCatalogChatMetadata = entry && typeof entry.chat_metadata === 'object' && entry.chat_metadata !== null;
    if (!hasCatalogChatMetadata) {
      try {
        const getResponse = await fetch('/api/chats/get', {
          method: 'POST',
          headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
          body: JSON.stringify({ ch_name: characters?.[this_chid]?.name ?? '', file_name: name, avatar_url: avatarUrl }),
          cache: 'no-cache',
        });
        if (getResponse.ok) {
          const chatJson = await getResponse.json();
          meta = metaFromChatJson(chatJson);
        }
      } catch {
        // A single unreadable file must not fail the whole structural scan.
        // It will be skipped here and may still be listed as a plain chat if
        // the catalog contains it.
      }
    }

    if (meta) {
      const mainChat = entry.chat_metadata?.main_chat
        ?? (catalogMeta ? null : meta.mainChat);
      if (typeof mainChat === 'string' && mainChat) meta.mainChat = mainChat;
      // The list is authoritative after a rename.
      meta.branch.fileName = name;
      // Migration planners still consume the persisted snake_case shape.
      meta.branch.file_name = name;
      meta.previewToken = previewToken;
      if (preview !== null) meta.preview = preview;
      metas.push(meta);
    } else {
      previews.set(name, { preview, previewToken });
    }
  }
  latestFileTokens.clear();
  latestFileTokens.set(avatarUrl, tokenScope);
  return { names, metas, previews, failed: false, previewKey };
}

function getPreviewSettingsKey(settings = getStFloorSettings()) {
  return JSON.stringify([settings.previewMaxLength, settings.filterBlocks]);
}

function readCachedIndex(avatarUrl, currentFileName, settings = getStFloorSettings()) {
  const cached = panelIndexCache.read(avatarUrl, currentFileName, getPreviewSettingsKey(settings));
  if (!cached) return null;
  try {
    return PanelIndex.fromJSON(cached.index);
  } catch (error) {
    console.warn('[Floor Anchor] ignoring invalid cached branch index:', error);
    return null;
  }
}

/**
 * If the current chat has no st_floor metadata yet, adopt it as the root
 * branch (schema v3, kind=active, reason=root).
 */
function adoptRootIfNeededUnlocked() {
  const existing = readBranchMeta(chat_metadata);
  if (existing) {
    branchIds.track(existing.branch.id);
    return existing;
  }
  const meta = createBranchMeta({
    id: ROOT_BRANCH_ID,
    kind: 'active',
    reason: 'root',
    createdAt: new Date().toISOString(),
    fileName: characters?.[this_chid]?.chat ?? null,
  });
  chat_metadata.st_floor = meta;
  scheduleRootMetadataSave();
  panelIndexCache.invalidateAvatar(getCurrentAvatarUrl());
  const saved = readBranchMeta(chat_metadata);
  branchIds.track(saved.branch.id);
  return saved;
}

/** Adopt a plain current chat as a root without racing other store work. */
export function adoptRootIfNeeded() {
  return storeOperations.enqueue('adopt-root', () => adoptRootIfNeededUnlocked());
}

/**
 * Snapshot the current chat BEFORE a mutation.
 *
 * @param {object} opts
 * @param {string} opts.reason  'roll' | 'delete' | 'edit'
 * @param {number|null} opts.sourceFloor  1-based floor of the mutation
 * @param {Array} [opts.capturedChat]     synchronous pre-mutation clone of `chat`
 */
async function createSnapshotUnlocked({ reason, sourceFloor = null, capturedChat = null }) {
  if (selected_group) {
    console.warn('[Floor Anchor] group chats are not supported yet (M5)');
    return null;
  }
  if (!Array.isArray(chat) || chat.length === 0) {
    return null;
  }

  const chatData = capturedChat ?? structuredClone(chat);
  const parent = adoptRootIfNeededUnlocked();
  branchIds.track(parent.branch.id);
  const mainChatName = getMainChatName();
  // Every snapshot records its undo-tree root (the main chat file), so the
  // panel can isolate trees even though every chat starts at br_000.
  const treeRoot = parent.branch.kind === 'active'
    ? (parent.branch.fileName ?? mainChatName)
    : (typeof chat_metadata?.main_chat === 'string' ? chat_metadata.main_chat : mainChatName);

  // Content-level dedupe: if this branch's last snapshot has identical chat
  // content (e.g. a roll clicked while the API is disconnected), skip.
  const fingerprint = computeChatFingerprint(chatData);
  // Dedupe is per (branch, reason): a failed roll must not create a snapshot,
  // but a delete/edit is a distinct intent even if the content happens to
  // match an earlier roll snapshot.
  // Branch ids repeat in every chat tree, so the persisted dedupe key must be
  // scoped by character/avatar and root chat as well as branch and reason.
  const fingerprintKey = JSON.stringify([
    getCurrentAvatarUrl(),
    treeRoot,
    parent.branch.id,
    reason,
  ]);
  if (fingerprints.get(fingerprintKey) === fingerprint) {
    return { skipped: true, reason: 'identical-content' };
  }

  const branchId = branchIds.next(parent.branch.id);
  const fileName = buildSnapshotName(mainChatName, { reason, branchId });

  const meta = createBranchMeta({
    id: branchId,
    kind: 'snapshot',
    parent: parent.branch.id,
    sourceFloor,
    reason,
    createdAt: new Date().toISOString(),
    fileName,
  });
  await saveChat({
    chatName: fileName,
    withMetadata: { main_chat: treeRoot, st_floor: meta },
    chatData,
    force: true, // brand-new file; avoid the integrity-check popup
  });

  fingerprints.set(fingerprintKey, fingerprint);
  panelIndexCache.invalidateAvatar(getCurrentAvatarUrl());

  return { branchId, fileName, meta };
}

export function createSnapshot(options) {
  return storeOperations.enqueue('create-snapshot', () => createSnapshotUnlocked(options));
}

/** Rollback = switching the active chat to a branch/snapshot file. */
export async function switchToBranch(fileName) {
  await openCharacterChat(fileName);
}

/**
 * Append a NEW character (assistant) message floor with custom content.
 *
 * Use case: a reply got truncated inside the reasoning chain and ST keeps the
 * floor non-editable because no final body was produced. The user copies the
 * stuck text and creates a fresh character floor with it.
 *
 * The pre-append chat is snapshotted first (reason 'rescue'), so the append
 * can be rolled back from the panel like any other mutation.
 *
 * @param {string} text  message body for the new floor
 * @returns {Promise<object|null>} the created ST message object
 */
async function appendCharacterMessageUnlocked(text) {
  const content = typeof text === 'string' ? text.trim() : '';
  if (!content) {
    throw new TypeError('message text must be a non-empty string');
  }
  if (selected_group) {
    console.warn('[Floor Anchor] group chats are not supported yet (M5)');
    return null;
  }

  // Snapshot BEFORE the mutation so the panel can roll the append back.
  await createSnapshotUnlocked({ reason: 'rescue' });

  const message = {
    name: characters?.[this_chid]?.name ?? 'Character',
    is_user: false,
    is_system: false,
    role: 'assistant',
    send_date: new Date().toISOString(),
    mes: content,
    swipes: [],
    extra: {},
  };
  chat.push(message);
  try {
    addOneMessage(message);
  } catch (error) {
    // The message is already in `chat`; a render failure must not lose it.
    console.error('[Floor Anchor] render failed after appending character message:', error);
  }
  chat_metadata.tainted = true;
  // Persist immediately: ST's debounced save can be cancelled by its own
  // save loop, which would drop the appended floor. Await the actual write so
  // the store queue cannot release a later scan/prune into an unfinished save.
  await saveChat({ force: true });
  panelIndexCache.invalidateAvatar(getCurrentAvatarUrl());
  return message;
}


export function appendCharacterMessage(text) {
  return storeOperations.enqueue('append-character-message', () => appendCharacterMessageUnlocked(text));
}

/**
 * Read chat files and build an index without writing, renaming, or deleting.
 * This is the only implementation behind the public scan operation.
 */
async function scanBranchesReadOnly() {
  const avatarUrl = getCurrentAvatarUrl();
  if (!avatarUrl) return new PanelIndex();
  const currentFileName = getCurrentChatId() ?? null;

  let catalog;
  try {
    catalog = await fetchAllBranchMetas(avatarUrl);
  } catch (error) {
    console.warn('[Floor Anchor] branch catalog read failed; trying cached index:', error);
    return readCachedIndex(avatarUrl, currentFileName) ?? new PanelIndex();
  }
  const { names, metas, previews, previewKey } = catalog;
  if (catalog.failed) {
    return readCachedIndex(avatarUrl, currentFileName) ?? new PanelIndex();
  }

  // Per-chat isolation: every ST chat owns its own undo tree; the panel shows
  // only the tree the currently open chat belongs to (all chats share the
  // root id br_000, so membership is carried by main_chat).
  const tree = filterMetasToCurrentTree(metas, currentFileName);
  const treeMetas = tree.metas;
  const currentMeta = tree.currentMeta;

  // Defensive dedupe: two chat files can carry the same branch id (e.g. a
  // stale save recreated an old snapshot name after a rename). Keep the
  // marker-named file when possible so the panel never crashes on duplicates.
  const seenBranchIds = new Set();
  const uniqueMetas = [];
  for (const meta of treeMetas) {
    if (seenBranchIds.has(meta.branch.id)) {
      const existing = uniqueMetas.find((m) => m.branch.id === meta.branch.id);
      if (existing && !isSnapshotFileName(existing.branch.file_name) && isSnapshotFileName(meta.branch.file_name)) {
        existing.branch.file_name = meta.branch.file_name;
        existing.branch.fileName = meta.branch.fileName;
      }
      console.log(`[Floor Anchor] skipping duplicate branch id ${meta.branch.id} (${meta.branch.file_name})`);
      continue;
    }
    seenBranchIds.add(meta.branch.id);
    uniqueMetas.push(meta);
  }

  // Per-chat id counters: rebuild from this tree only, so switching chats
  // restarts the numbering (the next chat's first snapshot is br_000-1 again).
  branchIds.reset();
  const index = PanelIndex.build(uniqueMetas);
  for (const meta of uniqueMetas) branchIds.track(meta.branch.id);
  // The live chat is always a root: when it is a real chat file (no [FA]
  // marker) but the built index lost its active node for it (corrupted
  // metadata, dedupe collision, ...), re-add it as an unmanaged br_000 root
  // so the panel can never switch to a rootless "branch tree" while the user
  // stays on the main chat. Plain ST chats (no st_floor at all) hit the same
  // path and are adopted as br_000 on the next snapshot trigger.
  const hasLiveRoot = !!currentFileName && !isSnapshotFileName(currentFileName)
    && [...index.nodes.values()].some((n) => n.kind === 'active' && n.fileName === currentFileName);
  if (!hasLiveRoot && currentFileName && names.includes(currentFileName) && !isSnapshotFileName(currentFileName)) {
    const previewState = previews.get(currentFileName) ?? null;
    const orphan = createOrphanRootMeta(currentFileName);
    if (typeof previewState?.preview === 'string') orphan.preview = previewState.preview;
    if (typeof previewState?.previewToken === 'string') orphan.previewToken = previewState.previewToken;
    index.add(orphan);
  }
  // Mark the currently open chat's node as active so the panel can show at a
  // glance whether the user is on the root mainline or on a branch snapshot.
  let activeId = null;
  if (currentMeta?.branch?.id) {
    activeId = currentMeta.branch.id;
  } else if (index.nodes.size === 1) {
    activeId = [...index.nodes.keys()][0]; // unmanaged/plain chat fallback root
  }
  if (activeId && index.get(activeId)) {
    index.setActive(activeId);
  }
  const rootNode = [...index.nodes.values()].find((node) => node.kind === 'active' && node.parent === null);
  if (rootNode?.fileName) {
    panelIndexCache.write({
      avatarUrl,
      rootFileName: rootNode.fileName,
      index: index.toJSON(),
      previewKey,
    });
  }
  return index;
}

/** Pure scan, serialized with writes so it sees a complete store state. */
export function scanBranches() {
  return storeOperations.enqueue('scan-branches', scanBranchesReadOnly);
}

/** Read one full chat only when its on-screen preview is actually needed. */
async function loadBranchPreviewUnlocked(fileName) {
  const avatarUrl = getCurrentAvatarUrl();
  if (!avatarUrl || !fileName) return '';
  const settings = getStFloorSettings();
  const response = await fetch('/api/chats/get', {
    method: 'POST',
    headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
    body: JSON.stringify({
      ch_name: characters?.[this_chid]?.name ?? '',
      file_name: fileName,
      avatar_url: avatarUrl,
    }),
    cache: 'no-cache',
  });
  if (!response.ok) throw new Error(`preview read failed for ${fileName}`);
  const chatJson = await response.json();
  const preview = computeChatPreview(chatJson, settings.previewMaxLength, { filterBlocks: settings.filterBlocks });
  const currentFileName = getCurrentChatId() ?? fileName;
  const previewToken = latestFileTokens.get(avatarUrl)?.get(fileName) ?? null;
  panelIndexCache.setPreview(
    avatarUrl,
    currentFileName,
    fileName,
    getPreviewSettingsKey(settings),
    preview,
    previewToken,
  );
  return preview;
}

export function loadBranchPreview(fileName) {
  return storeOperations.enqueue('load-branch-preview', () => loadBranchPreviewUnlocked(fileName));
}

/**
 * Explicit, idempotent legacy repair pass. This is intentionally separate
 * from scanBranches(): callers choose when disk mutations are allowed.
 */
async function migrateLegacyStorageUnlocked() {
  const avatarUrl = getCurrentAvatarUrl();
  const summary = {
    idSteps: 0,
    snapshotsRenamed: 0,
    duplicatesRemoved: 0,
    mainChatsRepaired: 0,
    failures: 0,
  };
  if (!avatarUrl) return summary;

  const currentFileName = getCurrentChatId() ?? null;
  let catalog = await fetchAllBranchMetas(avatarUrl);
  if (catalog.failed) {
    summary.failures += 1;
    console.error('[Floor Anchor] legacy migration aborted: chat catalog is unavailable');
    return summary;
  }
  let { metas } = catalog;
  let treeMetas = filterMetasToCurrentTree(metas, currentFileName).metas;

  const legacyMigration = planMigrateLegacyIds(treeMetas);
  if (legacyMigration.migrated) {
    console.log(`[Floor Anchor] migrating ${legacyMigration.steps.length} legacy branch id(s) to recursive scheme`);
    const result = await applyMigrationSteps(legacyMigration.steps, avatarUrl);
    summary.idSteps += result.completed;
    summary.failures += result.failed;
    catalog = await fetchAllBranchMetas(avatarUrl);
    if (catalog.failed) {
      summary.failures += 1;
      console.error('[Floor Anchor] legacy migration stopped: refreshed chat catalog is unavailable');
      if (result.completed > 0) panelIndexCache.invalidateAvatar(avatarUrl);
      return summary;
    }
    ({ metas } = catalog);
    treeMetas = filterMetasToCurrentTree(metas, currentFileName).metas;
  }

  // Add the marker used by the native-list filter. Never rename the currently
  // open file: ST may save it under the old name while the rename is running.
  const metaByFileName = new Map(
    treeMetas.filter((m) => m.branch.file_name).map((m) => [m.branch.file_name, m]),
  );
  for (const meta of treeMetas) {
    const fileName = meta.branch.file_name;
    if (
      meta.branch.kind !== 'snapshot'
      || !fileName
      || fileName === currentFileName
      || isSnapshotFileName(fileName)
    ) continue;

    const renamed = sanitizeFileName(`${fileName} ${SNAPSHOT_FILE_MARKER}`);
    if (renamed === fileName) continue;
    const destination = metaByFileName.get(renamed);
    if (destination) {
      if (destination.branch.kind === 'snapshot' && destination.branch.id === meta.branch.id) {
        const deleteResponse = await fetch('/api/chats/delete', {
          method: 'POST',
          headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
          body: JSON.stringify({ chatfile: `${fileName}.jsonl`, avatar_url: avatarUrl }),
        });
        if (deleteResponse.ok) {
          summary.duplicatesRemoved += 1;
          meta.branch.file_name = renamed;
          console.log(`[Floor Anchor] removed duplicate legacy snapshot ${fileName} (kept ${renamed})`);
        } else {
          summary.failures += 1;
          console.error(`[Floor Anchor] failed to remove duplicate legacy snapshot ${fileName}`);
        }
      }
      continue;
    }

    const renameResponse = await fetch('/api/chats/rename', {
      method: 'POST',
      headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
      body: JSON.stringify({
        is_group: false,
        avatar_url: avatarUrl,
        original_file: `${fileName}.jsonl`,
        renamed_file: `${renamed}.jsonl`,
      }),
    });
    if (renameResponse.ok) {
      summary.snapshotsRenamed += 1;
      meta.branch.file_name = renamed;
      metaByFileName.delete(fileName);
      metaByFileName.set(renamed, meta);
      console.log(`[Floor Anchor] migrated legacy snapshot name: ${fileName} -> ${renamed}`);
    } else {
      summary.failures += 1;
      console.error(`[Floor Anchor] legacy snapshot rename failed: ${fileName} -> ${renamed}`);
    }
  }

  // Persist inferred tree roots after id/name migration. Open files are left
  // untouched and will be repaired on a later chat load.
  const fileNameOf = (m) => m?.branch?.file_name ?? m?.branch?.fileName ?? null;
  const activeRootByFileName = new Map(
    metas
      .filter((m) => m?.branch?.kind === 'active')
      .map((m) => [fileNameOf(m), m]),
  );
  for (const meta of metas) {
    const branch = meta?.branch;
    if (!branch || branch.kind !== 'snapshot') continue;
    const directRoot = typeof meta?.mainChat === 'string' && activeRootByFileName.has(meta.mainChat)
      ? meta.mainChat
      : null;
    const resolved = directRoot ?? resolveTreeRootByChain(metas, meta);
    if (!resolved || resolved === meta.mainChat || !branch.file_name || branch.file_name === currentFileName) continue;
    if (await persistMainChat(avatarUrl, branch.file_name, resolved)) {
      summary.mainChatsRepaired += 1;
      console.log(`[Floor Anchor] repaired main_chat for ${branch.file_name} -> ${resolved}`);
    } else {
      summary.failures += 1;
    }
  }
  if (
    summary.idSteps
    || summary.snapshotsRenamed
    || summary.duplicatesRemoved
    || summary.mainChatsRepaired
  ) {
    panelIndexCache.invalidateAvatar(avatarUrl);
  }
  return summary;
}

export function migrateLegacyStorage() {
  return storeOperations.enqueue('migrate-legacy-storage', migrateLegacyStorageUnlocked);
}

/** Adopt the live root and run legacy repairs as one non-interleavable unit. */
export function prepareCurrentChatStorage() {
  return storeOperations.enqueue('prepare-current-chat', async () => {
    adoptRootIfNeededUnlocked();
    return migrateLegacyStorageUnlocked();
  });
}

/** Delete a snapshot/branch file from the panel (prune). */
async function deleteSnapshotFileUnlocked(fileName) {
  const avatarUrl = getCurrentAvatarUrl();
  if (!avatarUrl || !fileName) return false;
  const response = await fetch('/api/chats/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ chatfile: `${fileName}.jsonl`, avatar_url: avatarUrl }),
  });
  if (response.ok) panelIndexCache.invalidateAvatar(avatarUrl);
  return response.ok;
}

export function deleteSnapshotFile(fileName) {
  return storeOperations.enqueue('delete-snapshot', () => deleteSnapshotFileUnlocked(fileName));
}

/**
 * Executor for legacy migration steps: read each file, rewrite
 * its st_floor id/parent, save under the new name (force), delete the old
 * file, and keep the character chat field in sync when the renamed file is
 * the currently open chat. Never saves and deletes the same name (guard).
 */
async function applyMigrationSteps(steps, avatarUrl) {
  const result = { completed: 0, failed: 0 };
  for (const step of steps) {
    if (step.rename === false && result.failed > 0) {
      console.warn(`[Floor Anchor] migration deferred active root ${step.fileName ?? '(unknown)'} until snapshot retries succeed`);
      continue;
    }
    const rename = step.rename !== false;
    const targetFileName = rename ? step.newFileName : step.fileName;
    if (!step.fileName || !targetFileName || (rename && targetFileName === step.fileName)) {
      console.warn(`[Floor Anchor] migration skip: no safe name change for ${step.fileName ?? '(unknown)'}`);
      result.failed += 1;
      continue;
    }
    try {
      const getResponse = await fetch('/api/chats/get', {
        method: 'POST',
        headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
        body: JSON.stringify({ ch_name: characters?.[this_chid]?.name ?? '', file_name: step.fileName, avatar_url: avatarUrl }),
        cache: 'no-cache',
      });
      if (!getResponse.ok) {
        result.failed += 1;
        continue;
      }
      const chatJson = await getResponse.json();
      const branch = chatJson?.[0]?.chat_metadata?.st_floor?.branch;
      if (!branch) {
        result.failed += 1;
        continue;
      }

      branch.id = step.newId;
      if (step.newParent === null) {
        delete branch.parent;
      } else {
        branch.parent = step.newParent;
      }

      // Save the rewritten file under the new name first, then drop the old
      // one, so a failure never loses data (force bypasses integrity check).
      const saveResponse = await fetch('/api/chats/save', {
        method: 'POST',
        headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
        body: JSON.stringify({
          ch_name: characters?.[this_chid]?.name ?? '',
          file_name: targetFileName,
          chat: chatJson,
          avatar_url: avatarUrl,
          force: true,
        }),
      });
      if (!saveResponse.ok) {
        console.error(`[Floor Anchor] migration save failed for ${step.fileName}`);
        result.failed += 1;
        continue;
      }
      // In-place metadata rewrites (legacy active-root migration) deliberately
      // save to the same file name. Deleting the source in that case would
      // delete the main chat immediately after saving it.
      if (shouldDeleteRewriteSource(step)) {
        const deleteResponse = await fetch('/api/chats/delete', {
          method: 'POST',
          headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
          body: JSON.stringify({ chatfile: `${step.fileName}.jsonl`, avatar_url: avatarUrl }),
        });
        if (!deleteResponse.ok) {
          throw new Error(`migration source delete failed for ${step.fileName}`);
        }
      }

      if (step.fileName === getCurrentChatId()) {
        if (rename) characters[this_chid].chat = targetFileName;
        // Keep the in-memory metadata in sync so ST's next save does not
        // write the old branch id back into the rewritten file.
        const inMemoryBranch = chat_metadata?.st_floor?.branch;
        if (inMemoryBranch) {
          inMemoryBranch.id = step.newId;
          if (step.newParent === null) {
            delete inMemoryBranch.parent;
          } else {
            inMemoryBranch.parent = step.newParent;
          }
        }
        saveCharacterDebounced();
      }
      result.completed += 1;
      console.log(`[Floor Anchor] migrated ${step.fileName} -> ${targetFileName} (${step.branchId} -> ${step.newId})`);
    } catch (error) {
      result.failed += 1;
      console.error(`[Floor Anchor] migration failed for ${step.fileName}:`, error);
    }
  }
  return result;
}
