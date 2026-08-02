# Work Tree

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

## Canonical Layout

```
stplugin/
|-- dev_docs/              # design docs (append-only, read header.md first)
|   |-- header.md
|   |-- 00_overview.md
|   |-- 01_architecture.md
|   |-- 02_tech_stack.md
|   |-- 03_data_model.md
|   |-- 04_roadmap.md
|   `-- 05_worktree.md
|-- change_log/            # one file per conversation (append-only)
|   |-- header.md
|   `-- change_log_*.md
|-- remove/                # pre-deletion snapshots (append-only)
|   |-- header.md
|   `-- remove_*/
|-- src/                   # extension source (browser context)
|   |-- manifest.json      # ST UI extension manifest
|   |-- index.js           # entry point: registers events, boots modules
|   |-- style.css          # floor panel, badges, dialogs
|   |-- model/             # pure JS: floors, anchors, branches, invariants
|   |   |-- floor-model.js
|   |   |-- anchors.js
|   |   `-- invariants.js
|   |-- store/             # persistence mapping onto ST chat structures
|   |   |-- store-adapter.js
|   |   `-- native-mapper.js
|   |-- actions/           # ST event hooks -> anchor operations
|   |   `-- hooks.js
|   |-- ui/                # rendering and dialogs
|   |   |-- floor-panel.js
|   |   |-- action-menu.js
|   |   `-- rescue-dialog.js
|   `-- io/                # import/export + validation
|       |-- export.js
|       |-- import.js
|       `-- validators.js
|-- tests/                 # node --test units + JSONL fixtures
|   |-- model.test.js
|   |-- store.test.js
|   |-- io.test.js
|   `-- fixtures/
|-- README.md              # install/usage summary (points to dev_docs)
`-- .gitignore
```

## Top-Level Directory Responsibilities

| Path | Responsibility |
|------|----------------|
| `dev_docs/` | Single source of truth for design; append-only revisions per `header.md` |
| `change_log/` | Chronological, immutable record of every work session |
| `remove/` | Snapshots of files before any delete/overwrite (per `header.md`) |
| `src/` | The extension itself; must contain no build artifacts in v1 |
| `tests/` | Pure-data-layer tests and fixtures; no ST runtime required |
| `README.md` | Entry point for users; links to `dev_docs/00_overview.md` |


<!-- VERSION 5 -->
## v5 - 2026-08-02 07:30:00 - add settings module (extensions-panel configuration)

## Canonical Layout (delta)

```
stplugin/
|-- src/
|   |-- index.js           # entry point: boot, entry button, events, fetch filter, settings panel
|   |-- settings.js        # extension_settings.stfloor get/save + extensions-panel settings section
|   |-- style.css          # branch panel + marquee preview styles
|   |-- model/
|   |   |-- metadata.js    # chat_metadata.st_floor read/write/validate (schema v3)
|   |   |-- branches.js    # snapshot-plan builder + branch id factory
|   |   |-- panel-index.js # derived branch tree aggregation + rollback resolution
|   |   `-- invariants.js  # B2/B6/B7/B8 validators
|   |-- store/
|   |   |-- chat-api.js    # snapshot/switch/scan/clear + legacy-name migration + previews
|   |   |-- helpers.js     # names ([FA] marker), fingerprints, dedupe, preview text + list filter
|   |   `-- list-filter.js # window.fetch patch hiding snapshots from ST chat lists
|   |-- actions/
|   |   `-- hooks.js       # capture-phase swipe/roll/edit/delete-mode hooks
|   `-- ui/
|       `-- branch-panel.js # tree panel: switch/prune/clear snapshots + scrolling previews
|-- tests/
|   |-- model.test.js
|   |-- helpers.test.js
|   `-- fixtures/
```

## Top-Level Directory Responsibilities

Unchanged from v4; `src/settings.js` owns the user-visible configuration
surface (preview length, filter tags) stored in `extension_settings.stfloor`.


<!-- VERSION 4 -->
## v4 - 2026-08-02 06:31:00 - actual implementation layout (snapshot-before-mutation + list filter)

## Canonical Layout

```
stplugin/
|-- dev_docs/              # design docs (append-only, read header.md first)
|-- change_log/            # one file per conversation (append-only)
|-- remove/                # pre-deletion snapshots (append-only)
|-- manifest.json          # ST UI extension manifest (extension root)
|-- src/                   # extension source (browser context)
|   |-- index.js           # entry point: boot, entry button, events, fetch filter install
|   |-- style.css          # branch panel styles
|   |-- model/             # pure JS (no ST imports)
|   |   |-- metadata.js    # chat_metadata.st_floor read/write/validate (schema v3)
|   |   |-- branches.js    # snapshot-plan builder + branch id factory
|   |   |-- panel-index.js # derived branch tree aggregation + rollback resolution
|   |   `-- invariants.js  # B2/B6/B7/B8 validators
|   |-- store/             # ST-facing persistence + list hiding
|   |   |-- chat-api.js    # snapshot/switch/scan/clear + legacy-name migration
|   |   |-- helpers.js     # names ([FA] marker), fingerprints, dedupe, list-filter pure logic
|   |   `-- list-filter.js # window.fetch patch hiding snapshots from ST chat lists
|   |-- actions/
|   |   `-- hooks.js       # capture-phase swipe/roll/edit/delete-mode hooks
|   `-- ui/
|       `-- branch-panel.js # tree panel: switch/prune/clear snapshots
|-- tests/                 # node --test units + JSONL fixtures
|   |-- model.test.js
|   |-- helpers.test.js
|   `-- fixtures/
|-- README.md
`-- .gitignore
```

## Top-Level Directory Responsibilities

| Path | Responsibility |
|------|----------------|
| `dev_docs/` | Single source of truth for design; append-only revisions per `header.md` |
| `change_log/` | Chronological, immutable record of every work session |
| `remove/` | Snapshots of files before any delete/overwrite (per `header.md`) |
| `src/` | The extension itself; pure model modules are unit-tested without ST |
| `tests/` | Pure-data-layer tests and fixtures; no ST runtime required |
| `README.md` | Entry point for users; links to `dev_docs/00_overview.md` |


<!-- VERSION 2 -->
## v2 - 2026-08-02 02:53:40 - align with ST-native branch-file storage; rollback = chat switch

## Canonical Layout

```
stplugin/
|-- dev_docs/              # design docs (append-only, read header.md first)
|   |-- header.md
|   |-- 00_overview.md
|   |-- 01_architecture.md
|   |-- 02_tech_stack.md
|   |-- 03_data_model.md
|   |-- 04_roadmap.md
|   `-- 05_worktree.md
|-- change_log/            # one file per conversation (append-only)
|   |-- header.md
|   `-- change_log_*.md
|-- remove/                # pre-deletion snapshots (append-only)
|   |-- header.md
|   `-- remove_*/
|-- src/                   # extension source (browser context)
|   |-- manifest.json      # ST UI extension manifest
|   |-- index.js           # entry point: registers events, boots modules
|   |-- style.css          # branch panel, badges, dialogs
|   |-- model/             # pure JS: branches, tree, invariants (no ST imports)
|   |   |-- branches.js    # branch entity + branch-plan builder
|   |   |-- panel-index.js # derived branch tree aggregation + rollback resolution
|   |   `-- invariants.js  # B1-B7 validators
|   |-- store/             # ST-facing persistence
|   |   |-- chat-api.js    # read/scan/create/switch chat files
|   |   |-- metadata.js    # read/write chat_metadata.st_floor
|   |   `-- index-cache.js # localStorage/IndexedDB cache of PanelIndex
|   |-- actions/           # ST event hooks -> branch operations
|   |   `-- hooks.js       # swipe/edit/delete/generation -> create branch + switch
|   |-- ui/                # rendering and dialogs
|   |   |-- branch-panel.js   # tree view: switch, rollback, rename, prune
|   |   |-- action-menu.js    # per-floor actions
|   |   `-- rescue-dialog.js  # thinking rescue -> new char floor
|   `-- io/                # import/export + validation
|       |-- bundle-export.js  # full bundle (branch files + index)
|       |-- bundle-import.js  # restore files + rebuild index
|       `-- validators.js     # JSONL/chat_metadata validation
|-- tests/                 # node --test units + JSONL fixtures
|   |-- model.test.js
|   |-- io.test.js
|   `-- fixtures/          # branch file fixtures for round-trip tests
|-- README.md              # install/usage summary (points to dev_docs)
`-- .gitignore
```

## Top-Level Directory Responsibilities

| Path | Responsibility |
|------|----------------|
| `dev_docs/` | Single source of truth for design; append-only revisions per `header.md` |
| `change_log/` | Chronological, immutable record of every work session |
| `remove/` | Snapshots of files before any delete/overwrite (per `header.md`) |
| `src/` | The extension itself; must contain no build artifacts in v1 |
| `tests/` | Pure-data-layer tests and fixtures; no ST runtime required |
| `README.md` | Entry point for users; links to `dev_docs/00_overview.md` |


<!-- VERSION 3 -->
## v3 - 2026-08-02 04:32:58 - manifest.json must live at extension root (ST loader fetches <ext>/manifest.json)

> The SillyTavern extension loader fetches `<ext>/manifest.json` at the
> extension ROOT and resolves `js`/`css` relative to it, so the manifest
> cannot live inside `src/`.

## Canonical Layout

```
stplugin/
|-- dev_docs/              # design docs (append-only, read header.md first)
|   |-- header.md
|   |-- 00_overview.md
|   |-- 01_architecture.md
|   |-- 02_tech_stack.md
|   |-- 03_data_model.md
|   |-- 04_roadmap.md
|   `-- 05_worktree.md
|-- change_log/            # one file per conversation (append-only)
|   |-- header.md
|   `-- change_log_*.md
|-- remove/                # pre-deletion snapshots (append-only)
|   |-- header.md
|   `-- remove_*/
|-- manifest.json          # ST UI extension manifest (MUST be at extension root)
|-- src/                   # extension source (browser context)
|   |-- index.js           # entry point: registers events, boots modules
|   |-- style.css          # branch panel, badges, dialogs
|   |-- model/             # pure JS: branches, tree, invariants (no ST imports)
|   |   |-- branches.js    # branch entity + branch-plan builder
|   |   |-- panel-index.js # derived branch tree aggregation + rollback resolution
|   |   `-- invariants.js  # B1-B7 validators
|   |-- store/             # ST-facing persistence
|   |   |-- chat-api.js    # read/scan/create/switch chat files
|   |   |-- metadata.js    # read/write chat_metadata.st_floor
|   |   `-- index-cache.js # localStorage/IndexedDB cache of PanelIndex
|   |-- actions/           # ST event hooks -> branch operations
|   |   `-- hooks.js       # swipe/edit/delete/generation -> create branch + switch
|   |-- ui/                # rendering and dialogs
|   |   |-- branch-panel.js   # tree view: switch, rollback, rename, prune
|   |   |-- action-menu.js    # per-floor actions
|   |   `-- rescue-dialog.js  # thinking rescue -> new char floor
|   `-- io/                # import/export + validation
|       |-- bundle-export.js  # full bundle (branch files + index)
|       |-- bundle-import.js  # restore files + rebuild index
|       `-- validators.js     # JSONL/chat_metadata validation
|-- tests/                 # node --test units + JSONL fixtures
|   |-- model.test.js
|   |-- io.test.js
|   `-- fixtures/          # branch file fixtures for round-trip tests
|-- README.md              # install/usage summary (points to dev_docs)
`-- .gitignore
```

## Top-Level Directory Responsibilities

| Path | Responsibility |
|------|----------------|
| `dev_docs/` | Single source of truth for design; append-only revisions per `header.md` |
| `change_log/` | Chronological, immutable record of every work session |
| `remove/` | Snapshots of files before any delete/overwrite (per `header.md`) |
| `src/` | The extension itself; must contain no build artifacts in v1 |
| `tests/` | Pure-data-layer tests and fixtures; no ST runtime required |
| `README.md` | Entry point for users; links to `dev_docs/00_overview.md` |
