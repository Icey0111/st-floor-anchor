/**
 * Return true only when a rewritten chat was saved under a distinct new name
 * and the old source file may therefore be removed.
 *
 * Active-root legacy migration uses rename:false and rewrites metadata in
 * place; deleting its source would delete the live main chat.
 */
export function shouldDeleteRewriteSource(step) {
  if (!step || step.rename === false) return false;
  if (typeof step.fileName !== 'string' || typeof step.newFileName !== 'string') return false;
  return step.fileName.length > 0 && step.newFileName.length > 0 && step.fileName !== step.newFileName;
}

/** Pruning a non-leaf would orphan its descendants unless they are rewritten. */
export function canPruneSnapshot(node, hasChildren) {
  return node?.kind === 'snapshot' && hasChildren !== true;
}
