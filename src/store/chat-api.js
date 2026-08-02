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
  saveCharacterDebounced,
} from '/script.js';
import { selected_group } from '/scripts/group-chats.js';
import { saveMetadataDebounced } from '/scripts/extensions.js';
import { getStFloorSettings } from '../settings.js';

import { createBranchMeta, readBranchMeta } from '../model/metadata.js';
import { PanelIndex } from '../model/panel-index.js';
import {
  ROOT_BRANCH_ID,
  createBranchIdCounter,
  getParentId,
  planMigrateLegacyIds,
  planRenumberAfterDelete,
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
      const meta = metaFromChatJson(chatJson);
      if (meta) {
        // The file list is authoritative: the name inside chat_metadata may be
        // stale after a rename (e.g. the [FA] marker migration below).
        meta.branch.file_name = name;
        // Derived display data (last message body preview) - never persisted.
        meta.preview = computeChatPreview(chatJson, settings.previewMaxLength, { filterBlocks: settings.filterBlocks });
      }
      if (meta) metas.push(meta);
    } catch {
      // skip unreadable files (e.g. temporary chats)
    }
  }
  return { names, metas };
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

  await saveChat({
    chatName: fileName,
    withMetadata: { main_chat: mainChatName, st_floor: meta },
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

/** Scan all chat files of the current character and rebuild the PanelIndex. */
export async function scanBranches() {
  const avatarUrl = getCurrentAvatarUrl();
  if (!avatarUrl) return new PanelIndex();

  let { names, metas } = await fetchAllBranchMetas(avatarUrl);

  // One-time migration from the old flat 200-based ids to the recursive tree
  // scheme (br_200 -> br_000, br_201 -> br_000-1, ...). Files are re-saved
  // under new names with rewritten metadata; the scan then re-reads the
  // migrated state so the panel and id counters see the new ids.
  const legacyMigration = planMigrateLegacyIds(metas);
  if (legacyMigration.migrated) {
    console.log(`[Floor Anchor] migrating ${legacyMigration.steps.length} legacy branch id(s) to recursive scheme`);
    await applyRenumberSteps(legacyMigration.steps, avatarUrl);
    ({ names, metas } = await fetchAllBranchMetas(avatarUrl));
  }

  // Migrate legacy snapshots (created before the [FA] marker existed) so the
  // client-side list filter can recognise them by name. The file list is
  // authoritative, so a rename is never re-attempted on the next scan. The
  // currently open chat is skipped: renaming it races with ST's own saves
  // (which would recreate the old name); the list filter hides it by id until
  // the user leaves it and a later scan migrates the file safely.
  const metaByFileName = new Map(
    metas.filter((m) => m.branch.file_name).map((m) => [m.branch.file_name, m]),
  );
  for (const meta of metas) {
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

  // Defensive dedupe: two chat files can carry the same branch id (e.g. a
  // stale save recreated an old snapshot name after a rename). Keep the
  // marker-named file when possible so the panel never crashes on duplicates.
  const seenBranchIds = new Set();
  const uniqueMetas = [];
  for (const meta of metas) {
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

  const index = PanelIndex.build(uniqueMetas);
  for (const meta of uniqueMetas) branchIds.track(meta.branch.id);
  if (!index.nodes.size) {
    // plain ST chats without st_floor: expose them as unmanaged roots
    for (const name of names) {
      index.add({ schema: 3, branch: { id: `orphan_${name}`, kind: 'active', parent: null, reason: 'root', file_name: name } });
    }
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
  if (!avatarUrl) return { steps: [], maxSeq: 0, touched: false };

  const { metas } = await fetchAllBranchMetas(avatarUrl);
  const plan = planRenumberAfterDelete(metas, deletedBranchId, deletedParentId);
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
