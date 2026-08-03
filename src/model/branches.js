import { createBranchMeta } from './metadata.js';

/** Allowed reasons that trigger a pre-mutation snapshot. */
export const SNAPSHOT_REASONS = ['roll', 'delete', 'edit'];

/** The root branch id (start of the recursive tree numbering). */
export const ROOT_BRANCH_ID = 'br_000';

/**
 * Meta for a plain ST chat that has no st_floor metadata yet (unmanaged).
 * The panel displays it with the unified root id br_000; the chat is adopted
 * as a real br_000 root on the next snapshot trigger / metadata save.
 * The file name is preserved so a rollback switch still targets the chat.
 *
 * @param {string} fileName   chat file name (without .jsonl)
 * @param {string} [preview]  derived body preview (display-only)
 * @returns {{schema: number, branch: object}}
 */
export function createOrphanRootMeta(fileName, preview = null) {
  const meta = {
    schema: 3,
    branch: {
      id: ROOT_BRANCH_ID,
      kind: 'active',
      parent: null,
      reason: 'root',
      file_name: String(fileName ?? ''),
    },
  };
  if (typeof preview === 'string' && preview.length > 0) {
    meta.preview = preview;
  }
  return meta;
}

/** Matches branch ids of the recursive scheme: br_000, br_000-1, br_000-1-2 ... */
const BRANCH_ID_RE = /^br_(\d+)((?:-\d+)*)$/;

/**
 * Parse a branch id into { root, segments }.
 * 'br_000'      -> { root: 0, segments: [] }
 * 'br_000-1-2'  -> { root: 0, segments: [1, 2] }
 * Returns null for anything else (e.g. orphan_xxx).
 */
export function parseBranchId(id) {
  const match = BRANCH_ID_RE.exec(String(id ?? ''));
  if (!match) return null;
  const segments = match[2] ? match[2].slice(1).split('-').map(Number) : [];
  return { root: match[1], segments }; // root keeps its original zero-padding ('000')
}

/** Parent id of a branch id ('br_000-1-2' -> 'br_000-1'; root -> null). */
export function getParentId(id) {
  const parsed = parseBranchId(id);
  if (!parsed) return null;
  if (parsed.segments.length === 0) return null;
  return `br_${parsed.root}${parsed.segments.slice(0, -1).map((s) => `-${s}`).join('')}`;
}

/** Last ordinal segment of a branch id (null for the root). */
export function getLastSegment(id) {
  const parsed = parseBranchId(id);
  if (!parsed || parsed.segments.length === 0) return null;
  return parsed.segments[parsed.segments.length - 1];
}

/**
 * Replace the trailing branch-id token in a snapshot file name.
 * Handles both naming styles:
 *   '... br_000-1'      -> '... <newId>'
 *   '... br_000-1 [FA]' -> '... <newId> [FA]'
 */
export function replaceBranchIdInFileName(fileName, newId) {
  return String(fileName ?? '').replace(/(\s)(br_\S+?)(\s*\[FA\])?$/, (match, prefix, _id, suffix) => `${prefix}${newId}${suffix ?? ''}`);
}

/**
 * Per-parent branch-id counter. Each parent counts its own children
 * (1,2,3...), so ids form a tree: br_000 -> br_000-1 -> br_000-1-1.
 */
export function createBranchIdCounter() {
  const maxSeqByParent = new Map();
  return {
    /** Clear all observed maxima (used when the scan switches chat trees). */
    reset() {
      maxSeqByParent.clear();
    },
    /** Observe an existing id so the next child continues from it. */
    track(id) {
      const parent = getParentId(id);
      const seq = getLastSegment(id);
      if (parent && seq !== null) {
        maxSeqByParent.set(parent, Math.max(maxSeqByParent.get(parent) ?? 0, seq));
      }
    },
    /** Next child id under the given parent (root children use 'br_000'). */
    next(parentId) {
      const key = parentId ?? '__root__';
      const seq = (maxSeqByParent.get(key) ?? 0) + 1;
      maxSeqByParent.set(key, seq);
      return `${parentId}-${seq}`;
    },
    /** Force the observed max for a parent (after renumbering compacts ids). */
    resetParent(parentId, maxSeq) {
      maxSeqByParent.set(parentId ?? '__root__', Math.max(0, Number(maxSeq) || 0));
    },
  };
}

/**
 * Per-chat isolation: reduce a character's full branch-meta list to the undo
 * tree the currently open chat belongs to. Every ST chat owns its own tree;
 * all chats share the root id `br_000`, so membership is carried explicitly:
 * root metas match by file name, and snapshot metas carry `mainChat` (the
 * tree root's file name, written at snapshot creation and inherited by
 * recursive branches).
 *
 * @param {Array} metas  raw st_floor metas (branch.fileName populated by the
 *                       scan; snapshot metas may carry `mainChat`)
 * @param {string|null} currentFileName  chat file name currently open
 * @returns {{metas: Array, rootMeta: object|null, currentMeta: object|null}}
 */
export function filterMetasToCurrentTree(metas, currentFileName) {
  const list = Array.isArray(metas) ? metas : [];
  const currentFile = String(currentFileName ?? '');
  if (!currentFile) return { metas: [], rootMeta: null, currentMeta: null };

  const fileNameOf = (meta) => meta?.branch?.file_name ?? meta?.branch?.fileName ?? null;
  const currentMeta = list.find((m) => fileNameOf(m) === currentFile) ?? null;
  if (!currentMeta) return { metas: [], rootMeta: null, currentMeta: null };

  // The tree root file: the current chat itself when it is a root, otherwise
  // the `main_chat` recorded on the snapshot it belongs to.
  const currentRoot = currentMeta.branch.kind === 'active'
    ? (fileNameOf(currentMeta) ?? currentFile)
    : (typeof currentMeta.mainChat === 'string' ? currentMeta.mainChat : null);

  if (!currentRoot) return { metas: [], rootMeta: null, currentMeta };

  const treeMetas = list.filter((meta) => {
    if (meta?.branch?.kind === 'active') {
      return fileNameOf(meta) === currentRoot;
    }
    return typeof meta?.mainChat === 'string' && meta.mainChat === currentRoot;
  });
  const rootMeta = treeMetas.find((m) => m?.branch?.kind === 'active') ?? null;
  return { metas: treeMetas, rootMeta, currentMeta };
}

/** Simple monotonically-increasing branch id factory. */
export function createBranchIdFactory(prefix = 'br', start = 200) {
  let n = start;
  return () => `${prefix}_${n++}`;
}

/**
 * Pure data-layer snapshot plan. The store layer (M2) executes it by copying
 * the current chat file and writing the meta into the copy; the extension
 * never switches chats as part of the plan (B4).
 *
 * @returns {{
 *   operation: 'snapshot',
 *   branchId: string,
 *   kind: 'snapshot',
 *   parent: string,
 *   sourceFloor: number|null,
 *   reason: string,
 *   createdAt: string,
 *   copyFrom: string|null,
 *   meta: object
 * }}
 */
export function buildSnapshotPlan({
  currentBranchId,
  currentFileName = null,
  sourceFloor = null,
  reason,
  nextBranchId,
  now = new Date().toISOString(),
}) {
  if (typeof currentBranchId !== 'string' || currentBranchId.length === 0) {
    throw new TypeError('currentBranchId must be a non-empty string');
  }
  if (!SNAPSHOT_REASONS.includes(reason)) {
    throw new TypeError(`snapshot reason must be one of: ${SNAPSHOT_REASONS.join(', ')}`);
  }
  if (typeof nextBranchId !== 'string' || nextBranchId.length === 0) {
    throw new TypeError('nextBranchId must be a non-empty string');
  }

  return {
    operation: 'snapshot',
    branchId: nextBranchId,
    kind: 'snapshot',
    parent: currentBranchId,
    sourceFloor,
    reason,
    createdAt: now,
    copyFrom: currentFileName,
    meta: createBranchMeta({
      id: nextBranchId,
      kind: 'snapshot',
      parent: currentBranchId,
      sourceFloor,
      reason,
      createdAt: now,
    }),
  };
}

/**
 * Plan how to compact branch ids after a snapshot is pruned (recursive tree
 * numbering). The deleted node's parent bucket is re-numbered sequentially:
 * siblings of the deleted node plus any children of the deleted node
 * (re-parented to the deleted node's own parent). Descendants of every
 * renumbered node get their path prefix updated recursively.
 *
 * Example: br_000 (root), br_000-1, br_000-2, br_000-2-1; delete br_000-1
 *   -> br_000-2 becomes br_000-1, br_000-2-1 becomes br_000-1-1.
 *
 * @param {Array} metas  raw st_floor metas (branch.id / branch.kind /
 *                       branch.parent / branch.file_name)
 * @param {string} deletedBranchId  the pruned branch id (e.g. 'br_000-1')
 * @param {string|null} deletedParentId  parent of the pruned branch
 * @returns {{steps: Array<{branchId, newId, fileName, newFileName, newParent}>, maxSeq: number}}
 */
export function planRenumberAfterDelete(metas, deletedBranchId, deletedParentId = null) {
  const deletedParent = deletedParentId ?? getParentId(deletedBranchId);
  const valid = !!parseBranchId(deletedBranchId) && !!deletedParent;
  if (!valid) {
    return { steps: [], maxSeq: 0, touched: false };
  }

  // Nodes that end up in the deleted node's parent bucket: its siblings
  // (excluding itself) and its children (adopted by the parent).
  const affected = (metas ?? [])
    .filter((meta) => meta?.branch?.kind === 'snapshot' && meta.branch.id !== deletedBranchId)
    .filter((meta) => {
      const parent = getParentId(meta.branch.id);
      return parent === deletedParent || parent === deletedBranchId;
    })
    .sort((a, b) => (getLastSegment(a.branch.id) ?? 0) - (getLastSegment(b.branch.id) ?? 0));

  const idMap = new Map(); // old id -> new id
  let seq = 0;
  for (const { branch } of affected) {
    seq += 1;
    idMap.set(branch.id, `${deletedParent}-${seq}`);
  }

  // Longest mapped ancestor first, so a descendant matches its closest
  // renumbered ancestor.
  const mappedEntries = [...idMap.entries()].sort((a, b) => b[0].length - a[0].length);
  const steps = [];

  for (const meta of metas ?? []) {
    const branch = meta?.branch;
    if (!branch || branch.kind !== 'snapshot' || branch.id === deletedBranchId) continue;

    let mapped = null;
    for (const [oldId, newId] of mappedEntries) {
      if (branch.id === oldId || branch.id.startsWith(`${oldId}-`)) {
        mapped = { oldId, newId };
        break;
      }
    }
    if (!mapped) continue;

    const newId = branch.id === mapped.oldId
      ? mapped.newId
      : `${mapped.newId}${branch.id.slice(mapped.oldId.length)}`;
    const fileName = typeof branch.file_name === 'string' ? branch.file_name : null;
    if (newId !== branch.id) {
      steps.push({
        branchId: branch.id,
        newId,
        fileName,
        newFileName: fileName ? replaceBranchIdInFileName(fileName, newId) : null,
        // The new id encodes the path, so its parent is deterministic.
        newParent: getParentId(newId),
      });
    }
  }

  return { steps, maxSeq: seq, touched: true };
}

/**
 * Plan the one-time migration from the old flat 200-based ids to the
 * recursive tree scheme: root br_200 -> br_000, snapshots br_201..br_N ->
 * br_000-1..br_000-(N-200) (in ascending id order, closing gaps).
 *
 * @returns {{steps: Array<{branchId, newId, fileName, newFileName, newParent}>, migrated: boolean}}
 */
export function planMigrateLegacyIds(metas) {
  const root = (metas ?? []).find((meta) => meta?.branch?.kind === 'active');
  const rootParsed = root ? parseBranchId(root.branch.id) : null;
  if (!rootParsed || rootParsed.segments.length > 0 || root.branch.id === ROOT_BRANCH_ID) {
    return { steps: [], migrated: false };
  }
  const rootN = rootParsed.root;

  // Flat snapshots (single numeric segment) in ascending order.
  const snapshots = (metas ?? [])
    .filter((meta) => meta?.branch?.kind === 'snapshot')
    .map((meta) => ({ meta, parsed: parseBranchId(meta?.branch?.id) }))
    .filter((x) => x.parsed && x.parsed.segments.length === 0) // legacy flat ids
    .sort((a, b) => Number(a.parsed.root) - Number(b.parsed.root));

  const idMap = new Map([[root.branch.id, ROOT_BRANCH_ID]]);
  let seq = 0;
  for (const { meta, parsed } of snapshots) {
    seq += 1;
    idMap.set(meta.branch.id, `${ROOT_BRANCH_ID}-${seq}`);
  }

  const steps = [];
  for (const meta of metas ?? []) {
    const branch = meta?.branch;
    if (!branch || typeof branch.id !== 'string') continue;
    const newId = idMap.get(branch.id);
    if (!newId || newId === branch.id) continue;
    const fileName = typeof branch.file_name === 'string' ? branch.file_name : null;
    steps.push({
      branchId: branch.id,
      newId,
      fileName,
      newFileName: fileName ? replaceBranchIdInFileName(fileName, newId) : null,
      newParent: branch.parent ? (idMap.get(branch.parent) ?? branch.parent) : null,
      // The root chat file name carries no branch-id token: its metadata is
      // rewritten in place (rename: false) instead of renaming the file.
      rename: branch.kind !== 'active',
    });
  }

  return { steps, migrated: steps.length > 0 };
}
