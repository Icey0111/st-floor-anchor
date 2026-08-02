# scaffold_and_design_floor_anchor_plugin

- Date: 2026-08-02 02:16:45
- Session: Bootstrap the SillyTavern floor-anchor chat extension (M0).

## Problem / Requirement
User asked to plan and build a SillyTavern extension whose design was
discussed in the conversation:

1. Floor-based message storage where roll/delete insert child anchors at the
   same floor instead of overwriting/deleting; only the affected floor segment
   (old content + continuation pointer) is stored per branch.
2. A character floor editor, including rescuing content from a truncated
   reasoning block and creating a new character floor from it.
3. Import/export compatibility: native ST JSONL round-trip with no data loss,
   and graceful degradation when the extension is absent.

## Purpose of Change
Establish the project skeleton (`dev_docs/`, `change_log/`, `remove/`) and a
complete, reviewable design (overview, architecture, tech stack, data model,
roadmap, work tree) before any large-scale coding, following the
`project-docs-workflow` skill ("design first, get agreement").

## How It Was Changed
- [D:\stplugin\dev_docs\00_overview.md L1-L56](file:///D:/stplugin/dev_docs/00_overview.md#L1-L56) - problem, goals G1-G5, scope, non-goals, stakeholders
- [D:\stplugin\dev_docs\01_architecture.md L1-L100](file:///D:/stplugin/dev_docs/01_architecture.md#L1-L100) - module boundaries (model/store/actions/ui/io), Mermaid flows for roll/delete/rescue/import-export, ST event surface
- [D:\stplugin\dev_docs\02_tech_stack.md L1-L31](file:///D:/stplugin/dev_docs/02_tech_stack.md#L1-L31) - pure JS UI extension, no build step, `node --test`, compatibility targets, stack risks
- [D:\stplugin\dev_docs\03_data_model.md L1-L78](file:///D:/stplugin/dev_docs/03_data_model.md#L1-L78) - Floor/Anchor/BranchLink entities, storage mapping (`chat_metadata.st_floor`, `extra.st_floor`, native `is_hidden`), JSONL examples, invariants I1-I7, no-plugin degradation
- [D:\stplugin\dev_docs\04_roadmap.md L1-L32](file:///D:/stplugin/dev_docs/04_roadmap.md#L1-L32) - milestones M0-M5, open questions (checkpoint/branch mapping, hidden-flag semantics), risks
- [D:\stplugin\dev_docs\05_worktree.md L1-L60](file:///D:/stplugin/dev_docs/05_worktree.md#L1-L60) - canonical directory tree and per-directory responsibilities
- `dev_docs/header.md`, `change_log/header.md`, `remove/header.md` - created by the skill scaffolder (unchanged templates)

## Result
The design docs are in place and consistent with the requirements discussed
in conversation; the scaffold was verified (folders + headers + stubs
created). Follow-up: present the design to the user and obtain agreement
before M1 (data layer) coding starts; confirm the open questions in
`04_roadmap.md` (native checkpoint/branch mapping, hidden-flag semantics).

---

# Architecture pivot: ST-native branch-file storage, rollback = chat switch

- Date: 2026-08-02 02:55:00
- Session: Same conversation; user decision changes the storage model before M1.

## Problem / Requirement
The initial design stored every version inside ONE chat file as hidden anchor
messages. The user rejected this: it would clutter ST's own chat management,
bloat files, and fight the native chat system. The user's decision:

1. Follow ST's native chat-branching: every roll/delete/edit creates a NEW
   session (ST chat file) via the native branch mechanism.
2. The branch/session STRUCTURE is owned by our plugin panel, so ST's own
   chat management stays clean.
3. Rollback is simply switching chats (loading the target branch file).

## Purpose of Change
Align the architecture, data model, roadmap, tech stack, and work tree with
the branch-file model before any code is written, keeping the docs the single
source of truth.

## How It Was Changed
- [D:\stplugin\dev_docs\00_overview.md L66-L124](file:///D:/stplugin/dev_docs/00_overview.md#L66-L124) - v2: goals G2/G3/G5 rewritten around branch files; scope adds panel-owned tree; non-goal drops in-file anchors
- [D:\stplugin\dev_docs\01_architecture.md L110-L305](file:///D:/stplugin/dev_docs/01_architecture.md#L110-L305) - v2: modules mapped to branch/panel model; new Mermaid flows (roll, delete, rollback, rescue, import/export); event surface updated
- [D:\stplugin\dev_docs\02_tech_stack.md L41-L73](file:///D:/stplugin/dev_docs/02_tech_stack.md#L41-L73) - v2: compatibility targets (1.15/1.16 branching, only `chat_metadata.st_floor` added); risks around chat-file APIs
- [D:\stplugin\dev_docs\03_data_model.md L88-L168](file:///D:/stplugin/dev_docs/03_data_model.md#L88-L168) - v2: entities Branch/Floor/BranchMeta/PanelIndex; storage mapping (chat_metadata only); operations table; invariants B1-B7
- [D:\stplugin\dev_docs\04_roadmap.md L42-L78](file:///D:/stplugin/dev_docs/04_roadmap.md#L42-L78) - v2: milestones re-scoped (M1 pure model, M2 ST integration + panel); open questions and risks updated
- [D:\stplugin\dev_docs\05_worktree.md L70-L129](file:///D:/stplugin/dev_docs/05_worktree.md#L70-L129) - v2: canonical tree updated (branches.js, panel-index.js, chat-api.js, branch-panel.js, bundle io)

## Result
All six design docs now describe the branch-file model consistently
(append-only v2 blocks; v1 blocks remain as history). The open question
"map each ST branch file onto the same floor tree, or keep per-file trees"
is resolved in favor of per-file branches + panel-owned tree aggregation.
Next step: user confirmation, then M1 (pure data layer) implementation.

---

# Design v3: snapshot-before-mutation (no auto chat-switch on roll/delete)

- Date: 2026-08-02 02:58:00
- Session: Same conversation; user refines the UX contract before M1.

## Problem / Requirement
The v2 design created a new branch file AND switched the active chat on every
roll/delete. The user rejected the auto-switch: it interrupts normal usage.
Requirement:

1. Roll/delete must FIRST snapshot the current chat into a panel-managed
   backup, then let the native operation proceed IN PLACE (no jump).
2. Rollback stays "switch chat", but only when the user explicitly picks a
   snapshot/branch in the panel.

## Purpose of Change
Update the design so the storage model and UX contract match the
snapshot-before-mutation pattern before any code is written.

## How It Was Changed
- [D:\stplugin\dev_docs\00_overview.md L128-L190](file:///D:/stplugin/dev_docs/00_overview.md#L128-L190) - v3: goals G2/G3 rewritten (snapshot before mutation, no interruption); scope states no auto-switch
- [D:\stplugin\dev_docs\01_architecture.md L309-L422](file:///D:/stplugin/dev_docs/01_architecture.md#L309-L422) - v3: Overview rewritten; module boundaries updated; roll/delete flows now snapshot-then-continue; rollback is user-initiated switch
- [D:\stplugin\dev_docs\03_data_model.md L172-L262](file:///D:/stplugin/dev_docs/03_data_model.md#L172-L262) - v3: Branch gains `kind` (active/snapshot); JSONL examples show snapshot nodes; operations table (snapshot then proceed in place); invariants B1-B9
- [D:\stplugin\dev_docs\04_roadmap.md L82-L124](file:///D:/stplugin/dev_docs/04_roadmap.md#L82-L124) - v3: M1/M2 scoped to snapshot plans + panel adoption; open questions add snapshot retention + snapshot API fallback; risks updated

## Result
All four affected docs carry clean v3 blocks with the snapshot-before-mutation
model; v1/v2 remain as append-only history. The design is ready for user
confirmation, then M1 (pure data layer: snapshot plans, PanelIndex
aggregation, rollback resolution) implementation.

---

# Design v4: plugin panel entry button placement

- Date: 2026-08-02 03:53:00
- Session: Same conversation; user specifies the UI entry point.

## Problem / Requirement
User requirement: the plugin UI entry button must be placed in the
per-message action row, between the Edit (pencil) button and the Message
Actions ("...") button.

## Purpose of Change
Record the UI placement decision and its verified DOM anchors so M2
implements it exactly.

## How It Was Changed
- [D:\stplugin\dev_docs\01_architecture.md L426-L570](file:///D:/stplugin/dev_docs/01_architecture.md#L426-L570) - v4 block: new "UI Placement & Entry Points" section with DOM order verified on local ST 1.18.0 (`public/index.html`), insertion point (`$('.mes_edit').before(...)`), guard/fallback, panel as overlay

## Result
The UI entry point is fixed: plugin button sits left of the pencil
(`.mes_edit`), between pencil and "..." (`.extraMesButtonsHint`), styled as a
standard `.mes_button`. Design is now ready; next step is M1 data-layer
implementation.

---

# M1: pure data layer (branches, PanelIndex, invariants) + tests

- Date: 2026-08-02 03:54:00
- Session: Same conversation; first implementation milestone.

## Problem / Requirement
Implement M1 of the roadmap: the pure JavaScript data layer (no ST runtime
dependency) that supports snapshot plans, PanelIndex aggregation, rollback
resolution, and metadata serialization, with unit tests.

## Purpose of Change
Deliver a testable foundation for the extension before any ST-specific
wiring, so the storage semantics are verified in isolation.

## How It Was Changed
- [D:\stplugin\package.json L1-L10](file:///D:/stplugin/package.json#L1-L10) - project manifest: ESM, `npm test`
- [D:\stplugin\src\model\metadata.js L1-L120](file:///D:/stplugin/src/model/metadata.js#L1-L120) - `chat_metadata.st_floor` schema v3: create/read/write/validate
- [D:\stplugin\src\model\branches.js L1-L100](file:///D:/stplugin/src/model/branches.js#L1-L100) - snapshot plan builder (roll/delete/edit), branch id factory
- [D:\stplugin\src\model\panel-index.js L1-L150](file:///D:/stplugin/src/model/panel-index.js#L1-L150) - derived branch tree: add/build/path/resolve/serialize, orphan detection
- [D:\stplugin\src\model\invariants.js L1-L80](file:///D:/stplugin/src/model/invariants.js#L1-L80) - B2/B6/B7/B8 checkable invariants + meta validation
- [D:\stplugin\tests\model.test.js L1-L130](file:///D:/stplugin/tests/model.test.js#L1-L130) - 9 unit tests (round-trip, plans, tree, invariants)
- [D:\stplugin\tests\fixtures\*.jsonl](file:///D:/stplugin/tests/fixtures/root.jsonl#L1-L3) - branch-file fixtures for future round-trip tests
- `src/manifest.json`, `src/index.js`, `src/style.css`, `README.md`, `.gitignore` - extension skeleton placeholders for M2

## Result
`npm test` passes 9/9. M1 exit criteria met: unit tests green on fixtures, no
ST runtime required. Next: M2 (ST integration + panel: snapshot execution via
chat-file APIs, event hooks, branch tree panel with the entry button placed
per v4 UI decision).

---

# M2: ST integration + branch/snapshot panel

- Date: 2026-08-02 04:10:00
- Session: Same conversation; second implementation milestone.

## Problem / Requirement
Implement M2: snapshot execution against real SillyTavern APIs (no chat
switch), event hooks for roll/delete/edit, the branch tree panel with the
entry button between pencil and "...", and rollback = switch chat.

## Purpose of Change
Turn the M1 data layer into a working extension against SillyTavern 1.18.0.
All ST APIs used were verified against the local install source
(`D:\SillyTavern`).

## How It Was Changed
- [D:\stplugin\src\store\chat-api.js L1-L164](file:///D:/stplugin/src/store/chat-api.js#L1-L164) - snapshot via `saveChat({chatName, withMetadata, chatData, force})` (same primitive as checkpoints); switch via `openCharacterChat`; scan via `/api/characters/chats` + `/api/chats/get`; delete via `/api/chats/delete`; root adoption
- [D:\stplugin\src\store\helpers.js L1-L69](file:///D:/stplugin/src/store/helpers.js#L1-L69) - pure helpers: safe unique snapshot names, chat-list parsing, meta extraction, snapshot dedupe
- [D:\stplugin\src\actions\hooks.js L1-L57](file:///D:/stplugin/src/actions/hooks.js#L1-L57) - capture-phase listeners before ST's bubble handlers: swipe arrows, pencil edit-start, delete, keyboard swipes; synchronous pre-mutation clone
- [D:\stplugin\src\ui\branch-panel.js L1-L84](file:///D:/stplugin/src/ui/branch-panel.js#L1-L84) - overlay panel: tree render, Switch (rollback), Prune (delete snapshot file)
- [D:\stplugin\src\index.js L1-L91](file:///D:/stplugin/src/index.js#L1-L91) - boot: entry button inserted before `.mes_edit` (v4 placement) via MutationObserver, CHAT_LOADED/CHAT_CHANGED refresh, `/floor` slash command
- [D:\stplugin\src\style.css L1-L108](file:///D:/stplugin/src/style.css#L1-L108) - entry button + panel styles
- [D:\stplugin\src\manifest.json L1-L8](file:///D:/stplugin/src/manifest.json#L1-L8) - js/css as strings ("src/index.js", "src/style.css") per ST loader
- [D:\stplugin\tests\helpers.test.js L1-L48](file:///D:/stplugin/tests/helpers.test.js#L1-L48) - 5 new unit tests (name safety/uniqueness, parsing, dedupe)

## Result
`npm test` passes 14/14 (M1 9 + helpers 5). Syntax checks pass; all
ST-facing import paths verified to resolve against the local ST 1.18.0
install. Verified API contract notes are documented in code comments. Next:
install the extension into the local ST to smoke-test in a browser, then M3
(thinking rescue dialog) and M4 (bundle import/export + round-trip).

---

# Install into local SillyTavern + manifest location fix

- Date: 2026-08-02 04:33:00
- Session: Same conversation; user confirmed installation.

## Problem / Requirement
1. Install the extension into `D:\SillyTavern\public\scripts\extensions\
   st-floor-anchor\`.
2. During installation it was discovered that the ST extension loader fetches
   `<ext>/manifest.json` at the extension ROOT (`extensions.js` builds the URL
   `/scripts/extensions/${name}/${manifest.js}` from a root-level manifest),
   so a manifest inside `src/` would never load.

## Purpose of Change
Get the extension into a loadable state in the user's local SillyTavern and
fix the repository layout so installs work out of the box.

## How It Was Changed
- [D:\stplugin\manifest.json L1-L8](file:///D:/stplugin/manifest.json#L1-L8) - moved from `src/manifest.json` to the repository root (loader requirement)
- [D:\stplugin\dev_docs\05_worktree.md L132-L196](file:///D:/stplugin/dev_docs/05_worktree.md#L132-L196) - v3 block: manifest documented at root with loader rationale
- Installed runtime files to `D:\SillyTavern\public\scripts\extensions\st-floor-anchor\` (manifest.json + `src/`), verified layout and manifest content

## Result
Extension is installed at the expected path with the correct structure
(root manifest + `src/`). No tests affected (`npm test` still 14/14). Next:
user starts/refreshes SillyTavern and smoke-tests roll/delete/rollback in the
browser, then M3 (thinking rescue) and M4 (bundle import/export).

---

# Fix: entry button never appeared (slash command crash)

- Date: 2026-08-02 04:40:00
- Session: Same conversation; smoke-test found the button missing.

## Problem / Requirement
The extension appeared in ST's extension list but the entry button between
the pencil and "..." did not render. Root cause: `registerSlashCommand('/floor',
...)` was called at module top-level with a name starting with `/`.
`SlashCommandParser.addCommandObject` rejects names starting with `/` (reserved
characters) and throws `Illegal Name`, aborting index.js before
`ensureEntryButtons()` ever ran.

## Purpose of Change
Make boot failure-proof and reorder initialization so the DOM entry button is
installed before anything that can throw.

## How It Was Changed
- [D:\stplugin\src\index.js L1-L130](file:///D:/stplugin/src/index.js#L1-L130) - command renamed to `floor` (no leading slash); DOM insertion (`observer.observe` + `ensureEntryButtons`) moved before slash registration; whole boot wrapped in try/catch with `[Floor Anchor]` logs; message-render events + one-shot sweep added; `window.__stFloorAnchor` diagnostics handle
- Re-synced `src/index.js` to `D:\SillyTavern\public\scripts\extensions\st-floor-anchor\src\index.js`

## Result
Syntax check passes; install updated. On the next page load the console should
show `[Floor Anchor] booting...`, `[Floor Anchor] inserted N entry button(s)`,
and `[Floor Anchor] loaded (M2: ST integration + panel)`, and the diagram
button appears left of the pencil. Browser console will name the failing
module if imports still break.

---

# Fix: module import errors (saveMetadataDebounced, selected_group)

- Date: 2026-08-02 05:02:00
- Session: Same conversation; headless-browser diagnosis of the missing button.

## Problem / Requirement
The entry button still did not appear. Headless Chrome load of the local ST
page revealed the real failure: the extension module threw at import time -
`The requested module '../../../../../script.js' does not provide an export
named 'saveMetadataDebounced'` - so index.js never executed.

## Purpose of Change
Correct the module import sources to match SillyTavern 1.18.0's actual
export locations.

## How It Was Changed
- [D:\stplugin\src\store\chat-api.js L1-L30](file:///D:/stplugin/src/store/chat-api.js#L1-L30) - `saveMetadataDebounced` imported from `../../../../extensions.js` (it is defined in extensions.js, not script.js); `selected_group` imported from `../../../../group-chats.js` (it is exported from group-chats.js, not script.js)
- Re-synced `chat-api.js` to the installed extension; verified with headless Chrome against the running local ST

## Result
Headless verification: `[Floor Anchor] booting...`, `inserted 1 entry
button(s)`, `loaded (M2: ST integration + panel)` - no console errors, button
inserted into the message action row. User needs a hard refresh (Ctrl+F5) to
pick up the fixed module.

---

# Fix: entry button click not firing (capture-phase pointerup/click delegation)

- Date: 2026-08-02 05:20:00
- Session: Same conversation; user reported button visible but click did nothing.

## Problem / Requirement
The panel toggled correctly via `window.__stFloorAnchor.panel.toggle()`, but
real user clicks on the entry button did nothing. The element-level `click`
listener was not being reached in the real browser (ST pointer handling /
overlays can swallow the synthesized click), while the earlier headless test
used a programmatic `.click()` which bypassed the real input path.

## Purpose of Change
Make the entry-button toggle independent of the element-level click delivery.

## How It Was Changed
- [D:\stplugin\src\index.js L44-L68](file:///D:/stplugin/src/index.js#L44-L68) - removed the button's own click listener; added document-level CAPTURE-phase listeners for both `pointerup` and `click`, filtering by `event.target.closest('.stfloor-entry')`, with a 350ms dedupe window and `preventDefault`/`stopPropagation`
- Re-synced `index.js` to the installed extension

## Result
Headless real-input simulation (pointerdown -> pointerup -> click) toggles the
panel open and closed correctly with dedupe. Covers mouse and touch (Pointer
Events). User hard-refreshes and retests.

---

# Fix: Switch button no-op (file_name vs fileName mismatch in scan)

- Date: 2026-08-02 05:35:00
- Session: Same conversation; user reported branches appear but Switch does nothing.

## Problem / Requirement
Snapshots were created and shown in the panel, but clicking Switch had no
effect. Root cause: `scanBranches` enriched scanned metas with the chat file
name in the camelCase field (`meta.branch.fileName`), while `PanelIndex.add`
re-reads metas via `readBranchMeta`, which expects the serialized snake_case
field `file_name`. The node therefore had `fileName === null`, and the Switch
handler's `if (node.fileName)` guard silently did nothing.

## Purpose of Change
Restore rollback (switch-to-branch) after rescanning chat files.

## How It Was Changed
- [D:\stplugin\src\store\chat-api.js L118-L125](file:///D:/stplugin/src/store/chat-api.js#L118-L125) - scan now writes `meta.branch.file_name` (snake_case) when missing
- [D:\stplugin\src\ui\branch-panel.js L50-L57](file:///D:/stplugin/src/ui/branch-panel.js#L50-L57) - Switch logs a console.warn when a node lacks a file name, instead of failing silently
- Re-synced both files to the installed extension

## Result
`npm test` still 14/14. User hard-refreshes and retests Switch (rollback).

---

# Feature: content-fingerprint dedupe for snapshots

- Date: 2026-08-02 05:50:00
- Session: Same conversation; user reported spurious snapshots when rolling
  while the API is disconnected.

## Problem / Requirement
Clicking roll while the API is disconnected does not change the chat, but a
snapshot was still created - wasted files for identical content. User
proposed a ~99% text-similarity check; chat history is highly static.

## Purpose of Change
Skip snapshot creation when the chat content is unchanged since the last
snapshot of the same parent branch.

## How It Was Changed
- [D:\stplugin\src\store\helpers.js L70-L130](file:///D:/stplugin/src/store/helpers.js#L70-L130) - `computeChatFingerprint` (content fields only: name/is_user/is_system/role/mes/swipes/extra; volatile id/send_date/token counts excluded) with stable key-ordered stringify; `createFingerprintStore` (per-branch fingerprints persisted in localStorage)
- [D:\stplugin\src\store\chat-api.js L65-L85](file:///D:/stplugin/src/store/chat-api.js#L65-L85) - `createSnapshot` compares the fingerprint against the parent branch's last snapshot; identical content returns `{ skipped: true, reason: 'identical-content' }` without writing a file
- [D:\stplugin\src\actions\hooks.js L20-L28](file:///D:/stplugin/src/actions/hooks.js#L20-L28) - logs the skip reason instead of refreshing the panel
- [D:\stplugin\tests\helpers.test.js L55-L80](file:///D:/stplugin/tests/helpers.test.js#L55-L80) - fingerprint tests: volatile metadata ignored, content changes detected, store persists across instances

## Result
`npm test` passes 16/16. Rationale over a similarity threshold: chats are
structured JSON, so exact content-field comparison is more reliable than
text-similarity and never mistakes real small changes for duplicates.

---

# Test cleanup: removed plugin snapshots from local ST data

- Date: 2026-08-02 06:00:00
- Session: Same conversation; user asked to clear existing snapshots for a
  fresh test round.

## Problem / Requirement
User wanted a clean slate: remove the snapshot branch files the plugin had
created during testing (br_202/br_203/br_204, all kind=snapshot reason=roll
under the default_Seraphina character).

## Purpose of Change
Reset the test environment without touching the current main chat file.

## How It Was Changed
- Moved `Seraphina ... - roll ... br_202/203/204.jsonl` from
  `D:\SillyTavern\data\default-user\chats\default_Seraphina\` to
  `D:\SillyTavern\data\default-user\_stfloor_removed_2026-08-02\` (recoverable
  backup, not deleted)
- Verified headers (kind=snapshot) before moving; the main chat file remains
- User clears `stfloor.last_snapshot_fingerprints` and `stfloor.next_branch_id`
  in browser localStorage for a clean test

## Result
Character chat directory now contains only the main chat file. Panel should
show a single root branch after refresh; fresh roll/delete tests will create
new snapshots from a clean state.

---

# Fix: delete snapshots skipped by fingerprint dedupe (per-reason keys)

- Date: 2026-08-02 06:15:00
- Session: Same conversation; user reported no new branch after deleting a
  message.

## Problem / Requirement
Deleting a message did not create a snapshot. Root cause: the content
fingerprint dedupe stored one fingerprint per parent branch, so when the
pre-delete content happened to match the last roll snapshot's content, the
delete was wrongly skipped as "identical content". A delete/edit is a
distinct user intent even if the content matches an earlier snapshot.

## Purpose of Change
Scope fingerprint dedupe per (branch, reason) so roll-failure dedupe does not
suppress legitimate delete/edit snapshots.

## How It Was Changed
- [D:\stplugin\src\store\chat-api.js L90-L121](file:///D:/stplugin/src/store/chat-api.js#L90-L121) - fingerprint key now `${parent.branch.id}:${reason}` (get + set)
- [D:\stplugin\tests\helpers.test.js L74-L82](file:///D:/stplugin/tests/helpers.test.js#L74-L82) - fingerprint-store test covers per-reason keys (roll present, delete absent)
- Re-synced `chat-api.js` to the installed extension

## Result
`npm test` passes 16/16. Delete/edit snapshots now create regardless of roll
dedupe history; roll dedupe still skips unchanged-content rolls (API
disconnected case).

---

# Feature: automatic branch ids + one-click "clear snapshots" (UX)

- Date: 2026-08-02 06:30:00
- Session: Same conversation; user asked to automate the reset/cleanup flow.

## Problem / Requirement
Resetting branch numbering required manual localStorage edits and a server
restart, which is bad UX. Branch ids should be derived from reality (existing
files), and clearing snapshots should be a panel button.

## Purpose of Change
Remove manual reset steps: ids auto-continue from the highest observed id,
and the panel can wipe all snapshots (files + fingerprint history) in one
click.

## How It Was Changed
- [D:\stplugin\src\store\helpers.js L110-L170](file:///D:/stplugin/src/store/helpers.js#L110-L170) - `createFingerprintStore` gains `clear()`; new `createBranchIdTracker` (auto-advance from tracked max, no localStorage dependency)
- [D:\stplugin\src\store\chat-api.js L32-L200](file:///D:/stplugin/src/store/chat-api.js#L32-L200) - id generation now uses the tracker (root/adopt/scan/snapshot all track observed ids); new `clearAllSnapshots()` deletes every snapshot file of the character and clears fingerprints
- [D:\stplugin\src\ui\branch-panel.js L10-L25](file:///D:/stplugin/src/ui/branch-panel.js#L10-L25) - "Clear snapshots" button in the panel header
- [D:\stplugin\src\index.js L25-L40](file:///D:/stplugin/src/index.js#L25-L40) - wired `onClearAll` with confirm + toastr feedback
- [D:\stplugin\tests\helpers.test.js L84-L102](file:///D:/stplugin/tests/helpers.test.js#L84-L102) - tests for fingerprint clear and the branch id tracker
- All four files synced to the installed extension

## Result
`npm test` passes 17/17. Branch ids are now stable without localStorage
(root br_200 -> next snapshot br_201 automatically). The panel's "Clear
snapshots" button removes all backups and resets dedupe in one click; the
current chat is never touched.

---

# Fix: delete-mode ("..." menu) snapshot hook

- Date: 2026-08-02 07:20:00
- Session: Same conversation; user reported no snapshot after deleting a
  message.

## Problem / Requirement
Deleting a message still did not create a snapshot. Root cause: the only
delete hook was `.mes_edit_delete` (the delete button inside the edit
popup). The normal ST path -- "..." menu -> Delete message -> select a
floor -> confirm with `#dialogue_del_mes_ok` -- truncates `chat` in a
bubble-phase handler that was never captured, so no pre-mutation snapshot
was ever taken.

## Purpose of Change
Capture the delete-mode confirm button in the capture phase so a snapshot of
the intact chat is written before ST truncates `chat.length` at the selected
floor.

## How It Was Changed
- [D:\stplugin\src\actions\hooks.js L61-L76](file:///D:/stplugin/src/actions/hooks.js#L61-L76) - new capture-phase click listener on `#dialogue_del_mes_ok`; derives the source floor from the first checked `.del_checkbox` (topmost selected message) and only snapshots when something is actually selected, so an accidental OK with no selection creates no snapshot
- Re-synced `hooks.js` to the installed extension and ran `node --check`

## Result
`npm test` passes 17/17 (regression suite). Manual browser verification is
left to the user: hard-refresh, then "..." menu -> Delete message -> pick a
floor -> OK; console should log `[Floor Anchor] snapshot trigger: delete`
and the panel should gain a new `br_2xx` snapshot branch. Known gap: the
edit-popup delete button snapshots at click time (before the confirmation
popup), so cancelling that popup still leaves one snapshot; the automatic
`deleteLastMessage()` cleanup (empty tool-call message) is not hooked.

---

# Feature: snapshots hidden from ST's native chat list ([FA] marker + fetch filter)

- Date: 2026-08-02 06:31:00
- Session: Same conversation; user reported that panel backups still appear
  in ST's native chat records and worried the built-in chat manager becomes
  cluttered.

## Problem / Requirement
Snapshots are saved as ordinary ST chat files, so they show up in ST's own
chat list / recent chats / search, defeating the original requirement that
backups live only in our panel and never clutter ST's chat management. ST
1.18 has no server-side "hidden" flag, and `/api/chats/save` refuses to write
outside the chats directory, so files must stay there but be filtered out of
the management UI.

## Purpose of Change
Make snapshots invisible to ST's native chat manager while keeping them as
real, durable, exportable chat files:
- every snapshot file name now embeds the marker `[FA]`;
- a client-side `window.fetch` patch strips marker entries (plus the id of a
  currently-open legacy snapshot) from `/api/characters/chats`,
  `/api/chats/recent` and `/api/chats/search` responses;
- the plugin's own scans opt out via `X-StFloor-Internal: 1`;
- legacy unmarked snapshots are migrated by rename when not active; the
  open one is hidden by id and renamed after the user leaves it (renaming an
  open chat races with ST's own saves and recreates the old name);
- duplicate branch ids (stale saves) are deduped at scan time.

## How It Was Changed
- [D:\stplugin\src\store\helpers.js L15-L90](file:///D:/stplugin/src/store/helpers.js#L15-L90) - `SNAPSHOT_FILE_MARKER = '[FA]'`, `isSnapshotFileName`, `filterChatListPayload` (pure, custom-predicate support); snapshot names now embed the marker
- [D:\stplugin\src\store\list-filter.js L1-L95](file:///D:/stplugin/src/store/list-filter.js#L1-L95) - new module: `installChatListFilter` (fetch patch), `setActiveSnapshotFileName`, hidden-entry predicate (marker + active legacy id)
- [D:\stplugin\src\store\chat-api.js L41-L260](file:///D:/stplugin/src/store/chat-api.js#L41-L260) - internal header on scan/clear fetches; authoritative `file_name` from the file list; legacy-name migration with collision handling (same-branch duplicate removal); defensive duplicate-branch-id dedupe
- [D:\stplugin\src\index.js L16-L170](file:///D:/stplugin/src/index.js#L16-L170) - install fetch filter at boot; `syncActiveSnapshot()` on `chat_loaded`/`chat_changed` (no blind reset, ST fires CHANGED right after LOADED); diagnostics expose `chatListFilter`
- [D:\stplugin\tests\helpers.test.js L32-L80](file:///D:/stplugin/tests/helpers.test.js#L32-L80) - marker detection + list-filter tests (incl. custom predicate)
- Data repair: the earlier active-chat rename test raced with ST's save and
  left a 1 KB stub `br_202.jsonl` carrying root metadata; the real snapshot
  content was restored into that file (kept under the character's chat
  field), and the marker-named `br_202 [FA]` remains the canonical copy.

## Result
`npm test` passes 20/20. Headless Chrome end-to-end check against the local
ST 1.18.0 server: with Seraphina open on a legacy snapshot, the ST-native
list shows ONLY the main chat (marker snapshots + active legacy id all
hidden), the internal scan still sees every file, the character chat field
is untouched while active, and there are no runtime exceptions. All changed
files synced to the installed extension. Follow-up: user hard-refreshes
(Ctrl+Shift+R) and confirms the ST chat list stays clean while the panel
still shows the full branch tree; new snapshots now start with names like
`Seraphina - [FA] roll 2026-08-02-... br_201`.

---

# Feature: branch preview text in the panel (last message body)

- Date: 2026-08-02 06:45:00
- Session: Same conversation; user asked to show the first few characters of
  the chat body on each branch node (root/roll/switch rows) so it is obvious
  at a glance which conversation a branch belongs to.

## Problem / Requirement
Panel rows only showed `br_200 root`, `br_201 roll` etc. With many backups it
is hard to tell which conversation moment a branch represents.

## Purpose of Change
Show a short text preview (last non-empty message body, truncated) between
the branch label and the Switch button on every node.

## How It Was Changed
- [D:\stplugin\src\store\helpers.js L92-L124](file:///D:/stplugin/src/store/helpers.js#L92-L124) - new pure `computeChatPreview(chatArray, maxLength=16)`: walks messages backward, uses `mes` with `display_text`/`reasoning` fallbacks (tool calls, truncated thinking), collapses whitespace, truncates with an ellipsis
- [D:\stplugin\src\store\chat-api.js L170-L175](file:///D:/stplugin/src/store/chat-api.js#L170-L175) - scanBranches attaches `meta.preview` (derived display data, never persisted into chat_metadata)
- [D:\stplugin\src\model\panel-index.js L35-L45](file:///D:/stplugin/src/model/panel-index.js#L35-L45) - PanelIndex nodes carry `preview`; toJSON/fromJSON round-trip it
- [D:\stplugin\src\ui\branch-panel.js L54-L60](file:///D:/stplugin/src/ui/branch-panel.js#L54-L60) - render `.stfloor-node-preview` between label and actions (Switch/Prune), hover title shows the full preview
- [D:\stplugin\src\style.css L98-L110](file:///D:/stplugin/src/style.css#L98-L110) - muted, ellipsized preview styling (max-width 150px)
- [D:\stplugin\tests\helpers.test.js L87-L107](file:///D:/stplugin/tests/helpers.test.js#L87-L107) - preview unit tests (last message, fallbacks, whitespace, truncation)
- [D:\stplugin\tests\model.test.js L72-L105](file:///D:/stplugin/tests/model.test.js#L72-L105) - preview flows through PanelIndex.build and serialization round-trip

## Result
`npm test` passes 22/22. Headless Chrome check against the local ST server:
panel rows for br_200/br_201/br_202 all show non-empty preview text
(e.g. `oh... where is..…`), no runtime exceptions. All files synced to the
installed extension; user hard-refreshes to see it.

---

# Fix: branch preview showed the reasoning chain instead of 正文

- Date: 2026-08-02 07:05:00
- Session: Same conversation; user reported the panel preview displays the
  chain-of-thought structure rather than the conversation body.

## Problem / Requirement
The preview feature added earlier picked the last non-empty message with a
`mes` -> `display_text` -> `reasoning` fallback. During streaming (or a
truncated generation) the last message has an empty body and a huge
`extra.reasoning` (chain of thought), so the preview showed the thinking
chain. The character's dream-protocol replies also start with `<dream_plot>`
XML, which reads as structure, not 正文.

## Purpose of Change
Make the preview show real conversation body text only:
- never fall back to `extra.reasoning`; thinking-only messages are skipped in
  favour of the previous real message;
- strip XML/HTML comments and tags from the preview text so protocol
  envelopes (e.g. `<dream_plot>`) do not dominate the label.

## How It Was Changed
- [D:\stplugin\src\store\helpers.js L96-L138](file:///D:/stplugin/src/store/helpers.js#L96-L138) - `pickPreviewText` now considers only `mes`/`display_text`; new `stripMarkup` removes `<!-- -->` comments and `<...>` tags before collapsing/truncating
- [D:\stplugin\tests\helpers.test.js L92-L124](file:///D:/stplugin/tests/helpers.test.js#L92-L124) - tests assert reasoning is never shown, thinking-only messages are skipped, and markup is stripped (dream-plot fixture)
- Re-synced `helpers.js` to the installed extension

## Result
`npm test` passes 23/23. Headless Chrome check: br_202 preview changed from
`<dream_plot> <dr…` to `2012 年 4 月 10 日 …` (real scene text from inside
the XML), br_200/br_201 show `oh... where is..…`, no runtime exceptions.
Note: while a generation is streaming, the in-progress thinking-only message
is naturally skipped and the preview shows the previous stable message.

---

# Fix: preview should also ignore preset-generated status bars (dream_scene etc.)

- Date: 2026-08-02 07:12:00
- Session: Same conversation; user asked the preview to additionally ignore
  the status-bar content produced by the preset.

## Problem / Requirement
After excluding reasoning, the preview still started with the preset's
status bar: `<dream_scene>` (date/time/location), e.g. `2012 年 4 月 10 日 …`.
The preset also emits `<dream_summary>` / `<dream_done/>` metadata that
should never appear in a branch label.

## Purpose of Change
Remove preset-generated metadata blocks WITH their inner text so the preview
starts at the actual narrative 正文.

## How It Was Changed
- [D:\stplugin\src\store\helpers.js L108-L138](file:///D:/stplugin/src/store/helpers.js#L108-L138) - `stripMarkup` now deletes whole blocks for `dream_scene`, `dream_summary`, `dream_after_format`, `dream_meta`, `date`, `time`, `location` and self-closing `<dream_done/>` before the generic tag/comment pass; narrative containers (`dream_body`, `dream_plot`) keep their inner text
- [D:\stplugin\tests\helpers.test.js L124-L140](file:///D:/stplugin/tests/helpers.test.js#L124-L140) - tests: status-bar block removed, only-status-bar message falls back to the previous message
- Re-synced `helpers.js` to the installed extension

## Result
`npm test` passes 24/24. Headless Chrome check: br_202 preview now reads
`"这是哪……"我嗓子干得像砂纸，…` (narrative text after the scene bar was
dropped), br_200/br_201 unchanged, no runtime exceptions.

---

# Feature: 30-char scrolling preview + configurable filter tags in the extensions panel

- Date: 2026-08-02 07:30:00
- Session: Same conversation; user asked to show the first 30 characters
  with a scrolling display, and to provide a section in ST's extensions
  panel (the "three cubes" icon) for configuring which preset tags
  (status bars / thinking chains) are ignored in previews.

## Problem / Requirement
The preview was truncated at 16 characters with a static ellipsis, and the
filtered tags (dream_scene, dream_summary, ...) were hard-coded. Different
presets emit different status-bar / thinking tags, so they must be
configurable without editing code.

## Purpose of Change
- Preview shows the first 30 characters and scrolls (CSS marquee) when long,
  so the label is readable at a glance without a fixed ellipsis cut.
- New settings section "Floor Anchor" inside ST's extensions panel
  (#extensions_settings): preview length (5-100) and a comma-separated list
  of XML tag names whose whole content is removed from previews.
- Settings persist via ST's `extension_settings.stfloor`
  (saveSettingsDebounced), shared with the server-side settings.json.

## How It Was Changed
- [D:\stplugin\src\settings.js L1-L120](file:///D:/stplugin/src/settings.js#L1-L120) - new module: normalized `getStFloorSettings` / `saveStFloorSettings` (extension_settings.stfloor), `registerSettingsPanel` renders an inline-drawer into #extensions_settings and wires live apply + refresh
- [D:\stplugin\src\store\helpers.js L98-L155](file:///D:/stplugin/src/store/helpers.js#L98-L155) - `computeChatPreview` default maxLength 30; `DEFAULT_FILTER_BLOCKS` exported; custom `filterBlocks` merged/normalised (angle brackets, case, safe chars); `stripMarkup(text, blocks)`
- [D:\stplugin\src\store\chat-api.js L154-L172](file:///D:/stplugin/src/store/chat-api.js#L154-L172) - scanBranches passes settings into `computeChatPreview`
- [D:\stplugin\src\index.js L18-L142](file:///D:/stplugin/src/index.js#L18-L142) - registers the settings panel at boot; diagnostics expose `window.__stFloorAnchor.settings.get/save`
- [D:\stplugin\src\ui\branch-panel.js L60-L70](file:///D:/stplugin/src/ui/branch-panel.js#L60-L70) - preview wrapped in `.stfloor-node-preview-inner`; marquee class when longer than 16 chars
- [D:\stplugin\src\style.css L109-L128](file:///D:/stplugin/src/style.css#L109-L128) - marquee keyframes (10s linear infinite, paused on hover), wider preview box (190px)
- [D:\stplugin\tests\helpers.test.js L126-L140](file:///D:/stplugin/tests/helpers.test.js#L126-L140) - default 30-char truncation + custom filter-block tests (incl. angle-bracket/case normalisation)

## Result
`npm test` passes 25/25. Headless Chrome check: settings panel exists with
defaults (length 30, default tag list); previews show ~30 chars with the
marquee class; changing the length to 8 immediately shortens previews and
persists to the server settings (later restored to 30). Reasoning is still
always ignored. All files synced to the installed extension.

---

# Fix: preview layout alignment + marquee shows partial text ("xxx...")

- Date: 2026-08-02 07:45:00
- Session: Same conversation; user reported br_202's row not aligned with the
  others (text compressed), and the box showing "xxx..." instead of the first
  30 characters.

## Problem / Requirement
Two layout defects:
1. `.stfloor-node-preview` used `flex: 0 1 auto; max-width: 190px`, so longer
   previews (br_202) shrank more than short ones - rows misaligned and text
   compressed/cut.
2. The marquee used `padding-left: 100%` + a one-way translate, pushing the
   text off-screen at rest; combined with the `…` suffix appended at 30 chars,
   the box showed a meaningless tail slice ("xxx...") instead of the start.

## Purpose of Change
- Fixed-width preview box (180px, flex 0 0) for uniform rows.
- Text is left-anchored: it starts at the beginning, and long text scrolls
  back and forth (ping-pong alternate), revealing all 30 characters while
  always returning to the start.
- Removed the `…` suffix so the preview is exactly the first N characters.

## How It Was Changed
- [D:\stplugin\src\style.css L88-L130](file:///D:/stplugin/src/style.css#L88-L130) - `.stfloor-node-preview` fixed `flex: 0 0 180px; width: 180px`; label `min-width: 0`; marquee keyframes become `translateX(0)` -> `translateX(calc(-100% + 174px))` with `infinite alternate`; hover pause removed
- [D:\stplugin\src\store\helpers.js L98-L120](file:///D:/stplugin/src/store/helpers.js#L98-L120) - truncation no longer appends `…` (preview is exactly the first maxLength chars)
- [D:\stplugin\tests\helpers.test.js L78-L140](file:///D:/stplugin/tests/helpers.test.js#L78-L140) - truncation assertions updated (no ellipsis suffix)

## Result
`npm test` passes 25/25. Headless Chrome check: all three rows now measure
180px wide / 26px high (uniform), marquee starts at translateX(0) (beginning
visible) and alternates; previews contain exactly the first 30 characters
(no `…`). Files synced to the installed extension.

---

# Fix: marquee only on real overflow, edge-anchored scroll, content-sized box

- Date: 2026-08-02 08:00:00
- Session: Same conversation; user asked that scrolling only happen when the
  text exceeds the area, that the scroll range be bounded by the box edges
  (left shows the start, right shows the end), and that the area size adapts
  to the content.

## Problem / Requirement
The previous implementation enabled the marquee by a character-count
heuristic (>16 chars) and used a fixed 180px box, so short previews were
static-but-wide and borderline texts could scroll unnecessarily. Measuring
inside a hidden panel (display:none) returned zero sizes, so every row got
the marquee with a bogus -7px distance.

## Purpose of Change
- Marquee is enabled only when the measured text width actually exceeds the
  box content width (2px tolerance against sub-pixel noise).
- Scroll range is anchored to both box edges: translateX(0) pins the text
  start at the left boundary; the final keyframe pins the text end at the
  right boundary (negative --stfloor-scroll-distance, no blank overscroll).
- The preview box is content-sized (flex 0 0 auto) up to a 180px cap, so
  short texts squeeze the box instead of leaving empty space.
- Measurements run after the panel becomes visible (requestAnimationFrame +
  150ms settle) and are idempotent (no animation restarts on re-measure).

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L25-L75](file:///D:/stplugin/src/ui/branch-panel.js#L25-L75) - new `applyPreviewScroll()` measures `box.clientWidth - 7` vs `inner.scrollWidth` (tolerance -2), sets/clears `.stfloor-marquee` and `--stfloor-scroll-distance`; called after render and on show (rAF + 150ms settle)
- [D:\stplugin\src\style.css L98-L130](file:///D:/stplugin/src/style.css#L98-L130) - `.stfloor-node-preview` becomes `flex: 0 0 auto; max-width: 180px`; keyframes end at `translateX(var(--stfloor-scroll-distance, -120px))`

## Result
`npm test` passes 25/25 (no data-layer change). Headless Chrome check:
br_202 (312px text) keeps box at 180px and scrolls (dist=-140px);
br_200/br_201 (77px text) squeeze their boxes to 84px and do NOT scroll.
Files synced to the installed extension.

---

# Fix: preview box hugs the fully-displayed branch label

- Date: 2026-08-02 08:15:00
- Session: Same conversation; user asked that the preview area's left edge
  sit flush against the branch label, and that the label always be fully
  displayed (never truncated).

## Problem / Requirement
The label had `flex: 1` (stretched), so short labels left a large empty gap
between the label text and the preview box, and long labels could ellipsize.
The preview also carried a left border + padding that increased the visual
gap.

## Purpose of Change
- Label is content-sized and never truncated (`flex: 0 0 auto; nowrap`).
- Preview box starts immediately after the label (only the 4px row gap, no
  border/padding), and the panel is widened 400 -> 470px so label + preview
  (up to 180px) + buttons always fit on one line.
- A flexible spacer sits between the preview and the actions so Switch/Prune
  stay right-aligned.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L78-L96](file:///D:/stplugin/src/ui/branch-panel.js#L78-L96) - row order becomes label, preview, spacer, actions; measurement uses `box.clientWidth - inner.scrollWidth` (border/padding removed)
- [D:\stplugin\src\style.css L45-L115](file:///D:/stplugin/src/style.css#L45-L115) - panel width 470px; row gap 4px; `.stfloor-node-label` `flex: 0 0 auto` + nowrap (full display); `.stfloor-node-preview` loses border-left/padding-left, `flex: 0 1 auto; min-width: 40px; max-width: 180px`; new `.stfloor-node-spacer`

## Result
`npm test` passes 25/25. Headless Chrome check: all labels fully rendered
(no ellipsis); preview left edge is 4px from the label right edge; rows fit
the 470px panel; br_202 still scrolls (180px) and br_200/br_201 stay static
(77px). Files synced to the installed extension.

---

# Fix: vertical divider lines on both sides of the preview text area

- Date: 2026-08-02 08:30:00
- Session: Same conversation; user asked for breathing room around the
  preview text and vertical divider lines separating it from the branch
  label on the left and the action buttons on the right.

## Problem / Requirement
The preview text sat too close to the label and the buttons with no visual
separation.

## Purpose of Change
Add 1px vertical lines on both sides of the preview box with generous
padding/margins: label --(gap)-- | --(8px)-- text --(8px)-- | --(gap)--
buttons.

## How It Was Changed
- [D:\stplugin\src\style.css L98-L120](file:///D:/stplugin/src/style.css#L98-L120) - `.stfloor-node-preview` gains `border-left/right: 1px`, `padding: 0 8px`, `margin: 0 6px`
- [D:\stplugin\src\ui\branch-panel.js L38-L44](file:///D:/stplugin/src/ui/branch-panel.js#L38-L44) - marquee content width now subtracts both borders + padding (clientWidth - 18)

## Result
`npm test` passes 25/25. Headless Chrome check: left/right borders are 1px,
label-to-line gap 10px, line-to-buttons gap 45-156px (spacer); br_202 still
scrolls (180px box, dist=-152px), br_200/br_201 static (95px box). Files
synced to the installed extension.

---

# Fix: right divider line now hugs the action buttons (symmetric with the left)

- Date: 2026-08-02 08:45:00
- Session: Same conversation; user reported the right vertical line was not
  close to the buttons the way the left vertical line is close to the label.

## Problem / Requirement
The flexible spacer sat between the preview box and the action buttons, so
the right divider line floated 45-156px away from the buttons while the left
line stayed 10px from the label - asymmetric.

## Purpose of Change
Anchor both divider lines to their neighbours: the preview box now grows
(flex 1 1 auto) to fill the space between the label and the buttons, so the
left line is ~10px from the label and the right line is ~10px from the
buttons, while the buttons stay right-aligned across all rows.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L78-L90](file:///D:/stplugin/src/ui/branch-panel.js#L78-L90) - removed the spacer element; row is now label + preview + actions
- [D:\stplugin\src\style.css L98-L115](file:///D:/stplugin/src/style.css#L98-L115) - `.stfloor-node-preview` becomes `flex: 1 1 auto; min-width: 60px` (fills the middle, no max cap); `.stfloor-node-spacer` removed

## Result
`npm test` passes 25/25. Headless Chrome check: left and right gaps are both
10px on every row; action buttons right edge is identical (1224px) across
rows; br_202 (312px text) still scrolls in its 240px box, br_200/br_201 do
not scroll. Files synced to the installed extension.

---

# Fix: action buttons no longer stack vertically (priority + no shrink)

- Date: 2026-08-02 09:00:00
- Session: Same conversation; user reported br_202's Switch/Prune buttons
  wrapped into a vertical stack because the row did not prioritise the
  right-side buttons.

## Problem / Requirement
`.stfloor-node-actions` was a plain span, so as a flex item it defaulted to
`flex: 0 1 auto` (shrinkable). When br_202's row overflowed (label 104px +
preview text 312px + buttons), the flex shrink was distributed across the
preview AND the actions container; the actions shrank below the combined
button width (~90px) and the two inline-block buttons wrapped to separate
lines. br_201/br_200 rows did not overflow, so they looked fine.

## Purpose of Change
Give the action buttons layout priority: the container never shrinks and the
buttons are laid out in their own non-wrapping flex row, so all overflow is
absorbed by the preview area (which scrolls).

## How It Was Changed
- [D:\stplugin\src\style.css L128-L138](file:///D:/stplugin/src/style.css#L128-L138) - new `.stfloor-node-actions`: `flex: 0 0 auto; display: flex; align-items: center; gap: 4px; white-space: nowrap;`

## Result
`npm test` passes 25/25. Headless Chrome check (default and 100-char
previews): all rows keep Switch/Prune side-by-side at the same x (1131),
br_202 preview shrinks to 211px instead of squeezing the buttons. Files
synced to the installed extension.

---

# Feature: prune confirmation as a custom secondary panel

- Date: 2026-08-02 09:15:00
- Session: Same conversation; user specified the layout of the Prune
  confirmation dialog: small subtle confirm button on top, the question in
  the middle, and a large red-white Cancel button at the bottom.

## Problem / Requirement
Prune used the native `window.confirm`, which is ugly and out of style.

## Purpose of Change
Replace it with a custom modal (overlay + panel): top = small "确认删除"
button whose background is close to the panel color with gray text
(de-emphasised destructive action); middle = "是否确认删除 <branch>？";
bottom = full-width, large red-background white-text "取消" button that is
the prominent escape route. Closes on Cancel, Escape, or overlay click.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L95-L130](file:///D:/stplugin/src/ui/branch-panel.js#L95-L130) - new `showPruneConfirm(branchId, fileName)` builds the overlay/panel, wires Confirm (calls onDelete), Cancel, Escape and overlay-click close; Prune button now opens it
- [D:\stplugin\src\style.css L138-L210](file:///D:/stplugin/src/style.css#L138-L210) - `.stfloor-confirm-overlay` (fixed, z-index 2147483100), `.stfloor-confirm-panel`, subtle `.stfloor-confirm-yes` (11px, #999, rgba white 0.05), `.stfloor-confirm-text`, prominent `.stfloor-confirm-cancel` (16px white on #d93025, full width)
- [D:\stplugin\src\index.js L28-L33](file:///D:/stplugin/src/index.js#L28-L33) - `onDelete` no longer shows `window.confirm` (confirmation moved into the panel)

## Result
`npm test` passes 25/25. Headless Chrome check: modal opens on Prune with
the exact child order [yes, text, cancel]; yes = 11px gray (#999) on subtle
background (62x22); cancel = 16px white on red #d93025 (290x44); text reads
"是否确认删除 br_201？"; Cancel closes the modal and the file survives. All
files synced to the installed extension.

---

# Fix: confirmation modal could render outside the viewport

- Date: 2026-08-02 09:30:00
- Session: Same conversation; user reported the secondary confirmation
  window appeared outside the browser window.

## Problem / Requirement
The overlay used `inset: 0` alone. On small/narrow viewports the overlay
measured 0px high (fixed positioning collapsed), so the centered panel was
placed half outside the top of the window (e.g. y=-72 at 480x360).

## Purpose of Change
Guarantee the overlay always fills the visual viewport and the panel always
fits inside it:
- explicit top/left/right/bottom offsets plus `width: 100vw; height: 100vh`;
- panel constrained to `max-width/max-height: calc(100vw/100vh - 32px)` with
  vertical overflow scrolling as a last resort.

## How It Was Changed
- [D:\stplugin\src\style.css L138-L175](file:///D:/stplugin/src/style.css#L138-L175) - `.stfloor-confirm-overlay` gains explicit offsets + 100vw/100vh; `.stfloor-confirm-panel` gains viewport-constrained max sizes and `overflow-y: auto`

## Result
`npm test` passes 25/25. Headless Chrome check at 1280x900, after scrolling,
and at 480x360: overlay fills the viewport (480x360, no longer 0-height) and
the panel is fully inside in every case. Files synced to the installed
extension.

---

# Feature: two-step prune confirmation (second confirm = final delete)

- Date: 2026-08-02 09:45:00
- Session: Same conversation; user asked that clicking the first
  "确认删除" open a second confirmation, and only the second confirmation
  performs the actual deletion.

## Problem / Requirement
The single confirm button deleted immediately; the user wanted an extra
safety step.

## Purpose of Change
Two-step modal:
- Step 1 (unchanged): small subtle "确认删除" / question / big red "取消".
- Step 2: small subtle "返回" (back to step 1) / "再次确认：删除
  <branch> 后无法恢复，确定最终删除？" / big red "最终删除".
- Only the "最终删除" button in step 2 calls onDelete. Escape / overlay
  click still cancel at any step.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L100-L145](file:///D:/stplugin/src/ui/branch-panel.js#L100-L145) - `showPruneConfirm` now renders two steps via `renderStep(1|2)`; step 2 wires "最终删除" to `onDelete`
- [D:\stplugin\src\style.css L188-L210](file:///D:/stplugin/src/style.css#L188-L210) - `.stfloor-confirm-final` shares the big red-white style with `.stfloor-confirm-cancel`

## Result
`npm test` passes 25/25. Headless Chrome check: step1 -> step2 (返回 /
再次确认… / 最终删除, red 290x44) -> back to step1 -> step2 again; first
confirm deletes nothing; final click fires the delete API request, closes the
modal, and (with an intercepted fetch) leaves the file intact. Files synced
to the installed extension.

---

# Fix: confirmation button roles per spec (red = Cancel, top-right = Confirm delete)

- Date: 2026-08-02 10:00:00
- Session: Same conversation; user clarified the button logic: the big red
  button must ALWAYS be "取消", and the top-right button must always be
  "确认删除" (in the second step it performs the final deletion).

## Problem / Requirement
Step 2 had "返回" on top and a red "最终删除" at the bottom, which inverted
the intended roles.

## Purpose of Change
Both steps share the same button roles:
- top-right: small subtle "确认删除" (step 2 click = final delete);
- bottom: big red-white "取消" (always, closes the modal).
The second step only differs in the middle text (second confirmation).

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L115-L140](file:///D:/stplugin/src/ui/branch-panel.js#L115-L140) - step 2 renders "确认删除" on top (wired to `onDelete`) and "取消" at the bottom (closes); "返回"/"最终删除" removed
- [D:\stplugin\src\style.css L188-L205](file:///D:/stplugin/src/style.css#L188-L205) - `.stfloor-confirm-final` removed; red style stays on `.stfloor-confirm-cancel` only

## Result
`npm test` passes 25/25. Headless Chrome check: step1 and step2 both render
[确认删除, text, 取消] with the red cancel (rgb(217,48,37)); first confirm
keeps the modal open without deleting; step-2 cancel closes without deleting;
step-2 top "确认删除" fires the delete request (intercepted, file intact).
Files synced to the installed extension.

---

# Fix: second-step confirm moves to the top-LEFT corner (anti-muscle-memory)

- Date: 2026-08-02 10:15:00
- Session: Same conversation; user suggested moving the final delete button
  to the top-left during the second confirmation so habitual clicks on the
  top-right spot cannot accidentally confirm.

## Problem / Requirement
Both steps placed "确认删除" at the top-right, so a user clicking out of
habit on the second step could still trigger the final delete.

## Purpose of Change
Step 2 renders the confirm button with `stfloor-confirm-yes-left`
(`align-self: flex-start`), moving it to the top-left corner. The red
"取消" stays at the bottom in both steps.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L120-L124](file:///D:/stplugin/src/ui/branch-panel.js#L120-L124) - step 2's confirm button gets the `stfloor-confirm-yes-left` class (title notes the moved position)
- [D:\stplugin\src\style.css L166-L172](file:///D:/stplugin/src/style.css#L166-L172) - `.stfloor-confirm-yes-left { align-self: flex-start; }`

## Result
`npm test` passes 25/25. Headless Chrome check: step 1 confirm is top-right
(left offset 243px / right offset 15px); step 2 confirm is top-left
(left offset 15px / right offset 243px); cancel still closes. Files synced
to the installed extension.

---

# Feature: automatic branch renumbering after prune

- Date: 2026-08-02 10:30:00
- Session: Same conversation; user asked that deleting a snapshot also
  adjusts the branch numbers (200/201/202, delete 201 -> former 202 becomes
  201).

## Problem / Requirement
Pruning a snapshot left numeric gaps in the branch ids, and id generation
kept counting from the stale max, so numbers drifted.

## Purpose of Change
After a prune, compact all remaining snapshot ids sequentially from the root
(kind=active) upward. This both closes the gap left by the deleted branch and
repairs any pre-existing holes:
- ids 200 (root), 202, 203; prune 202 -> br_203 becomes br_201;
- each affected file is re-saved under its new name with rewritten
  `chat_metadata.st_floor.branch.id` / `parent` (children of the deleted
  branch are re-parented to the deleted branch's parent), then the old file
  is deleted;
- the branch id tracker is reset to the new max, so the next snapshot
  continues from the compacted number.

## How It Was Changed
- [D:\stplugin\src\model\branches.js L83-L135](file:///D:/stplugin/src/model/branches.js#L83-L135) - new pure `planRenumberAfterDelete(metas, deletedBranchId, deletedParentId)` (sequential compaction, parent remap/re-parent, maxId)
- [D:\stplugin\src\store\chat-api.js L120-L175](file:///D:/stplugin/src/store/chat-api.js#L120-L175) - `fetchAllBranchMetas` extracted from scanBranches; new `renumberSnapshotsAfterPrune` executes the plan (save-new-then-delete-old, updates the character chat field if the renamed file is the open chat, resets branch ids)
- [D:\stplugin\src\store\helpers.js L150-L165](file:///D:/stplugin/src/store/helpers.js#L150-L165) - `createBranchIdTracker.reset(maxId)`
- [D:\stplugin\src\index.js L28-L38](file:///D:/stplugin/src/index.js#L28-L38) - `onDelete` passes the pruned node's parent and runs renumbering after the file delete
- [D:\stplugin\src\ui\branch-panel.js L98-L145](file:///D:/stplugin/src/ui/branch-panel.js#L98-L145) - prune confirm passes `node.parent` through to `onDelete`
- [D:\stplugin\tests\model.test.js L90-L135](file:///D:/stplugin/tests/model.test.js#L90-L135) - renumber plan tests: sibling compaction, parent shifting, child re-parenting, gap repair, no-op cases

## Result
`npm test` passes 29/29. Headless Chrome check with all destructive fetches
intercepted (no real data touched): pruning br_202 deletes it, then the
former br_203 is re-saved as `... br_201` with branch.id=br_201 /
parent=br_200 and its old file deleted; the plan maxId is 201 so the next
snapshot reuses br_202. The extra main-chat save seen in the trace is ST's
own debounced metadata housekeeping, unrelated to the renumber. Files synced
to the installed extension.

---

# Critical fix: renumber deleted the whole branch (file-name regex bug) + recovery

- Date: 2026-08-02 10:45:00
- Session: Same conversation; user reported that after pruning br_203 the
  entire branch disappeared.

## Problem / Requirement
The renumber plan replaced the trailing id token with
`fileName.replace(/br_N$/, newId)`. Migrated legacy snapshot names end with
`br_N [FA]` (e.g. `... br_202 [FA]`), so the anchor `$` never matched and
`newFileName` stayed equal to the OLD name. The executor then saved the file
to the SAME name (overwriting itself) and deleted that file - data loss.

## Purpose of Change
1. Fix the name replacement to also handle the `br_N [FA]` suffix
   (`br_N(?= [FA]$|$)` with escaped brackets).
2. Add a hard safety guard: the executor skips any step where the new name
   equals the old name (never save-then-delete the only copy).
3. Recover the lost snapshot from ST's automatic chat backups.

## How It Was Changed
- [D:\stplugin\src\model\branches.js L110-L118](file:///D:/stplugin/src/model/branches.js#L110-L118) - regex now `br_${n}(?= \\[FA\\]$|$)` (matches both naming styles)
- [D:\stplugin\src\store\chat-api.js L225-L235](file:///D:/stplugin/src/store/chat-api.js#L225-L235) - renumber executor skips steps with no actual name change and logs a warning
- [D:\stplugin\tests\model.test.js L135-L148](file:///D:/stplugin/tests/model.test.js#L135-L148) - regression test for the `br_N [FA]` name form
- Data recovery: `... br_202 [FA].jsonl` was recreated from ST's automatic
  backup `chat_default_seraphina_20260802-080213.jsonl` (the renumber save,
  already carrying branch.id=br_201) under the intended new name
  `... br_201 [FA]`; br_203 was intentionally pruned by the user and stays
  deleted.

## Result
`npm test` passes 30/30. Real end-to-end test with two throwaway migrated
style snapshots (names ending ` [FA]`): pruning br_298 deleted it, br_299
was compacted to br_202 (the real br_201 occupies 201) - file renamed, meta
id=br_202/parent=br_200 correct, old file deleted, real br_201 untouched;
test artifacts cleaned up afterwards. Files synced to the installed
extension.

---

# Feature: recursive tree numbering (br_000-1) + collapsible/searchable panel

- Date: 2026-08-02 11:00:00
- Session: Same conversation; user approved the recommended design: ids
  start at br_000, recursive per-parent numbering (br_000-1, br_000-1-1,
  br_000-2 ...), auto-migration of existing data, and growth handling via a
  collapsible + searchable panel.

## Problem / Requirement
The old flat 200-based ids (br_200, br_201, ...) did not encode tree
hierarchy, and the panel had no navigation aids for large branch trees.

## Purpose of Change
- Root id is fixed `br_000`; every snapshot gets `${parentId}-<seq>` where
  seq is counted per parent (br_000 -> br_000-1 -> br_000-1-1).
- Prune renumbering compacts the deleted node's sibling bucket recursively
  (descendant path prefixes updated; children of the deleted node are
  adopted by its parent).
- One-time migration: flat ids br_200/br_201/... -> br_000/br_000-1/...;
  the root chat file keeps its name (metadata rewritten in place, in-memory
  chat_metadata synced so ST cannot write the old id back).
- Panel growth handling: search box (id/reason/preview) + expand/collapse
  toggles; root + first level visible by default, deeper levels expand on
  demand.

## How It Was Changed
- [D:\stplugin\src\model\branches.js L1-L150](file:///D:/stplugin/src/model/branches.js#L1-L150) - ROOT_BRANCH_ID, parseBranchId/getParentId/getLastSegment/replaceBranchIdInFileName, createBranchIdCounter (per-parent), planRenumberAfterDelete (recursive bucket compaction + adoption), planMigrateLegacyIds (flat -> tree)
- [D:\stplugin\src\store\chat-api.js L1-L60](file:///D:/stplugin/src/store/chat-api.js#L1-L60) - per-parent counter; adoptRootIfNeeded uses br_000; createSnapshot ids from parent; scanBranches runs the legacy migration and re-scans; applyRenumberSteps shared executor (rename vs metadata-only, in-memory meta sync)
- [D:\stplugin\src\store\helpers.js L150-L170](file:///D:/stplugin/src/store/helpers.js#L150-L170) - old global createBranchIdTracker removed (moved to model as per-parent counter)
- [D:\stplugin\src\ui\branch-panel.js L25-L160](file:///D:/stplugin/src/ui/branch-panel.js#L25-L160) - search input in the header; expand/collapse toggles; visibility rules (default two levels, deeper expandable; search ignores collapse)
- [D:\stplugin\src\style.css L60-L140](file:///D:/stplugin/src/style.css#L60-L140) - search box + toggle styles
- [D:\stplugin\tests\model.test.js L84-L210](file:///D:/stplugin/tests/model.test.js#L84-L210) - id utilities, per-parent counter, recursive renumber (siblings/descendants/adoption/gaps/[FA] names), legacy migration plan tests

## Result
`npm test` passes 32/32. Real-data migration verified against the live
install: main chat meta became br_000 (kind=active), the old br_201 [FA]
snapshot became br_000-1 [FA] with parent br_000; panel shows br_000 root +
br_000-1 with search and toggle controls. Note: the user's live session
created one snapshot (br_000-2, parent br_000-1) while the migration was
being applied with mixed code state; it is a valid backup but carries an
inconsistent parent and can be pruned. A hard refresh (Ctrl+Shift+R) loads
the new numbering engine cleanly. Retention settings remain a roadmap item.

---

# Fix: branch tree now always renders top-down (root first)

- Date: 2026-08-02 11:15:00
- Session: Same conversation; user reported the root's branch tree rendered
  upward (root below its children).

## Problem / Requirement
The panel iterated `PanelIndex.nodes` in map insertion order, which follows
the chat-file list order; the root file could sort after its snapshots, so
the root appeared at the bottom and the tree "grew upward".

## Purpose of Change
Render the tree in a deterministic depth-first tree order: roots first
(top), then each branch's children below it, siblings sorted by their
numeric path (br_000 -> br_000-1 -> br_000-1-1 -> br_000-2). Orphan/unlinked
nodes are appended at the end.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L10-L135](file:///D:/stplugin/src/ui/branch-panel.js#L10-L135) - import `parseBranchId`; build a `compareIds` key and a recursive `visit` traversal (roots sorted first, children DFS, siblings by numeric path); the render loop iterates `orderedNodes`

## Result
`npm test` passes 32/32. Headless Chrome check: rows now render
`br_000 (margin 0)` then `br_000-1 (margin 14px)` - root on top, children
below. Files synced to the installed extension.

---

# Removed: "Clear snapshots" button and its functionality

- Date: 2026-08-02 11:30:00
- Session: Same conversation; user asked to delete the Clear snapshots button
  and its related code.

## Problem / Requirement
The bulk-reset feature (delete ALL snapshot backups at once) is no longer
wanted in the panel.

## Purpose of Change
Remove the button, the `onClearAll` wiring, the `clearAllSnapshots` store
function and the now-unused fingerprint-store `clear()` method.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L7-L27](file:///D:/stplugin/src/ui/branch-panel.js#L7-L27) - `onClearAll` option and the `.stfloor-clear` button + click handler removed
- [D:\stplugin\src\index.js L8-L15](file:///D:/stplugin/src/index.js#L8-L15) - `clearAllSnapshots` import and the `onClearAll` block removed
- [D:\stplugin\src\store\chat-api.js L400-L440](file:///D:/stplugin/src/store/chat-api.js#L400-L440) - `clearAllSnapshots` function deleted
- [D:\stplugin\src\store\helpers.js L175-L185](file:///D:/stplugin/src/store/helpers.js#L175-L185) - fingerprint store `clear()` removed
- [D:\stplugin\tests\helpers.test.js L196-L203](file:///D:/stplugin/tests/helpers.test.js#L196-L203) - fingerprint-store test no longer uses `clear()`

## Result
`npm test` passes 32/32; no remaining references to `clearAllSnapshots` /
`stfloor-clear` / `onClearAll`. Files synced to the installed extension.

---

# TauriTavern compatibility research (source inspection)

- Date: 2026-08-02 09:02:52
- Session: Same conversation; user asked to inspect the TauriTavern repo and
  identify what the plugin needs to be compatible with.

## Problem / Requirement
The user wants the Floor Anchor plugin to also run on TauriTavern (the Tauri +
Rust re-implementation of SillyTavern). Before touching code, determine which
parts of the plugin's contract (HTTP endpoints, frontend module imports, DOM
selectors, events, data layout, settings persistence) hold on TauriTavern and
which need adaptation.

## Purpose of Change
Produce an evidence-backed compatibility report and a concrete adaptation
list, so the follow-up implementation can be scoped and verified against the
real TauriTavern source (dev branch, frontend synced to upstream 1.18.0).

## How It Was Changed
Research only - no plugin code was modified. Evidence inspected under
`D:\stplugin\.tmp-tt` (shallow clone of `Darkatse/TauriTavern`, branch `dev`):
- [D:\stplugin\.tmp-tt\ExtensionDEV.md L1-L160](file:///D:/stplugin/.tmp-tt/ExtensionDEV.md#L1-L160) - extension model: local/global third-party dirs, `/scripts/extensions/third-party/<folder>/<path>`, `window.__TAURITAVERN__` ABI, windowed-payload note (later superseded by ChatPayload.md)
- [D:\stplugin\.tmp-tt\docs\FrontendHostContract.md L1-L260](file:///D:/stplugin/.tmp-tt/docs/FrontendHostContract.md#L1-L260) - fetch/jQuery.ajax interception, route shims, `/csrf-token` dummy token, resource endpoints
- [D:\stplugin\.tmp-tt\docs\BackendStructure.md L1-L180](file:///D:/stplugin/.tmp-tt/docs/BackendStructure.md#L1-L180) - crate layout, upstream-compat promise ("same-origin URL, method, status, body parsing, JSON/text/stream shapes")
- [D:\stplugin\.tmp-tt\docs\CurrentState\ChatPayload.md L1-L120](file:///D:/stplugin/.tmp-tt/docs/CurrentState/ChatPayload.md#L1-L120) - `chat[]` is FULL history with absolute indexes; `/api/chats/get|save` keep ST 1.18.0 contract; `chat_history_mode` removed
- [D:\stplugin\.tmp-tt\docs\CurrentState\ThirdPartyExtensions.md L1-L150](file:///D:/stplugin/.tmp-tt/docs/CurrentState/ThirdPartyExtensions.md#L1-L150) - discovery/activation order, resource loading, local-over-global priority, no Node-only backend plugins
- [D:\stplugin\.tmp-tt\docs\API\Migration.md L1-L120](file:///D:/stplugin/.tmp-tt/docs/API/Migration.md#L1-L120) - migration guide: prefer `getContext().saveChat()`, `api.chat` / `store.*` / `metadata.*` optional capabilities
- [D:\stplugin\.tmp-tt\src\tauri\main\routes\chat-routes.js L1-L330](file:///D:/stplugin/.tmp-tt/src/tauri/main/routes/chat-routes.js#L1-L330) - POST `/api/chats/get|save|delete|rename|search|recent` bodies match ST 1.18.0 field names (`avatar_url/ch_name/file_name/chatfile/force/...`)
- [D:\stplugin\.tmp-tt\src\tauri\main\routes\character-routes.js L75-L120](file:///D:/stplugin/.tmp-tt/src/tauri/main/routes/character-routes.js#L75-L120) - POST `/api/characters/chats` accepts `{ avatar_url, simple }`, returns array of `{file_name, ...}`
- [D:\stplugin\.tmp-tt\src\tauri\main\routes\settings-routes.js L27-L64](file:///D:/stplugin/.tmp-tt/src/tauri/main/routes/settings-routes.js#L27-L64) - POST `/api/settings/get|save` equivalents exist for `extension_settings`
- [D:\stplugin\.tmp-tt\rspack.config.js L90-L110](file:///D:/stplugin/.tmp-tt/rspack.config.js#L90-L110) - aliases `/script.js` -> `src/script.js`, `/scripts` -> `src/scripts` (same absolute URLs as ST)
- [D:\stplugin\.tmp-tt\src\index.html L7591-L7618](file:///D:/stplugin/.tmp-tt/src/index.html#L7591-L7618) - message toolbar DOM (`mes_buttons`/`mes_edit`/swipe/delete) and `#extensions_settings` present
- [D:\stplugin\.tmp-tt\src\script.js L8464-L8572](file:///D:/stplugin/.tmp-tt/src/script.js#L8464-L8572) - `saveChat({chatName, withMetadata, chatData, force})` signature kept; `#dialogue_del_mes_ok` handler at L13481
- [D:\stplugin\.tmp-tt\src\scripts\tauri\chat\transport.js L34-L85](file:///D:/stplugin/.tmp-tt/src/scripts/tauri/chat/transport.js#L34-L85) - `loadCharacterChatPayload` returns `[header, ...messages]`, same shape our meta reader expects

## Result
Compatibility verdict and adaptation list (delivered to the user):

1. Architecturally compatible: pure frontend extension, no Node backend;
   TauriTavern explicitly supports ST-style third-party frontend extensions.
2. All 8 endpoints the plugin calls have TauriTavern route shims with matching
   request/response shapes; `/api/chats/recent` is POST in both (welcome
   screen already calls it as POST).
3. `chat[]` full-history contract holds; snapshot/roll/delete detection logic
   needs no windowing adaptation.
4. REQUIRED code change: 7 cross-tree relative imports resolve one directory
   level wrong under `/scripts/extensions/third-party/<folder>/...`; switch to
   absolute imports (`/script.js`, `/scripts/extensions.js`,
   `/scripts/group-chats.js`, `/scripts/st-context.js`) which work in both
   hosts. Files: `src/index.js` (L3, L13), `src/settings.js` (L10-L11),
   `src/actions/hooks.js` (L10), `src/store/chat-api.js` (L11-L24).
5. Recommended: add `version/author/description` to `manifest.json` (TT
   extension-manager UI reads them); prefer `getContext().saveChat()` over
   direct `script.js` imports per TT migration guide; mobile layout
   (`data-tt-mobile-surface`) is a follow-up.
6. Install path for TT: extension manager Git install, or copy the folder to
   `data/default-user/extensions/st-floor-anchor/` (local) / `data/extensions/third-party/st-floor-anchor/` (global).

Follow-ups: implement the absolute-import switch, sync to
`D:\SillyTavern\public\scripts\extensions\st-floor-anchor\src\`, keep
32/32 tests green, then verify on a real TauriTavern instance (list-filter
behaviour over the route-shim responses, panel open/roll/delete/switch/prune
regression).
