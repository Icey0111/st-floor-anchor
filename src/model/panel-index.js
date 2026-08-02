import { readBranchMeta } from './metadata.js';

/**
 * Derived branch tree (PanelIndex). Aggregates branch/snapshot metadata from
 * chat files; rebuildable at any time (B7). Storage-agnostic: it works on
 * normalized branch metas, not on chat files.
 */
export class PanelIndex {
  constructor() {
    /** @type {Map<string, object>} branch id -> node */
    this.nodes = new Map();
    this.rootIds = [];
    this.activeId = null;
    this.orphans = [];
  }

  /** Add one branch meta; links it into the tree. Returns the node. */
  add(meta) {
    const parsed = readBranchMeta({ st_floor: meta });
    if (!parsed) throw new TypeError('invalid branch meta');
    const b = parsed.branch;

    if (this.nodes.has(b.id)) {
      throw new Error(`duplicate branch id: ${b.id}`);
    }

    const node = {
      id: b.id,
      kind: b.kind,
      parent: b.parent,
      sourceFloor: b.sourceFloor,
      reason: b.reason,
      createdAt: b.createdAt,
      fileName: b.fileName,
      preview: typeof meta.preview === 'string' && meta.preview.length > 0 ? meta.preview : null,
      children: [],
    };
    this.nodes.set(b.id, node);

    if (b.parent && this.nodes.has(b.parent)) {
      this.nodes.get(b.parent).children.push(b.id);
    } else if (b.parent) {
      this.orphans.push(b.id);
    } else {
      this.rootIds.push(b.id);
    }
    return node;
  }

  /** Rebuild from a list of metas (B7: fully derived). */
  static build(metas = []) {
    const index = new PanelIndex();
    for (const meta of metas) index.add(meta);
    return index;
  }

  get(id) {
    return this.nodes.get(id) ?? null;
  }

  getChildren(parentId) {
    const node = this.nodes.get(parentId);
    if (!node) return [];
    return node.children.map((id) => this.nodes.get(id)).filter(Boolean);
  }

  /** Resolve the chat file name for a branch/snapshot (rollback target). */
  resolveFileName(branchId) {
    const node = this.nodes.get(branchId);
    return node ? node.fileName : null;
  }

  /** Root-to-node path (rollback trail). Returns [] when unknown. */
  getPath(branchId) {
    const path = [];
    let current = this.nodes.get(branchId);
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current.id);
      current = current.parent ? this.nodes.get(current.parent) : null;
    }
    return path;
  }

  setActive(branchId) {
    if (!this.nodes.has(branchId)) {
      throw new Error(`unknown branch id: ${branchId}`);
    }
    this.activeId = branchId;
  }

  toJSON() {
    return {
      activeId: this.activeId,
      rootIds: [...this.rootIds],
      orphans: [...this.orphans],
      nodes: [...this.nodes.values()],
    };
  }

  static fromJSON(json) {
    const index = new PanelIndex();
    for (const node of json?.nodes ?? []) {
      const meta = {
        schema: 3,
        branch: {
          id: node.id,
          kind: node.kind,
          parent: node.parent ?? null,
          source_floor: node.sourceFloor ?? null,
          reason: node.reason ?? 'root',
          created_at: node.createdAt ?? null,
          file_name: node.fileName ?? null,
        },
      };
      if (typeof node.preview === 'string' && node.preview.length > 0) {
        meta.preview = node.preview;
      }
      index.add(meta);
    }
    index.activeId = json?.activeId ?? null;
    return index;
  }
}
