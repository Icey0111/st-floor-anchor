import { createBranchMeta } from './metadata.js';

/**
 * Allowed reasons that trigger a pre-mutation snapshot.
 * 'rescue' is used when the user manually appends a character message floor
 * to salvage text that got stuck in the reasoning chain.
 */
export const SNAPSHOT_REASONS = ['roll', 'delete', 'edit', 'rescue'];

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
  };
}

/**
 * Resolve the undo-tree root file name for a snapshot meta by walking its
 * parent chain, used when the snapshot's `main_chat` is missing or points at
 * a file that no longer exists (legacy artifacts left by the flat-id -> tree
 * migration, which renamed files but did not rewrite nested `main_chat`).
 *
 * Rules, in order:
 *  1. The first snapshot on the chain whose `main_chat` still exists in the
 *     file list wins (it records the true tree root).
 *  2. Walking up reaches a snapshot whose parent meta is an ACTIVE root ->
 *     that root's file name is the tree root.
 *  3. Fallback: if the character has exactly one active root chat, assume the
 *     snapshot belongs to it (a snapshot can only be created from some chat).
 *
 * @param {Array} metas  all branch metas of the character (file_name is
 *                       authoritative from the chat list)
 * @param {object} meta  the snapshot meta to resolve the root for
 * @returns {string|null} resolved tree root file name
 */
export function resolveTreeRootByChain(metas, meta) {
  const fileNameOf = (m) => m?.branch?.file_name ?? m?.branch?.fileName ?? null;
  const metaByFileName = new Map();
  for (const m of metas) {
    const name = fileNameOf(m);
    if (name && !metaByFileName.has(name)) metaByFileName.set(name, m);
  }
  // A main_chat only counts when it points at an ACTIVE chat file.
  const validMainChatOf = (m) => {
    if (typeof m?.mainChat !== 'string' || m.mainChat.length === 0) return null;
    const target = metaByFileName.get(m.mainChat);
    return target?.branch.kind === 'active' ? m.mainChat : null;
  };
  const activeRoots = metas.filter((m) => m?.branch?.kind === 'active' && fileNameOf(m));

  let cursor = meta;
  const seen = new Set();
  while (cursor && cursor.branch.kind === 'snapshot') {
    const own = validMainChatOf(cursor);
    if (own) return own;

    const parentId = cursor.branch.parent;
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);

    // Branch ids are shared across chats (every tree has a br_000 root and
    // br_000-1, br_000-2, ... children), so a bare id lookup can land in the
    // WRONG chat's tree. Disambiguate in order of evidence strength.
    const candidates = metas.filter((m) => m.branch.id === parentId);
    if (candidates.length === 0) break;

    // 1) A single distinct valid main_chat among the candidates declares the
    //    tree (legacy artifacts whose own main_chat is stale still inherit
    //    the tree from a well-formed parent).
    const distinctValidMain = [...new Set(candidates.map(validMainChatOf).filter(Boolean))];
    if (distinctValidMain.length === 1) return distinctValidMain[0];

    // 2) File-name lineage: a snapshot file name is built from its parent's
    //    file name, so the parent's name prefixes the child's name.
    const currentFile = fileNameOf(cursor);
    const byPrefix = candidates.filter((m) => {
      const pf = fileNameOf(m);
      return !!pf && !!currentFile && currentFile.startsWith(`${pf} - `);
    });
    if (byPrefix.length === 1) {
      const parentMeta = byPrefix[0];
      if (parentMeta.branch.kind === 'active') return fileNameOf(parentMeta) ?? null;
      cursor = parentMeta;
      continue;
    }

    // 3) A single candidate is unambiguous - follow it.
    if (candidates.length === 1) {
      const parentMeta = candidates[0];
      if (parentMeta.branch.kind === 'active') return fileNameOf(parentMeta) ?? null;
      cursor = parentMeta;
      continue;
    }

    break; // ambiguous parent id across chats
  }
  // Fallback: with exactly one active root chat for this character, every
  // snapshot must belong to it.
  return activeRoots.length === 1 ? fileNameOf(activeRoots[0]) : null;
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

  // Fast path for well-formed snapshots: their recorded main_chat already
  // points at an active root. Only legacy/malformed snapshots need the
  // parent-chain walk, so typical large trees avoid repeated O(n) scans.
  const activeRootByFileName = new Map(
    list
      .filter((m) => m?.branch?.kind === 'active')
      .map((m) => [fileNameOf(m), m]),
  );
  const directRootOf = (meta) => {
    const mainChat = typeof meta?.mainChat === 'string' ? meta.mainChat : null;
    return mainChat && activeRootByFileName.has(mainChat) ? mainChat : null;
  };

  // The tree root file: the current chat itself when it is a root, otherwise
  // the `main_chat` recorded on the snapshot it belongs to. Legacy snapshots
  // may carry a missing or stale `main_chat` (pointing at a renamed-away
  // file); resolve the root by walking the parent chain in that case so the
  // panel never degrades into a rootless "branch tree".
  const currentRoot = currentMeta.branch.kind === 'active'
    ? (fileNameOf(currentMeta) ?? currentFile)
    : (directRootOf(currentMeta) ?? resolveTreeRootByChain(list, currentMeta));

  if (!currentRoot) return { metas: [], rootMeta: null, currentMeta };

  // Membership is decided by the RESOLVED root, not the raw `main_chat`:
  // legacy snapshots with a missing/stale main_chat must still join the tree
  // their parent chain resolves to.
  const resolvedRootOf = new Map();
  for (const meta of list) {
    if (meta?.branch?.kind === 'snapshot') {
      resolvedRootOf.set(meta, directRootOf(meta) ?? resolveTreeRootByChain(list, meta));
    }
  }
  const treeMetas = list.filter((meta) => {
    if (meta?.branch?.kind === 'active') {
      return fileNameOf(meta) === currentRoot;
    }
    return resolvedRootOf.get(meta) === currentRoot;
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
 * Plan the migration from the old flat 200-based ids to the recursive tree
 * scheme. The planner also accepts a mixed catalog left by an interrupted
 * migration (for example a br_000 root plus a remaining br_201 snapshot).
 * Existing recursive children reserve their ordinals, so a retry keeps the
 * same target ids instead of colliding with work completed by an earlier run.
 *
 * @returns {{steps: Array<{branchId, newId, fileName, newFileName, newParent}>, migrated: boolean}}
 */
export function planMigrateLegacyIds(metas) {
  const list = Array.isArray(metas) ? metas : [];
  const root = list.find((meta) => meta?.branch?.kind === 'active');
  const rootParsed = root ? parseBranchId(root.branch.id) : null;
  if (!rootParsed || rootParsed.segments.length > 0) {
    return { steps: [], migrated: false };
  }
  const rootIsLegacy = root.branch.id !== ROOT_BRANCH_ID;

  // Flat snapshots are legacy ids. Recursive ids already written by a prior
  // attempt are used to reserve their top-level ordinals.
  const snapshots = list
    .filter((meta) => meta?.branch?.kind === 'snapshot')
    .map((meta) => ({ meta, parsed: parseBranchId(meta?.branch?.id) }))
    .filter((x) => x.parsed && x.parsed.segments.length === 0 && x.meta.branch.id !== ROOT_BRANCH_ID)
    .sort((a, b) => Number(a.parsed.root) - Number(b.parsed.root));
  if (!rootIsLegacy && snapshots.length === 0) return { steps: [], migrated: false };

  const migratedSnapshots = list
    .filter((meta) => meta?.branch?.kind === 'snapshot')
    .map((meta) => ({ meta, parsed: parseBranchId(meta?.branch?.id) }))
    .filter((x) => x.parsed?.root === '000' && x.parsed.segments.length === 1);
  const occupied = new Set(migratedSnapshots.map((x) => x.parsed.segments[0]));

  // A failed source delete leaves both the legacy file and its rewritten
  // destination in the catalog. Match their file-name lineage so the retry
  // targets that same destination and can finish deleting the source.
  const migratedByLineage = new Map();
  for (const { meta } of migratedSnapshots) {
    const fileName = meta.branch.file_name;
    if (typeof fileName !== 'string') continue;
    const lineage = replaceBranchIdInFileName(fileName, '__branch__');
    if (!migratedByLineage.has(lineage)) migratedByLineage.set(lineage, meta.branch.id);
  }

  const idMap = new Map();
  if (rootIsLegacy) idMap.set(root.branch.id, ROOT_BRANCH_ID);
  const legacySnapshotIds = new Set(snapshots.map(({ meta }) => meta.branch.id));
  if (!rootIsLegacy) {
    for (const { meta } of snapshots) {
      const parent = meta.branch.parent;
      const parsedParent = parseBranchId(parent);
      if (parsedParent?.segments.length === 0 && !legacySnapshotIds.has(parent)) {
        idMap.set(parent, ROOT_BRANCH_ID);
      }
    }
  }
  let nextSeq = 1;
  for (const { meta } of snapshots) {
    const fileName = meta.branch.file_name;
    const lineage = typeof fileName === 'string'
      ? replaceBranchIdInFileName(fileName, '__branch__')
      : null;
    const existingId = lineage ? migratedByLineage.get(lineage) : null;
    if (existingId) {
      idMap.set(meta.branch.id, existingId);
      continue;
    }
    while (occupied.has(nextSeq)) nextSeq += 1;
    idMap.set(meta.branch.id, `${ROOT_BRANCH_ID}-${nextSeq}`);
    occupied.add(nextSeq);
    nextSeq += 1;
  }

  const steps = [];
  // Snapshot rewrites must precede the active-root rewrite. The executor can
  // then defer the root whenever any snapshot failed, leaving a retry marker
  // in the catalog instead of committing an unrecoverable half-migration.
  const ordered = [...list].sort((a, b) => Number(a?.branch?.kind === 'active') - Number(b?.branch?.kind === 'active'));
  for (const meta of ordered) {
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
      newParent: branch.parent
        ? (idMap.get(branch.parent) ?? (branch.parent === ROOT_BRANCH_ID ? ROOT_BRANCH_ID : branch.parent))
        : null,
      // The root chat file name carries no branch-id token: its metadata is
      // rewritten in place (rename: false) instead of renaming the file.
      rename: branch.kind !== 'active',
    });
  }

  return { steps, migrated: steps.length > 0 };
}
