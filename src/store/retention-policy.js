export const RETENTION_MODE_KEEP_ALL = 'keep-all';
export const RETENTION_MODE_REMIND = 'remind';

export const DEFAULT_RETENTION_POLICY = Object.freeze({
  mode: RETENTION_MODE_KEEP_ALL,
  reminderLimit: 100,
});

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Normalize the user-visible retention policy. No mode returned by this
 * module authorizes deletion: pruning remains an explicit panel action.
 */
export function normalizeRetentionPolicy(raw = {}) {
  return {
    mode: raw?.mode === RETENTION_MODE_REMIND ? RETENTION_MODE_REMIND : RETENTION_MODE_KEEP_ALL,
    reminderLimit: clampInt(raw?.reminderLimit, 10, 1000, DEFAULT_RETENTION_POLICY.reminderLimit),
  };
}

/** Summarize a tree for the panel's non-destructive retention status line. */
export function evaluateRetentionPolicy(nodes = [], rawPolicy = {}) {
  const policy = normalizeRetentionPolicy(rawPolicy);
  const snapshotCount = [...nodes].filter((node) => node?.kind === 'snapshot').length;
  const reminderDue = policy.mode === RETENTION_MODE_REMIND && snapshotCount >= policy.reminderLimit;
  return {
    ...policy,
    snapshotCount,
    reminderDue,
    excessCount: reminderDue ? snapshotCount - policy.reminderLimit + 1 : 0,
    autoDelete: false,
  };
}
