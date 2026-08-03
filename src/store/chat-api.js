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
} from '/script.js';
import { selected_group } from '/scripts/group-chats.js';
import { saveMetadataDebounced } from '/scripts/extensions.js';
import { getStFloorSettings } from '../settings.js';

import { createBranchMeta, readBranchMeta } from '../model/metadata.js';
import { PanelIndex } from '../model/panel-index.js';
import {
  ROOT_BRANCH_ID,
  createOrphanRootMeta,
  createBranchIdCounter,
  filterMetasToCurrentTree,
  getParentId,
  planMigrateLegacyIds,
  planRenumberAfterDelete,
  resolveTreeRootByChain,
} from '../model/branches.js';
import {
  buildSnapshotName,
  parseChatList,
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

function getCurrentAvatarUrl() {
  return characters?.[this_chid]?.avatar ?? '';
}

function getMainChatName() {
  return getCurrentChatDetails()?.sessionName ?? characters?.[this_chid]?.chat ?? 'chat';
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
    if (!getResponse.ok) return;
    const chatJson = await getResponse.json();
    if (!Array.isArray(chatJson) || !chatJson[0]?.chat_metadata) return;
    if (chatJson[0].chat_metadata.main_chat === mainChat) return;
    chatJson[0].chat_metadata.main_chat = mainChat;
    await fetch('/api/chats/save', {
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
  } catch (error) {
    console.error(`[Floor Anchor] main_chat repair failed for ${fileName}:`, error);
  }
}

/**
 * Raw scan: list chat files of the current character and read each header's
 * st_floor meta (authoritative file_name + derived preview). No migration or
 * dedupe happens here - callers apply their own rules.
 */
async function fetchAllBranchMetas(avatarUrl) {
  const listResponse = await fetch('/api/characters/chats', {
    method: 'POST',
    headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
    body: JSON.stringify({ avatar_url: avatarUrl, simple: true }),
  });
  if (!listResponse.ok) return { names: [], metas: [] };

  const names = parseChatList(await listResponse.json());
  const metas = [];
  const previews = new Map(); // file name -> derived preview, incl. plain chats
  const settings = getStFloorSettings();

  for (const name of names) {
    try {
      const getResponse = await fetch('/api/chats/get', {
        method: 'POST',
        headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
        body: JSON.stringify({ ch_name: characters?.[this_chid]?.name ?? '', file_name: name, avatar_url: avatarUrl }),
        cache: 'no-cache',
      });
      if (!getResponse.ok) continue;
      const chatJson = await getResponse.json();
      // Derived display data (last message body preview) - never persisted.
      // Computed for every file so plain chats (no st_floor meta) can still
      // show a preview when the panel renders them as an unmanaged br_000.
      const preview = computeChatPreview(chatJson, settings.previewMaxLength, { filterBlocks: settings.filterBlocks });
      const meta = metaFromChatJson(chatJson);
      if (meta) {
        // The file list is authoritative: the name inside chat_metadata may be
        // stale after a rename (e.g. the [FA] marker migration below).
        meta.branch.file_name = name;
        meta.preview = preview;
      }
      if (meta) {
        metas.push(meta);
      } else {
        previews.set(name, preview);
      }
    } catch {
      // skip unreadable files (e.g. temporary chats)
    }
  }
  return { names, metas, previews };
}

/**
 * If the current chat has no st_floor metadata yet, adopt it as the root
 * branch (schema v3, kind=active, reason=root).
 */
export function adoptRootIfNeeded() {
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
  saveMetadataDebounced();
  const saved = readBranchMeta(chat_metadata);
  branchIds.track(saved.branch.id);
  return saved;
}

/**
 * Snapshot the current chat BEFORE a mutation.
 *
 * @param {object} opts
 * @param {string} opts.reason  'roll' | 'delete' | 'edit'
 * @param {number|null} opts.sourceFloor  1-based floor of the mutation
 * @param {Array} [opts.capturedChat]     synchronous pre-mutation clone of `chat`
 */
export async function createSnapshot({ reason, sourceFloor = null, capturedChat = null }) {
  if (selected_group) {
    console.warn('[Floor Anchor] group chats are not supported yet (M5)');
    return null;
  }
  if (!Array.isArray(chat) || chat.length === 0) {
    return null;
  }

  const chatData = capturedChat ?? structuredClone(chat);
  const parent = adoptRootIfNeeded();
  branchIds.track(parent.branch.id);

  // Content-level dedupe: if this branch's last snapshot has identical chat
  // content (e.g. a roll clicked while the API is disconnected), skip.
  const fingerprint = computeChatFingerprint(chatData);
  // Dedupe is per (branch, reason): a failed roll must not create a snapshot,
  // but a delete/edit is a distinct intent even if the content happens to
  // match an earlier roll snapshot.
  const fingerprintKey = `${parent.branch.id}:${reason}`;
  if (fingerprints.get(fingerprintKey) === fingerprint) {
    return { skipped: true, reason: 'identical-content' };
  }

  const branchId = branchIds.next(parent.branch.id);
  const mainChatName = getMainChatName();
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
  // Every snapshot records its undo-tree root (the main chat file), so the
  // panel can isolate trees per chat even though all roots share id br_000.
  // Recursive branches inherit the root from the snapshot they branch off.
  const treeRoot = parent.branch.kind === 'active'
    ? (parent.branch.fileName ?? mainChatName)
    : (typeof chat_metadata?.main_chat === 'string' ? chat_metadata.main_chat : mainChatName);

  await saveChat({
    chatName: fileName,
    withMetadata: { main_chat: treeRoot, st_floor: meta },
    chatData,
    force: true, // brand-new file; avoid the integrity-check popup
  });

  fingerprints.set(fingerprintKey, fingerprint);

  return { branchId, fileName, meta };
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
export async function appendCharacterMessage(text) {
  const content = typeof text === 'string' ? text.trim() : '';
  if (!content) {
    throw new TypeError('message text must be a non-empty string');
  }
  if (selected_group) {
    console.warn('[Floor Anchor] group chats are not supported yet (M5)');
    return null;
  }

  // Snapshot BEFORE the mutation so the panel can roll the append back.
  await createSnapshot({ reason: 'rescue' });

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
  // save loop, which would drop the appended floor. force bypasses the
  // integrity-check popup. Bound the wait so a lost response can never trap
  // the composer; the message stays in `chat` and ST's save loop persists it.
  await Promise.race([
    saveChat({ force: true }),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
  return message;
}

/** Scan all chat files of the current character and rebuild the PanelIndex. */
export async function scanBranches() {
  const avatarUrl = getCurrentAvatarUrl();
  if (!avatarUrl) return new PanelIndex();
  const currentFileName = getCurrentChatId() ?? null;

  let { names, metas, previews } = await fetchAllBranchMetas(avatarUrl);

  // Per-chat isolation: every ST chat owns its own undo tree; the panel shows
  // only the tree the currently open chat belongs to (all chats share the
  // root id br_000, so membership is carried by main_chat).
  let tree = filterMetasToCurrentTree(metas, currentFileName);
  let treeMetas = tree.metas;
  const currentMeta = tree.currentMeta;

  // One-time migration from the old flat 200-based ids to the recursive tree
  // scheme (br_200 -> br_000, br_201 -> br_000-1, ...). Files are re-saved
  // under new names with rewritten metadata; the scan then re-reads the
  // migrated state so the panel and id counters see the new ids.
  const legacyMigration = planMigrateLegacyIds(treeMetas);
  if (legacyMigration.migrated) {
    console.log(`[Floor Anchor] migrating ${legacyMigration.steps.length} legacy branch id(s) to recursive scheme`);
    await applyRenumberSteps(legacyMigration.steps, avatarUrl);
    ({ names, metas, previews } = await fetchAllBranchMetas(avatarUrl));
    tree = filterMetasToCurrentTree(metas, currentFileName);
    treeMetas = tree.metas;
  }

  // Migrate legacy snapshots (created before the [FA] marker existed) so the
  // client-side list filter can recognise them by name. The file list is
  // authoritative, so a rename is never re-attempted on the next scan. The
  // currently open chat is skipped: renaming it races with ST's own saves
  // (which would recreate the old name); the list filter hides it by id until
  // the user leaves it and a later scan migrates the file safely.
  const metaByFileName = new Map(
    treeMetas.filter((m) => m.branch.file_name).map((m) => [m.branch.file_name, m]),
  );
  for (const meta of treeMetas) {
    const fileName = meta.branch.file_name;
    if (
      meta.branch.kind === 'snapshot'
      && fileName
      && fileName !== getCurrentChatId()
      && !isSnapshotFileName(fileName)
    ) {
      const renamed = sanitizeFileName(`${fileName} ${SNAPSHOT_FILE_MARKER}`);
      if (renamed !== fileName) {
        const destination = metaByFileName.get(renamed);
        if (destination) {
          // The marker-named file already exists. When it belongs to the same
          // branch (a stale save recreated the old name after an earlier
          // rename), the unmarked source is a redundant duplicate: drop it and
          // point the branch at the existing file. Never touch a destination
          // that is a normal chat or a different branch.
          if (destination.branch.kind === 'snapshot' && destination.branch.id === meta.branch.id) {
            await fetch('/api/chats/delete', {
              method: 'POST',
              headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
              body: JSON.stringify({ chatfile: `${fileName}.jsonl`, avatar_url: avatarUrl }),
            });
            meta.branch.file_name = renamed;
            console.log(`[Floor Anchor] removed duplicate legacy snapshot ${fileName} (kept ${renamed})`);
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
          meta.branch.file_name = renamed;
          console.log(`[Floor Anchor] migrated legacy snapshot name: ${fileName} -> ${renamed}`);
        }
      }
    }
  }

  // Self-heal stale `main_chat` references (legacy migration artifacts: the
  // flat-id -> tree migration renamed files but did not rewrite nested
  // `main_chat`). Resolve the true tree root through the parent chain and
  // persist the correction so the panel never degrades into a rootless
  // "branch tree". The currently open chat is skipped - rewriting it races
  // ST's own saves; the in-memory resolution keeps the panel correct and a
  // later scan repairs the file once the user leaves it.
  for (const meta of metas) {
    const branch = meta?.branch;
    if (!branch || branch.kind !== 'snapshot') continue;
    const resolved = resolveTreeRootByChain(metas, meta);
    if (!resolved || resolved === meta.mainChat) continue; // already valid
    meta.mainChat = resolved;
    if (branch.file_name && branch.file_name !== currentFileName) {
      await persistMainChat(avatarUrl, branch.file_name, resolved);
      console.log(`[Floor Anchor] repaired main_chat for ${branch.file_name} -> ${resolved}`);
    }
  }

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
    index.add(createOrphanRootMeta(currentFileName, previews.get(currentFileName) ?? null));
  }
  return index;
}

/** Delete a snapshot/branch file from the panel (prune). */
export async function deleteSnapshotFile(fileName) {
  const avatarUrl = getCurrentAvatarUrl();
  if (!avatarUrl || !fileName) return false;
  const response = await fetch('/api/chats/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ chatfile: `${fileName}.jsonl`, avatar_url: avatarUrl }),
  });
  return response.ok;
}

/**
 * After a snapshot is pruned, compact the remaining branch ids so there are
 * no gaps within the deleted branch's parent bucket (recursive tree ids).
 * Each affected file is re-saved under its new name with rewritten st_floor
 * metadata (id + parent), then the old file is deleted.
 */
export async function renumberSnapshotsAfterPrune({ deletedBranchId, deletedParentId = null } = {}) {
  if (selected_group) return { steps: [], maxSeq: 0, touched: false };
  const avatarUrl = getCurrentAvatarUrl();
  const currentFileName = getCurrentChatId() ?? null;
  if (!avatarUrl || !currentFileName) return { steps: [], maxSeq: 0, touched: false };

  const { metas } = await fetchAllBranchMetas(avatarUrl);
  const tree = filterMetasToCurrentTree(metas, currentFileName);
  const plan = planRenumberAfterDelete(tree.metas, deletedBranchId, deletedParentId);
  await applyRenumberSteps(plan.steps, avatarUrl);

  const parent = deletedParentId ?? getParentId(deletedBranchId);
  if (parent && plan.touched) branchIds.resetParent(parent, plan.maxSeq);
  return plan;
}

/**
 * Shared executor for renumbering/migration steps: read each file, rewrite
 * its st_floor id/parent, save under the new name (force), delete the old
 * file, and keep the character chat field in sync when the renamed file is
 * the currently open chat. Never saves and deletes the same name (guard).
 */
async function applyRenumberSteps(steps, avatarUrl) {
  for (const step of steps) {
    const rename = step.rename !== false;
    if (!step.fileName || !step.newFileName || (rename && step.newFileName === step.fileName)) {
      console.warn(`[Floor Anchor] renumber skip: no safe name change for ${step.fileName ?? '(unknown)'}`);
      continue;
    }
    try {
      const getResponse = await fetch('/api/chats/get', {
        method: 'POST',
        headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
        body: JSON.stringify({ ch_name: characters?.[this_chid]?.name ?? '', file_name: step.fileName, avatar_url: avatarUrl }),
        cache: 'no-cache',
      });
      if (!getResponse.ok) continue;
      const chatJson = await getResponse.json();
      const branch = chatJson?.[0]?.chat_metadata?.st_floor?.branch;
      if (!branch) continue;

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
          file_name: step.newFileName,
          chat: chatJson,
          avatar_url: avatarUrl,
          force: true,
        }),
      });
      if (!saveResponse.ok) {
        console.error(`[Floor Anchor] renumber save failed for ${step.fileName}`);
        continue;
      }
      await fetch('/api/chats/delete', {
        method: 'POST',
        headers: { ...getRequestHeaders(), ...INTERNAL_HEADER },
        body: JSON.stringify({ chatfile: `${step.fileName}.jsonl`, avatar_url: avatarUrl }),
      });

      if (step.fileName === getCurrentChatId()) {
        if (rename) characters[this_chid].chat = step.newFileName;
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
      console.log(`[Floor Anchor] renumbered ${step.fileName} -> ${step.newFileName} (${step.branchId} -> ${step.newId})`);
    } catch (error) {
      console.error(`[Floor Anchor] renumber failed for ${step.fileName}:`, error);
    }
  }
}
