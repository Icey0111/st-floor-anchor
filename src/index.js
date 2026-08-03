// Floor Anchor - SillyTavern UI extension entry point (M2).

import { getContext } from '/scripts/st-context.js';

import {
  createSnapshot,
  switchToBranch,
  scanBranches,
  deleteSnapshotFile,
  adoptRootIfNeeded,
  appendCharacterMessage,
  renumberSnapshotsAfterPrune,
} from './store/chat-api.js';
import { chat_metadata, getCurrentChatId } from '/script.js';
import { installHooks } from './actions/hooks.js';
import { createBranchPanel } from './ui/branch-panel.js';
import { installChatListFilter, setActiveSnapshotFileName } from './store/list-filter.js';
import { readBranchMeta } from './model/metadata.js';
import { registerSettingsPanel, getStFloorSettings, saveStFloorSettings } from './settings.js';

console.log('[Floor Anchor] booting...');

try {
  const context = getContext();
  const { eventSource, eventTypes, registerSlashCommand } = context;

  // Hide snapshot files from ST's native chat lists (fetch-layer filter).
  // Installed first so every later list request is already clean.
  let restoreChatListFilter = installChatListFilter();
  const setChatListFilter = (enabled) => {
    if (enabled && !restoreChatListFilter) {
      restoreChatListFilter = installChatListFilter();
    } else if (!enabled && restoreChatListFilter) {
      restoreChatListFilter();
      restoreChatListFilter = null;
    }
    return !!restoreChatListFilter;
  };

  const panel = createBranchPanel({
    onRefresh: () => refreshPanel(),
    onSwitch: (fileName) => switchToBranch(fileName),
    onAddMessage: async (text) => {
      try {
        await appendCharacterMessage(text);
        // The floor is appended and rendered; rescan the panel in the
        // background so the composer can close without waiting for it.
        void refreshPanel();
      } catch (error) {
        console.error('[Floor Anchor] new character message failed:', error);
        throw error; // composer keeps the text and re-enables Add
      }
    },
    onDelete: async (branchId, fileName, parentId) => {
      await deleteSnapshotFile(fileName);
      await renumberSnapshotsAfterPrune({ deletedBranchId: branchId, deletedParentId: parentId });
      await refreshPanel();
    },
  });

  async function refreshPanel() {
    const index = await scanBranches();
    panel.render(index);
    return index;
  }

  // --- entry button: between pencil (.mes_edit) and "..." (.extraMesButtonsHint) ---
  const ENTRY_CLASS = 'stfloor-entry';

  function makeEntryButton() {
    const button = document.createElement('div');
    button.className = `mes_button ${ENTRY_CLASS} fa-solid fa-diagram-project`;
    button.title = 'Floor Anchor: branch tree & snapshots';
    return button;
  }

  // Real mouse/touch clicks may never reach the button element (ST's own
  // pointer handling, overlay elements, etc). Listen on document in the
  // CAPTURE phase for both pointerup and click, so the toggle always fires
  // regardless of what the event target ended up being.
  let lastToggleAt = 0;
  function onEntryPointer(event) {
    if (!event.target.closest(`.${ENTRY_CLASS}`)) return;
    const now = Date.now();
    if (now - lastToggleAt < 350) return; // dedupe pointerup + click pair
    lastToggleAt = now;
    event.preventDefault();
    event.stopPropagation();
    panel.toggle();
  }
  document.addEventListener('pointerup', onEntryPointer, true);
  document.addEventListener('click', onEntryPointer, true);

  function ensureEntryButtons(rootNode = document) {
    // ST emits USER_MESSAGE_RENDERED / CHARACTER_MESSAGE_RENDERED with the
    // message id as the first argument; only scan when a real DOM node
    // arrived, otherwise fall back to the whole document.
    rootNode = rootNode && typeof rootNode.querySelectorAll === 'function' ? rootNode : document;
    let inserted = 0;
    rootNode.querySelectorAll('.mes_buttons').forEach((row) => {
      if (row.querySelector(`.${ENTRY_CLASS}`)) return;
      const editButton = row.querySelector('.mes_edit');
      if (editButton) {
        editButton.before(makeEntryButton());
        inserted++;
      }
    });
    if (inserted > 0) {
      console.log(`[Floor Anchor] inserted ${inserted} entry button(s)`);
    }
    return inserted;
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) ensureEntryButtons(node);
      }
    }
  });

  // --- events ---
  function syncActiveSnapshot() {
    // Legacy snapshots (no [FA] marker) that are currently open cannot be
    // renamed safely; hide them from ST's lists by id until the user leaves
    // them and the migration renames the file. Derived from chat_metadata on
    // both events: ST fires CHAT_LOADED then CHAT_CHANGED in the same load,
    // so a blind reset in CHAT_CHANGED would wipe the id immediately.
    const meta = readBranchMeta(chat_metadata);
    setActiveSnapshotFileName(meta?.branch.kind === 'snapshot' ? getCurrentChatId() : null);
  }

  eventSource.on(eventTypes.CHAT_LOADED, async () => {
    syncActiveSnapshot();
    adoptRootIfNeeded();
    await refreshPanel();
  });
  eventSource.on(eventTypes.CHAT_CHANGED, () => {
    syncActiveSnapshot();
    void refreshPanel();
  });
  // Messages rendered after our init still need entry buttons.
  eventSource.on(eventTypes.USER_MESSAGE_RENDERED, ensureEntryButtons);
  eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, ensureEntryButtons);

  installHooks({
    createSnapshot,
    onSnapshot: () => void refreshPanel(),
  });

  // Settings section inside ST's extensions panel ("three cubes" icon).
  registerSettingsPanel({ onChanged: () => void refreshPanel() });

  // --- DOM insertion first: never let a later failure block the entry button ---
  observer.observe(document.body, { childList: true, subtree: true });
  ensureEntryButtons();
  setTimeout(() => ensureEntryButtons(), 2000); // one-shot sweep for late renders

  // Slash command: name must NOT start with "/" (SlashCommandParser rejects it).
  try {
    registerSlashCommand(
      'floor',
      () => {
        panel.toggle();
        return '';
      },
      ['floor'],
      'Open the Floor Anchor branch/snapshot panel',
    );
  } catch (error) {
    console.error('[Floor Anchor] slash command registration failed (non-fatal):', error);
  }

  window.__stFloorAnchor = {
    panel,
    refreshPanel,
    addCharMessage: appendCharacterMessage,
    ensureEntryButtons,
    settings: {
      get: getStFloorSettings,
      save: saveStFloorSettings,
    },
    chatListFilter: {
      isActive: () => !!restoreChatListFilter,
      setActive: setChatListFilter,
    },
  };
  console.log('[Floor Anchor] loaded (M2: ST integration + panel)');
} catch (error) {
  console.error('[Floor Anchor] failed to initialize:', error);
}
