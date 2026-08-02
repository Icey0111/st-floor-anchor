# Roadmap

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

## Milestones

| # | Milestone | Deliverables | Exit criteria |
|---|-----------|--------------|---------------|
| M0 | Project scaffold | `dev_docs/`, `change_log/`, `remove/`, repo hygiene | Docs approved by user; this session's change-log entry recorded |
| M1 | Data layer | `model/` + `store/` pure JS: floor/anchor ops, roll/delete/edit/rescue, rollback, serialization | Unit tests green; round-trip on fixtures; no ST runtime required |
| M2 | UI integration | `ui/` + `actions/`: hide/show via `is_hidden`, floor navigation panel, per-floor menus, hooks for swipe/edit/delete | Manual test on ST 1.15/1.16: roll/delete are reversible in UI |
| M3 | Thinking rescue | Rescue dialog + char floor creation from `extra.reasoning` | Truncated-reasoning scenario produces a new editable char floor |
| M4 | Import/export | Native-compatible export, full-format export, import rebuild, round-trip tests | Fixture suite proves I6 for roll/delete/edit/rescue mixes |
| M5 | Polish | Settings panel, group chats, i18n, performance on long chats | Community test pass; README + docs updated |

## Open Questions

- Exact native hidden-flag field name and per-release semantics (display +
  context removal) - verify against the installed ST version in M2.
- Whether ST's prompt construction can be intercepted as a fallback if hidden
  messages leak into context on some releases (see `02_tech_stack.md` risk).
- Handling of native checkpoints/branches: map each ST branch file onto the
  same floor tree, or keep per-file trees? (Decision needed before M2.)
- Group chats: floors spanning multiple speakers (deferred to M5).

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ST internals change (events, hidden flag, swipe pipeline) | Broken hooks, data written incorrectly | Isolate all ST-specific code in `actions/`; contract tests per ST version |
| Non-active anchors leak into prompt context | Polluted generation | Verify `is_hidden` semantics; fallback: strip before prompt build |
| Anchor metadata grows large in long chats | File bloat, slower IO | Store only segment diffs (G3); cap retained versions behind a setting |
| Import of foreign/legacy JSONL | Rebuild produces wrong floors | Strict validation + "single-version floor" fallback; never reject valid ST files |
| Round-trip drift after ST normalization | I6 violated | Fixture-based round-trip tests in M4; re-normalize on import |


<!-- VERSION 2 -->
## v2 - 2026-08-02 02:51:52 - switch to ST-native branch-file storage; rollback = chat switch

## Milestones

| # | Milestone | Deliverables | Exit criteria |
|---|-----------|--------------|---------------|
| M0 | Project scaffold | `dev_docs/`, `change_log/`, `remove/`, repo hygiene | Docs approved by user; this session's change-log entry recorded |
| M1 | Data layer | `model/` pure JS: branch plans (copy-prefix + apply change), PanelIndex aggregation, rollback resolution, metadata serialization | Unit tests green on fixtures; no ST runtime required |
| M2 | ST integration + panel | `store/` + `actions/`: create/switch branch files via ST APIs, hooks for swipe/edit/delete; `ui/` branch tree panel with switch/rollback | Manual test on ST 1.15/1.16: roll/delete create branches; rollback switches chat |
| M3 | Thinking rescue | Rescue dialog + char floor creation from `extra.reasoning` | Truncated-reasoning scenario produces a new editable char floor |
| M4 | Import/export | Per-file native compat verification; full bundle export/import (files + index); round-trip tests | Fixture suite proves B5/B6 for roll/delete/edit/rescue mixes |
| M5 | Polish | Settings panel (prune/merge branches), group chats, i18n, performance on long trees | Community test pass; README + docs updated |

## Open Questions

- Which ST chat-file APIs a UI extension can call to create/switch/rename a
  chat file (Timelines-style scanning proves reads are possible; writes need
  verification in M2).
- Whether ST's native branch/checkpoint clone copies `chat_metadata` verbatim;
  if not, write `chat_metadata.st_floor` right after file creation.
- How to adopt pre-existing native branches/checkpoints that lack
  `st_floor` metadata: import as orphan roots, or auto-adopt as children by
  following native checkpoint links.
- Where to cache `PanelIndex` (localStorage vs IndexedDB) and how to handle
  very large trees (lazy scan, capped preview).
- Group chats: floors spanning multiple speakers (deferred to M5).

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ST internals change (events, chat-file APIs, branch creation) | Broken hooks, orphaned files | Isolate all ST-specific code in `actions/`/`store/`; contract tests per ST version |
| Branch files proliferate with frequent rolls | ST chat manager becomes cluttered | Panel is the primary management surface; prune/merge + retention settings (M5); files stay valid ST chats |
| Native branch clone drops custom `chat_metadata` | Branch tree loses identity | Write `chat_metadata.st_floor` immediately after file creation; verify in M2 |
| Scanning many files is slow | Laggy panel | Cached `PanelIndex` + lazy load; rebuild on demand |
| Import of foreign/legacy JSONL | Wrong tree | Strict validation; adopt as root branch; never reject valid ST files |
| Round-trip drift after ST normalization | B5 violated | Fixture-based round-trip tests in M4; re-normalize on import |


<!-- VERSION 3 -->
## v3 - 2026-08-02 02:57:42 - snapshot-before-mutation: back up current chat in panel instead of jumping to a new chat

## Milestones

| # | Milestone | Deliverables | Exit criteria |
|---|-----------|--------------|---------------|
| M0 | Project scaffold | `dev_docs/`, `change_log/`, `remove/`, repo hygiene | Docs approved by user; this session's change-log entry recorded |
| M1 | Data layer | `model/` pure JS: snapshot plans (copy current chat before mutation), PanelIndex aggregation (branches + snapshots), rollback resolution, metadata serialization | Unit tests green on fixtures; no ST runtime required |
| M2 | ST integration + panel | `store/` + `actions/`: snapshot current chat + switch chat via ST APIs, hooks for swipe/edit/delete; `ui/` branch/snapshot tree panel with switch/rollback | Manual test on ST 1.15/1.16: roll/delete create panel snapshots WITHOUT switching; rollback switches chat |
| M3 | Thinking rescue | Rescue dialog + char floor creation from `extra.reasoning` | Truncated-reasoning scenario produces a new editable char floor |
| M4 | Import/export | Per-file native compat verification; full bundle export/import (files + index, snapshots included); round-trip tests | Fixture suite proves B6/B7 for roll/delete/edit/rescue mixes |
| M5 | Polish | Settings panel (snapshot retention, prune/merge), group chats, i18n, performance on long trees | Community test pass; README + docs updated |

## Open Questions

- Which ST chat-file APIs a UI extension can call to copy/create/switch a
  chat file (Timelines-style scanning proves reads are possible; writes need
  verification in M2).
- How to snapshot the current chat from a UI extension (copy via API, or
  download+upload of the JSONL); fallback: ask the user to use native
  "Create Branch" and have the panel adopt the file.
- Whether ST's native branch/checkpoint clone copies `chat_metadata` verbatim;
  if not, write `chat_metadata.st_floor` right after file creation.
- How to adopt pre-existing native branches/checkpoints that lack
  `st_floor` metadata: import as orphan roots, or auto-adopt as children by
  following native checkpoint links.
- Default snapshot retention (count/time-based) so frequent rolls do not pile
  up unbounded files; user-configurable in M5.
- Where to cache `PanelIndex` (localStorage vs IndexedDB) and how to handle
  very large trees (lazy scan, capped preview).
- Group chats: floors spanning multiple speakers (deferred to M5).

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ST internals change (events, chat-file APIs, branch creation) | Broken hooks, orphaned files | Isolate all ST-specific code in `actions/`/`store/`; contract tests per ST version |
| Snapshot files proliferate with frequent rolls | ST chat manager becomes cluttered, disk usage grows | Panel is the primary management surface; snapshot retention defaults + prune/merge settings (M5); files stay valid ST chats |
| Snapshot API unavailable in a UI extension | Cannot auto-snapshot | Verify in M2; fallback to native "Create Branch" + panel adoption |
| Native branch clone drops custom `chat_metadata` | Snapshot tree loses identity | Write `chat_metadata.st_floor` immediately after file creation; verify in M2 |
| Scanning many files is slow | Laggy panel | Cached `PanelIndex` + lazy load; rebuild on demand |
| Import of foreign/legacy JSONL | Wrong tree | Strict validation; adopt as root branch; never reject valid ST files |
| Round-trip drift after ST normalization | B6 violated | Fixture-based round-trip tests in M4; re-normalize on import |
