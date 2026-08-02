/**
 * chat_metadata.st_floor serialization (schema v3).
 *
 * Per design doc dev_docs/03_data_model.md (v3):
 *   st_floor = { schema: 3, branch: { id, kind, parent?, source_floor?,
 *                reason, created_at?, file_name? } }
 *
 * kind: "active" | "snapshot"
 * reason: "root" | "roll" | "delete" | "edit" | "rescue"
 */

export const SCHEMA_VERSION = 3;

export function createBranchMeta({
  id,
  kind = 'active',
  parent = null,
  sourceFloor = null,
  reason = 'root',
  createdAt = null,
  fileName = null,
}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('branch id must be a non-empty string');
  }
  if (kind !== 'active' && kind !== 'snapshot') {
    throw new TypeError(`invalid branch kind: ${kind}`);
  }

  const branch = { id, kind, reason };
  if (parent !== null) branch.parent = parent;
  if (sourceFloor !== null) branch.source_floor = sourceFloor;
  if (createdAt !== null) branch.created_at = createdAt;
  if (fileName !== null) branch.file_name = fileName;

  return { schema: SCHEMA_VERSION, branch };
}

/**
 * Read the normalized branch meta from a chat_metadata object.
 * Returns null when st_floor is absent or malformed (plain ST chat).
 */
export function readBranchMeta(chatMetadata) {
  if (!chatMetadata || typeof chatMetadata !== 'object') return null;
  const st = chatMetadata.st_floor;
  if (!st || typeof st !== 'object' || !st.branch || typeof st.branch !== 'object') {
    return null;
  }
  const b = st.branch;
  if (typeof b.id !== 'string' || b.id.length === 0) return null;

  return {
    schema: Number.isInteger(st.schema) ? st.schema : null,
    branch: {
      id: b.id,
      kind: b.kind === 'snapshot' ? 'snapshot' : 'active',
      parent: typeof b.parent === 'string' ? b.parent : null,
      sourceFloor: Number.isInteger(b.source_floor) ? b.source_floor : null,
      reason: typeof b.reason === 'string' ? b.reason : 'root',
      createdAt: typeof b.created_at === 'string' ? b.created_at : null,
      fileName: typeof b.file_name === 'string' ? b.file_name : null,
    },
  };
}

/** Return a new chat_metadata object with st_floor set to the given meta. */
export function writeBranchMeta(chatMetadata, meta) {
  const base = chatMetadata && typeof chatMetadata === 'object' ? chatMetadata : {};
  return { ...base, st_floor: meta };
}

/** True when the branch meta is structurally valid (schema check is lenient). */
export function isValidBranchMeta(meta) {
  const parsed = readBranchMeta({ st_floor: meta });
  if (!parsed) return false;
  return parsed.branch.id.length > 0;
}
