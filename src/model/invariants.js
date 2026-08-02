import { readBranchMeta } from './metadata.js';

/**
 * Data-layer invariant checks (dev_docs/03_data_model.md v3, B1-B9).
 * B3/B4/B5/B9 are store/UX guarantees and are not verifiable from pure data;
 * the checkable subset is implemented here.
 */
export function checkInvariants(index) {
  const violations = [];

  for (const node of index.nodes.values()) {
    // B1: unique ids are enforced by PanelIndex.add (throws on duplicates).
    // B2: parent must exist or be null.
    if (node.parent && !index.nodes.has(node.parent)) {
      violations.push(`B2: ${node.id} references missing parent ${node.parent}`);
    }

    // B7: parent/child consistency - each node must appear in its parent's children.
    if (node.parent && index.nodes.has(node.parent)) {
      const parent = index.nodes.get(node.parent);
      if (!parent.children.includes(node.id)) {
        violations.push(`B7: ${node.parent} does not list child ${node.id}`);
      }
    }

    // B8: non-root branches carry source_floor.
    if (node.parent && node.sourceFloor === null) {
      violations.push(`B8: ${node.id} has no source_floor`);
    }
  }

  // B6: serialization round-trip preserves ids (structural check on the index).
  const roundTripped = index.toJSON().nodes.map((n) => n.id).sort();
  const original = [...index.nodes.keys()].sort();
  if (JSON.stringify(roundTripped) !== JSON.stringify(original)) {
    violations.push('B6: serialization round-trip changed branch ids');
  }

  return violations;
}

/** Meta-level validation for a single file (used during import). */
export function validateBranchMeta(meta) {
  if (!readBranchMeta({ st_floor: meta })) {
    return ['invalid st_floor meta'];
  }
  return [];
}
