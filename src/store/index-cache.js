const CACHE_SCHEMA = 1;
const DEFAULT_CACHE_KEY = 'stfloor.panel_index_cache.v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return { schema: CACHE_SCHEMA, scopes: {} };
}

function isUsableScope(scope) {
  return !!scope
    && typeof scope === 'object'
    && typeof scope.avatarUrl === 'string'
    && typeof scope.rootFileName === 'string'
    && Array.isArray(scope.aliases)
    && Array.isArray(scope.index?.nodes);
}

/**
 * Bounded localStorage cache for rebuildable PanelIndex JSON. Cached content
 * is never authoritative; callers validate it through PanelIndex.fromJSON().
 */
export function createPanelIndexCache(
  storage = globalThis.localStorage,
  key = DEFAULT_CACHE_KEY,
  { maxScopes = 24 } = {},
) {
  function readState() {
    try {
      const parsed = JSON.parse(storage?.getItem(key) ?? 'null');
      if (parsed?.schema !== CACHE_SCHEMA || !parsed.scopes || typeof parsed.scopes !== 'object') {
        return emptyState();
      }
      return parsed;
    } catch {
      return emptyState();
    }
  }

  function writeState(state) {
    try {
      const scopes = Object.entries(state.scopes)
        .filter(([, scope]) => isUsableScope(scope))
        .sort((a, b) => Number(b[1].updatedAt ?? 0) - Number(a[1].updatedAt ?? 0))
        .slice(0, maxScopes);
      storage?.setItem(key, JSON.stringify({ schema: CACHE_SCHEMA, scopes: Object.fromEntries(scopes) }));
    } catch {
      // Cache writes are best-effort (private mode / quota exhaustion).
    }
  }

  function findScope(state, avatarUrl, fileName) {
    return Object.values(state.scopes)
      .filter(isUsableScope)
      .filter((scope) => scope.avatarUrl === avatarUrl)
      .filter((scope) => scope.rootFileName === fileName || scope.aliases.includes(fileName))
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))[0] ?? null;
  }

  return {
    read(avatarUrl, fileName, previewKey = '') {
      if (!avatarUrl || !fileName) return null;
      const scope = findScope(readState(), avatarUrl, fileName);
      if (!scope) return null;
      const copy = clone(scope);
      if (copy.previewKey !== previewKey) {
        for (const node of copy.index.nodes) node.preview = null;
      }
      return copy;
    },

    write({ avatarUrl, rootFileName, index, previewKey = '', now = Date.now() }) {
      if (!avatarUrl || !rootFileName || !Array.isArray(index?.nodes)) return false;
      const state = readState();
      const scopeId = JSON.stringify([avatarUrl, rootFileName]);
      const aliases = [...new Set(index.nodes.map((node) => node?.fileName).filter((name) => typeof name === 'string' && name))];
      state.scopes[scopeId] = {
        avatarUrl,
        rootFileName,
        aliases,
        previewKey,
        updatedAt: now,
        index: clone(index),
      };
      writeState(state);
      return true;
    },

    setPreview(avatarUrl, currentFileName, fileName, previewKey, preview, previewToken = null) {
      const state = readState();
      const scope = findScope(state, avatarUrl, currentFileName);
      if (!scope) return false;
      if (scope.previewKey !== previewKey) {
        scope.previewKey = previewKey;
        for (const node of scope.index.nodes) node.preview = null;
      }
      const node = scope.index.nodes.find((candidate) => candidate?.fileName === fileName);
      if (!node) return false;
      node.preview = typeof preview === 'string' ? preview : '';
      node.previewToken = typeof previewToken === 'string' ? previewToken : null;
      scope.updatedAt = Date.now();
      writeState(state);
      return true;
    },

    invalidateAvatar(avatarUrl) {
      if (!avatarUrl) return;
      const state = readState();
      for (const [scopeId, scope] of Object.entries(state.scopes)) {
        if (scope?.avatarUrl === avatarUrl) delete state.scopes[scopeId];
      }
      writeState(state);
    },
  };
}
