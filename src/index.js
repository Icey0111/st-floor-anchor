// Floor Anchor - SillyTavern UI extension entry point (M2).

import { getContext } from '/scripts/st-context.js';

import {
  createSnapshot,
  switchToBranch,
  scanBranches,
  deleteSnapshotFile,
  prepareCurrentChatStorage,
  appendCharacterMessage,
  loadBranchPreview,
} from './store/chat-api.js';
import { chat_metadata, getCurrentChatId } from '/script.js';
import { installHooks } from './actions/hooks.js';
import { createBranchPanel } from './ui/branch-panel.js';
import { installChatListFilter, setActiveSnapshotFileName } from './store/list-filter.js';
import { readBranchMeta } from './model/metadata.js';
import { registerSettingsPanel, getStFloorSettings, saveStFloorSettings } from './settings.js';
import { installChatEventHandlers } from './events/chat-events.js';

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
    onLoadPreview: (fileName) => loadBranchPreview(fileName),
    getRetentionPolicy: () => {
      const settings = getStFloorSettings();
      return {
        mode: settings.retentionMode,
        reminderLimit: settings.retentionReminderLimit,
      };
    },
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
      const deleted = await deleteSnapshotFile(fileName);
      if (!deleted) {
        throw new Error(`Failed to delete snapshot file: ${fileName}`);
      }
      await refreshPanel();
    },
  });

  let refreshInFlight = null;
  let refreshPending = false;

  async function refreshPanel() {
    if (refreshInFlight) {
      refreshPending = true;
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      let index;
      do {
        refreshPending = false;
        index = await scanBranches();
        // Scope the panel's per-chat UI state (collapse/search) by chat file
        // and pass the tree's root file for one-click return to the main chat.
        const rootNode = [...index.nodes.values()].find((n) => n.kind === 'active' && n.parent === null);
        panel.render(index, getCurrentChatId() ?? '', rootNode?.fileName ?? null);
      } while (refreshPending);
      return index;
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
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
  // regardless of what the event target ended up being. When pointerup opens
  // the panel, the browser still dispatches a `click` right after - by then
  // the panel may have rendered a button exactly under the cursor (e.g. the
  // top branch's Switch), so one physical press could trigger BOTH the icon
  // and that button. The follow-up click is therefore swallowed for a short
  // window unless it still targets the entry icon itself.
  let lastToggleAt = 0;
  let swallowClickUntil = 0;
  const isEntryTarget = (event) => !!event.target?.closest?.(`.${ENTRY_CLASS}`);

  function onEntryPointerUp(event) {
    if (!isEntryTarget(event)) return;
    const now = Date.now();
    if (now - lastToggleAt < 350) return; // dedupe pointerup + click pair
    lastToggleAt = now;
    event.preventDefault();
    event.stopPropagation();
    panel.toggle();
    swallowClickUntil = now + 150;
  }

  function onEntryClick(event) {
    const now = Date.now();
    if (now < swallowClickUntil) {
      // Tail of the pointerup that just toggled the panel. If it landed on a
      // button that appeared under the cursor (not the entry icon), suppress
      // it so one physical click cannot press two buttons.
      if (!isEntryTarget(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!isEntryTarget(event)) return;
    if (now - lastToggleAt < 350) return;
    lastToggleAt = now;
    event.preventDefault();
    event.stopPropagation();
    panel.toggle();
  }
  document.addEventListener('pointerup', onEntryPointerUp, true);
  document.addEventListener('click', onEntryClick, true);

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
  installChatEventHandlers({
    eventSource,
    eventTypes,
    // Legacy snapshots (no [FA] marker) that are currently open cannot be
    // renamed safely. Recompute the id on both events because ST emits
    // CHAT_LOADED then CHAT_CHANGED for the same navigation.
    readActiveSnapshotFileName: () => {
      const meta = readBranchMeta(chat_metadata);
      return meta?.branch.kind === 'snapshot' ? getCurrentChatId() : null;
    },
    setActiveSnapshotFileName,
    prepareCurrentChatStorage,
    refreshPanel,
    onPreparationError: (error) => {
      // A legacy repair failure must not make the panel unavailable. The
      // event barrier and store queue remain healthy for a later retry.
      console.error('[Floor Anchor] explicit legacy migration failed:', error);
    },
    onRefreshError: (error) => {
      console.error('[Floor Anchor] chat-change refresh failed:', error);
    },
  });
  // Messages rendered after our init still need entry buttons.
  eventSource.on(eventTypes.USER_MESSAGE_RENDERED, ensureEntryButtons);
  eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, ensureEntryButtons);

  installHooks({
    createSnapshot,
    onSnapshot: () => void refreshPanel(),
  });

  // Settings section inside ST's extensions panel ("three cubes" icon).
  registerSettingsPanel({
    onChanged: () => {
      panel.invalidatePreviews();
      void refreshPanel();
    },
  });

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
