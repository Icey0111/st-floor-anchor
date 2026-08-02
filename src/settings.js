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

const SETTINGS_KEY = 'stfloor';

const DEFAULT_SETTINGS = {
  previewMaxLength: 30,
  filterBlocks: [...DEFAULT_FILTER_BLOCKS],
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
  return { previewMaxLength, filterBlocks };
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
          <input id="stfloor_preview_length" type="number" min="5" max="100" value="${settings.previewMaxLength}" class="text_pole widthNatural">
        </div>
        <small class="flexContainer" data-i18n="[title]Comma-separated XML tag names whose whole content is ignored in branch previews (preset status bars / thinking tags).">
          Ignore tags (whole blocks removed from previews)
        </small>
        <input id="stfloor_filter_blocks" type="text" value="${settings.filterBlocks.join(', ')}"
          class="text_pole width100p" placeholder="dream_scene, dream_summary, date, time, location">
        <small class="flexContainer">Reasoning (thinking chain) is always ignored; only message body text is previewed.</small>
      </div>
    </div>`;

  const lengthInput = container.querySelector('#stfloor_preview_length');
  const blocksInput = container.querySelector('#stfloor_filter_blocks');

  function apply() {
    saveStFloorSettings({
      previewMaxLength: clampInt(lengthInput.value, 5, 100, DEFAULT_SETTINGS.previewMaxLength),
      filterBlocks: blocksInput.value
        .split(/[,，\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
    onChanged();
  }

  lengthInput.addEventListener('change', apply);
  blocksInput.addEventListener('change', apply);
  return container;
}
