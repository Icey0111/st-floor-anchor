/**
 * Client-side filter that hides Floor Anchor snapshot files from SillyTavern's
 * native chat management lists.
 *
 * ST lists chats through three JSON endpoints - /api/characters/chats,
 * /api/chats/recent and /api/chats/search - and there is no server-side
 * "hidden" flag. The snapshots are still ordinary JSONL files (durable,
 * exportable, switchable via openCharacterChat), but their file names carry
 * the [FA] marker, so this module wraps window.fetch and strips them from the
 * list responses before ST's UI ever sees them.
 *
 * Our own scan/clear requests opt out via the X-StFloor-Internal header so
 * the panel always sees the full truth.
 */
import { filterChatListPayload, isSnapshotFileName } from './helpers.js';

const LIST_ENDPOINTS = ['/api/characters/chats', '/api/chats/recent', '/api/chats/search'];
const INTERNAL_HEADER = 'X-StFloor-Internal';

/**
 * The currently open chat when it is a Floor Anchor snapshot. Legacy
 * snapshots (created before the [FA] marker) cannot be renamed while they are
 * the active chat - ST may still be saving to the old name - so the filter
 * hides them by id until the user leaves them and the migration renames the
 * file safely.
 */
let activeSnapshotFileName = null;

export function setActiveSnapshotFileName(name) {
  activeSnapshotFileName = typeof name === 'string' && name.length > 0 ? name : null;
}

function isHiddenEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const base = String(entry.file_name ?? entry.file_id ?? '').replace(/\.jsonl$/i, '');
  if (isSnapshotFileName(base)) return true;
  return !!activeSnapshotFileName && base === activeSnapshotFileName;
}

export function shouldFilterRequestUrl(url) {
  if (typeof url !== 'string') return false;
  return LIST_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

function hasInternalHeader(requestInit) {
  const headers = requestInit?.headers;
  if (!headers) return false;
  if (typeof headers.get === 'function') {
    return headers.get(INTERNAL_HEADER) === '1';
  }
  if (Array.isArray(headers)) {
    const lower = INTERNAL_HEADER.toLowerCase();
    return headers.some(([key, value]) => String(key).toLowerCase() === lower && String(value) === '1');
  }
  return headers[INTERNAL_HEADER] === '1' || headers[INTERNAL_HEADER.toLowerCase()] === '1';
}

/**
 * Patch window.fetch to filter snapshot entries from chat-list responses.
 * Returns a restore function.
 */
export function installChatListFilter() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  const originalFetch = window.fetch;

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (!shouldFilterRequestUrl(url) || !response.ok || hasInternalHeader(args[1])) {
      return response;
    }
    try {
      const payload = await response.json();
      const filtered = filterChatListPayload(payload, isHiddenEntry);
      return new Response(JSON.stringify(filtered), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      // Non-JSON or unreadable body: pass through untouched.
      return response;
    }
  };

  return () => {
    window.fetch = originalFetch;
  };
}
