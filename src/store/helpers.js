import { readBranchMeta } from '../model/metadata.js';

/** Characters that are unsafe in SillyTavern chat file names. */
const UNSAFE = /[<>:"/\\|?*\u0000-\u001F]/g;

/** Limit file-name length (ST uses <255 bytes; keep well under). */
const MAX_NAME_LENGTH = 180;

/**
 * Marker embedded in every snapshot chat file name. ST's native chat list
 * endpoints (characters/chats, chats/recent, chats/search) are filtered by
 * this marker client-side so backups never clutter the built-in chat
 * manager; the marker is filename-safe and survives sanitize.
 */
export const SNAPSHOT_FILE_MARKER = '[FA]';

export function sanitizeFileName(name) {
  return String(name)
    .replace(UNSAFE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** True when a chat file name (with or without .jsonl) is one of ours. */
export function isSnapshotFileName(name) {
  return typeof name === 'string' && name.includes(SNAPSHOT_FILE_MARKER);
}

/**
 * Build a unique snapshot file name (without .jsonl).
 * Example: "My Chat - [FA] roll 2026-08-02-07-30-00 br_201"
 */
export function buildSnapshotName(mainChatName, { reason, branchId, now = new Date() }) {
  const base = sanitizeFileName(mainChatName) || 'chat';
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('-');
  return sanitizeFileName(`${base} - ${SNAPSHOT_FILE_MARKER} ${reason} ${stamp} ${branchId}`);
}

/**
 * Parse the /api/characters/chats response (simple mode) into an array of
 * chat file names (without .jsonl).
 */
export function parseChatList(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.values(data)
    .map((x) => (typeof x?.file_name === 'string' ? x.file_name.replace(/\.jsonl$/i, '') : null))
    .filter(Boolean);
}

/**
 * Remove Floor Anchor snapshot entries from a chat-list API payload so ST's
 * native chat manager never shows backups. Handles the response shapes of
 * /api/characters/chats (simple + full), /api/chats/recent and
 * /api/chats/search: arrays of objects with file_name/file_id, plus plain
 * object payloads such as { error: true } (passed through untouched).
 */
export function filterChatListPayload(payload, isHidden = isSnapshotEntry) {
  if (Array.isArray(payload)) {
    return payload.filter((entry) => !isHidden(entry));
  }
  if (payload && typeof payload === 'object') {
    const out = {};
    for (const key of Object.keys(payload)) {
      out[key] = Array.isArray(payload[key])
        ? payload[key].filter((entry) => !isHidden(entry))
        : payload[key];
    }
    return out;
  }
  return payload;
}

function isSnapshotEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return isSnapshotFileName(entry.file_name) || isSnapshotFileName(entry.file_id);
}

/**
 * Preview text for a branch/snapshot node: the last non-empty message body
 * (with display-text fallback for tool-call messages), whitespace-collapsed
 * and truncated. Thinking-only messages (empty body + extra.reasoning) are
 * skipped - the reasoning chain is not 正文 and churns while streaming. Pure
 * display data, never persisted into chat_metadata.
 *
 * @param {Array} chatArray  chat JSONL array
 * @param {number} [maxLength=30]  preview length in characters
 * @param {{filterBlocks?: string[]}} [options]  extra XML element names to
 *        remove whole blocks for (preset-specific status bars / thinking tags)
 */
export function computeChatPreview(chatArray, maxLength = 30, options = {}) {
  if (!Array.isArray(chatArray) || chatArray.length === 0) return '';
  const blocks = normalizeFilterBlocks([...DEFAULT_FILTER_BLOCKS, ...(options?.filterBlocks ?? [])]);
  for (let i = chatArray.length - 1; i >= 0; i--) {
    const message = chatArray[i];
    if (!message || typeof message !== 'object') continue;
    const text = pickPreviewText(message);
    if (!text) continue;
    // Remove preset-generated metadata (status bars, summaries) entirely and
    // strip XML/HTML comments + tags so the preview reads like 正文.
    const cleaned = stripMarkup(text, blocks);
    const collapsed = cleaned.replace(/\s+/g, ' ').trim();
    if (collapsed.length === 0) continue;
    return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed;
  }
  return '';
}

/**
 * XML elements that are preset-generated metadata (scene/status bars, dream
 * summaries, date/time/location) - removed WITH their inner text so they
 * never leak into the preview. Narrative containers (dream_body, dream_plot)
 * are kept; only their tags are stripped by the generic pass below.
 */
export const DEFAULT_FILTER_BLOCKS = ['dream_scene', 'dream_summary', 'dream_after_format', 'dream_meta', 'date', 'time', 'location'];

function normalizeFilterBlocks(names) {
  const seen = new Set();
  const out = [];
  for (const name of names) {
    // Allow "<tag>" or "tag"; keep only safe element-name characters.
    const clean = String(name).trim().toLowerCase().replace(/^<|>$/g, '').replace(/[^a-z0-9_-]/g, '');
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function stripMarkup(text, blocks) {
  let out = String(text);
  for (const name of blocks) {
    out = out.replace(new RegExp(`<${name}[^>]*>[\\s\\S]*?<\\/${name}>`, 'gi'), ' ');
  }
  out = out.replace(/<dream_done\s*\/?>/gi, ' ');
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  out = out.replace(/<[^>]*>/g, ' ');
  return out;
}

function pickPreviewText(message) {
  // Never fall back to extra.reasoning: a truncated/streaming message would
  // make the preview show the chain-of-thought instead of the conversation.
  const candidates = [
    typeof message.mes === 'string' ? message.mes : '',
    typeof message.extra?.display_text === 'string' ? message.extra.display_text : '',
  ];
  return candidates.find((text) => text.trim().length > 0) ?? '';
}

/**
 * Extract the branch meta from a fetched chat JSON (header first).
 * Returns null for plain ST chats (no st_floor).
 */
export function metaFromChatJson(chatJson) {
  if (!Array.isArray(chatJson) || chatJson.length === 0) return null;
  const header = chatJson[0];
  if (!header || typeof header !== 'object') return null;
  const meta = readBranchMeta(header.chat_metadata ?? null);
  if (!meta) return null;
  const mainChat = header.chat_metadata?.main_chat;
  if (typeof mainChat === 'string' && mainChat.length > 0) {
    meta.mainChat = mainChat;
  }
  return meta;
}

/**
 * Dedupe helper for snapshot triggers: returns true when a snapshot for the
 * same (chatId, reason) was requested within `cooldownMs`.
 */
export function createSnapshotDedupe(cooldownMs = 400) {
  const last = new Map();
  return (chatId, reason, now = Date.now()) => {
    const key = `${chatId}:${reason}`;
    const prev = last.get(key) ?? 0;
    if (now - prev < cooldownMs) return true;
    last.set(key, now);
    return false;
  };
}

/** Message fields that define chat content; volatile render metadata is excluded. */
const CONTENT_FIELDS = ['name', 'is_user', 'is_system', 'role', 'mes', 'swipes', 'extra'];

/**
 * Normalize a chat array into a stable content fingerprint.
 *
 * Chat messages carry volatile metadata (id, send_date, token counters,
 * timers) that changes without any actual content change (e.g. a failed roll
 * while the API is disconnected). Comparing only content fields makes
 * duplicate snapshots detectable reliably - chat history is highly static.
 */
export function computeChatFingerprint(chatArray) {
  if (!Array.isArray(chatArray)) return 'empty';
  const normalized = chatArray.map((message) => {
    if (!message || typeof message !== 'object') return String(message);
    const out = {};
    for (const field of CONTENT_FIELDS) {
      if (message[field] !== undefined) out[field] = message[field];
    }
    return out;
  });
  return stableStringify(normalized);
}

/**
 * Deterministic JSON stringify (stable key order, no whitespace) so the same
 * logical object always yields the same string.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Persisted per-branch fingerprint store, so dedupe survives page reloads.
 * Keys are branch ids; values are content fingerprints of the last snapshot.
 */
export function createFingerprintStore(storage = globalThis.localStorage, key = 'stfloor.last_snapshot_fingerprints') {
  function read() {
    try {
      const raw = storage?.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function write(map) {
    try {
      storage?.setItem(key, JSON.stringify(map));
    } catch {
      // storage unavailable (private mode etc.) - dedupe is best-effort
    }
  }
  return {
    get(branchId) {
      return read()[branchId] ?? null;
    },
    set(branchId, fingerprint) {
      const map = read();
      map[branchId] = fingerprint;
      write(map);
    },
  };
}
