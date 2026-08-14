/**
 * Floor Anchor settings. Stored in ST's shared `extension_settings.stfloor`
 * (persisted by ST's own settings save), so values survive reloads and the
 * panel does not need its own storage.
 *
 * The settings section is rendered into ST's extensions panel
 * (#extensions_settings, the "three cubes" icon) as a standard
 * inline-drawer block, following the pattern used by bundled extensions.
 */
import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { DEFAULT_FILTER_BLOCKS } from './store/helpers.js';
import {
  DEFAULT_RETENTION_POLICY,
  RETENTION_MODE_KEEP_ALL,
  RETENTION_MODE_REMIND,
  normalizeRetentionPolicy,
} from './store/retention-policy.js';

const SETTINGS_KEY = 'stfloor';

const DEFAULT_SETTINGS = {
  previewMaxLength: 30,
  filterBlocks: [...DEFAULT_FILTER_BLOCKS],
  retentionMode: DEFAULT_RETENTION_POLICY.mode,
  retentionReminderLimit: DEFAULT_RETENTION_POLICY.reminderLimit,
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Normalized current settings (never mutates the stored object). */
export function getStFloorSettings() {
  const raw = extension_settings?.[SETTINGS_KEY] ?? {};
  const previewMaxLength = clampInt(raw.previewMaxLength, 5, 100, DEFAULT_SETTINGS.previewMaxLength);
  const filterBlocks = Array.isArray(raw.filterBlocks)
    ? raw.filterBlocks
        .filter((x) => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim().toLowerCase())
    : [...DEFAULT_SETTINGS.filterBlocks];
  const retention = normalizeRetentionPolicy({
    mode: raw.retentionMode,
    reminderLimit: raw.retentionReminderLimit,
  });
  return {
    previewMaxLength,
    filterBlocks,
    retentionMode: retention.mode,
    retentionReminderLimit: retention.reminderLimit,
  };
}

export function saveStFloorSettings(partial) {
  if (!extension_settings) return;
  extension_settings[SETTINGS_KEY] = {
    ...(extension_settings[SETTINGS_KEY] ?? {}),
    ...partial,
  };
  saveSettingsDebounced();
}

/**
 * Render the settings section into ST's extensions panel.
 * @param {{onChanged?: () => void}} [opts]
 */
export function registerSettingsPanel({ onChanged = () => {} } = {}) {
  if (typeof document === 'undefined') return null;
  const parent = document.querySelector('#extensions_settings');
  if (!parent || document.querySelector('#stfloor_container')) return null;

  const container = document.createElement('div');
  container.id = 'stfloor_container';
  container.className = 'extension_container';
  parent.append(container);

  const settings = getStFloorSettings();
  container.innerHTML = `
    <div id="stfloor_settings" class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Floor Anchor</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="flex-container alignItemsCenter">
          <label for="stfloor_preview_length" class="flex1 margin0">Branch preview length</label>
          <input id="stfloor_preview_length" type="number" min="5" max="100" class="text_pole widthNatural">
        </div>
        <small class="flexContainer" data-i18n="[title]Comma-separated XML tag names whose whole content is ignored in branch previews (preset status bars / thinking tags).">
          Ignore tags (whole blocks removed from previews)
        </small>
        <input id="stfloor_filter_blocks" type="text"
          class="text_pole width100p" placeholder="dream_scene, dream_summary, date, time, location">
        <small class="flexContainer">Reasoning (thinking chain) is always ignored; only message body text is previewed.</small>
        <hr>
        <div class="flex-container alignItemsCenter">
          <label for="stfloor_retention_mode" class="flex1 margin0">Snapshot retention</label>
          <select id="stfloor_retention_mode" class="text_pole widthNatural">
            <option value="${RETENTION_MODE_KEEP_ALL}">Keep all snapshots</option>
            <option value="${RETENTION_MODE_REMIND}">Cleanup reminders</option>
          </select>
        </div>
        <div class="flex-container alignItemsCenter stfloor-retention-limit-row">
          <label for="stfloor_retention_limit" class="flex1 margin0">Remind at snapshot count</label>
          <input id="stfloor_retention_limit" type="number" min="10" max="1000" class="text_pole widthNatural">
        </div>
        <small class="flexContainer">Floor Anchor never deletes snapshots automatically. Cleanup always uses the panel's per-snapshot double confirmation.</small>
      </div>
    </div>`;

  const lengthInput = container.querySelector('#stfloor_preview_length');
  const blocksInput = container.querySelector('#stfloor_filter_blocks');
  const retentionModeInput = container.querySelector('#stfloor_retention_mode');
  const retentionLimitInput = container.querySelector('#stfloor_retention_limit');
  const retentionLimitRow = container.querySelector('.stfloor-retention-limit-row');
  lengthInput.value = String(settings.previewMaxLength);
  blocksInput.value = settings.filterBlocks.join(', ');
  retentionModeInput.value = settings.retentionMode;
  retentionLimitInput.value = String(settings.retentionReminderLimit);

  function syncRetentionControls() {
    const enabled = retentionModeInput.value === RETENTION_MODE_REMIND;
    retentionLimitInput.disabled = !enabled;
    retentionLimitRow.style.opacity = enabled ? '' : '0.6';
  }

  function apply() {
    saveStFloorSettings({
      previewMaxLength: clampInt(lengthInput.value, 5, 100, DEFAULT_SETTINGS.previewMaxLength),
      filterBlocks: blocksInput.value
        .split(/[,，\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      retentionMode: retentionModeInput.value === RETENTION_MODE_REMIND
        ? RETENTION_MODE_REMIND
        : RETENTION_MODE_KEEP_ALL,
      retentionReminderLimit: clampInt(
        retentionLimitInput.value,
        10,
        1000,
        DEFAULT_RETENTION_POLICY.reminderLimit,
      ),
    });
    syncRetentionControls();
    onChanged();
  }

  lengthInput.addEventListener('change', apply);
  blocksInput.addEventListener('change', apply);
  retentionModeInput.addEventListener('change', apply);
  retentionLimitInput.addEventListener('change', apply);
  syncRetentionControls();
  return container;
}
