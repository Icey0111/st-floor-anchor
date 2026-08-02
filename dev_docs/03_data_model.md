# Data Model

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

## Entities

| Entity | Fields |
|--------|--------|
| `Floor` | `id` (`f1`, `f2`, ...), `anchors[]`, `activeAnchorId` |
| `Anchor` | `id` (`f3v1`), `kind` (`original`/`roll`/`delete`/`edit`/`rescue`), `messageId` (ST message index or uid), `parentAnchorId`, `oldContinuation?` (branch id), `tombstone`, `createdAt`, `reason?` |
| `BranchLink` | `id` (`br_201`), `entryFloorId`, `sourceAnchorId`, `createdAt`, `reason` |
| `ChatFloorMeta` | `schema`, `floors{}`, `branches{}` (stored in `chat_metadata.st_floor`) |

## Storage Mapping

| Concept | Location |
|---------|----------|
| Floor index, branches, schema version | `chat_metadata.st_floor` |
| Anchor identity per message | `message.extra.st_floor` |
| Message content | Standard `mes` / `swipes` / `send_date` fields (anchors are legal ST messages) |
| Active vs hidden | Native `is_hidden` flag on non-active anchors |
| Truncated/reasoning source text | `extra.reasoning` (read-only source for rescue) |

## JSONL Example

Header with chat-level floor metadata:

```json
{"chat_metadata": {
  "st_floor": {
    "schema": 1,
    "floors": {
      "f3": { "activeAnchorId": "f3v2", "anchors": ["f3v1", "f3v2"] }
    },
    "branches": { "br_201": { "entryFloorId": "f3", "sourceAnchorId": "f3v1", "reason": "roll" } }
  }
}}
```

Floor f3 with two anchors (v1 hidden original, v2 active roll):

```json
{"name": "AI", "is_user": false, "mes": "old draft before the roll", "send_date": "2026-08-02T10:00:00.000Z",
 "is_hidden": true,
 "extra": {"st_floor": {"floor_id": "f3", "anchor_id": "f3v1", "kind": "original"}}}

{"name": "AI", "is_user": false, "mes": "new rolled version", "send_date": "2026-08-02T10:01:00.000Z",
 "extra": {"st_floor": {"floor_id": "f3", "anchor_id": "f3v2", "kind": "roll",
                         "parent_anchor": "f3v1", "old_continuation": "br_201"}}}
```

Delete tombstone (content preserved, hidden):

```json
{"name": "AI", "is_user": false, "mes": "deleted but retained content", "send_date": "...",
 "is_hidden": true,
 "extra": {"st_floor": {"floor_id": "f4", "anchor_id": "f4v1", "kind": "delete",
                         "tombstone": true, "old_continuation": "br_202"}}}
```

## Invariants

| ID | Invariant |
|----|-----------|
| I1 | Exactly one active anchor per floor. |
| I2 | The active chain covers floors 1..N contiguously (no holes in the visible conversation). |
| I3 | Every non-active anchor is `is_hidden: true` and carries `extra.st_floor`. |
| I4 | Every roll/delete/edit anchor stores `parent_anchor`; roll/delete also stores `old_continuation` when a tail existed. |
| I5 | Floor ids increase monotonically; anchor ids are unique within a floor. |
| I6 | Round-trip: export -> import -> export yields identical `st_floor` metadata (modulo object key ordering). |
| I7 | Readers tolerate unknown fields inside `st_floor` (schema forward-compatibility). |

## Degradation Without the Plugin

- Non-active anchors are ordinary (hidden) ST messages: native ST renders the
  active chain and ignores hidden messages.
- `chat_metadata.st_floor` is preserved by native export/import (metadata is
  exported "as is").
- Reinstalling the extension rebuilds the full floor tree from
  `extra.st_floor`; nothing is reconstructed from backups.


<!-- VERSION 2 -->
## v2 - 2026-08-02 02:51:52 - switch to ST-native branch-file storage; rollback = chat switch

## Entities

Storage unit is the **ST native chat file (a "branch session")**. Every
mutation (roll / delete / edit / rescue) creates a NEW branch file via ST's
native branch/checkpoint mechanism and switches the active chat to it. The
source file is never modified by the mutation, so the pre-mutation state is
always the source branch itself. The branch tree (which file forks from
which floor) is plugin-owned and rendered in the plugin panel.

## Entities

| Entity | Fields |
|--------|--------|
| `Branch` | `id` (`br_201`), `fileName` (ST chat file), `parentBranchId`, `sourceFloor`, `reason` (`root`/`roll`/`delete`/`edit`/`rescue`), `createdAt`, `title?` |
| `Floor` | Ordinal position of a message inside a branch (1..N); the same floor number across branches is the semantic fork point |
| `BranchMeta` | Per-file record stored in `chat_metadata.st_floor` (schema + this branch's own fields) |
| `PanelIndex` | Derived aggregation of all branch files of the same character/group: tree, active branch, titles; rebuildable at any time |

## Storage Mapping

| Concept | Location |
|---------|----------|
| Branch identity + parent + source floor | `chat_metadata.st_floor` of each branch file (`schema`, `branch`) |
| Message content | Standard `mes` / `swipes` / `send_date` fields; no per-message anchor fields |
| Truncated/reasoning source text | `extra.reasoning` (read-only source for rescue) |
| Branch tree / panel state | Derived by scanning branch files; cached in extension storage (localStorage/IndexedDB) |

## JSONL Example (per branch file)

Root branch (the original chat):

```json
{"chat_metadata": {
  "st_floor": { "schema": 2, "branch": { "id": "br_200", "parent": null, "source_floor": null, "reason": "root" } }
}}
```

Roll branch created at floor 5 (parent = root):

```json
{"chat_metadata": {
  "st_floor": { "schema": 2, "branch": { "id": "br_201", "parent": "br_200", "source_floor": 5, "reason": "roll" } }
}}
```

The roll branch is a full ST chat file whose first 4 floors are identical to
the root; floor 5 onward contains the new rolled version. The root file stays
untouched with the pre-roll content.

## Key Operations

| Operation | Behavior |
|-----------|----------|
| Roll at floor N | Copy branch up to N-1 into a new file, generate new reply at N, register branch `br_x` (reason=roll), switch chat |
| Delete at floor N | Copy branch up to N-1 into a new file (the deleted floor and tail are omitted), register `br_x` (reason=delete), switch chat |
| Edit at floor N | Copy branch up to N-1, apply edit, keep tail, register `br_x` (reason=edit), switch chat |
| Thinking rescue | New message floor appended in the CURRENT branch (pure addition, no history rewritten) or a `rescue` branch when a new session is desired |
| Rollback | Switch the active chat to the target branch file; no data copy or reconstruction |
| Revert delete | Switch back to the pre-delete branch (the source file) |

## Invariants

| ID | Invariant |
|----|-----------|
| B1 | Every branch file carries `chat_metadata.st_floor` with a unique branch id. |
| B2 | `parent` links to an existing branch id, or `null` for the root. |
| B3 | A mutation never modifies its source file; the source IS the pre-mutation state. |
| B4 | Rollback = switching the active chat to a branch file (no copy/merge). |
| B5 | Branch ids are stable and survive native export/import (`chat_metadata` is preserved). |
| B6 | `PanelIndex` is derived data; it can be rebuilt from the branch files at any time. |
| B7 | `source_floor` is recorded at creation so the panel can render the fork point. |

## Degradation Without the Plugin

- Every branch is an ordinary, valid ST chat file; ST's own chat management
  lists and opens them as usual (no hidden messages, no bloat inside a file).
- `chat_metadata.st_floor` is preserved by native export/import "as is".
- Reinstalling the extension rebuilds the `PanelIndex` by scanning the files;
  nothing is reconstructed from backups.


<!-- VERSION 4 -->
## v4 - 2026-08-02 06:31:00 - snapshot files carry the [FA] marker and are hidden from ST's native chat lists

## Overview

Snapshots remain ordinary ST chat files (durable, native JSONL, rollback =
chat switch), but their file names embed the marker `[FA]`
(`SNAPSHOT_FILE_MARKER`), e.g.:

    Seraphina - [FA] roll 2026-08-02-06-13-34 br_201

A client-side fetch filter (`store/list-filter.js`) strips marker-named
entries from ST's native list endpoints (`/api/characters/chats`,
`/api/chats/recent`, `/api/chats/search`), so the built-in chat manager never
shows backups. The plugin's own scans opt out with `X-StFloor-Internal: 1`
and always see the full truth.

Legacy snapshots (created before the marker) are migrated by rename. The
currently open legacy snapshot is never renamed on disk (ST may still be
saving to the old name); it is hidden by id while active and renamed as soon
as the user leaves it. If a stale save recreates an old-name file afterwards,
the next scan treats it as a duplicate of the same branch and removes it.

## Storage Mapping (delta)

| Concept | Location |
|---------|----------|
| Snapshot marker | `SNAPSHOT_FILE_MARKER = '[FA]'` embedded in every snapshot chat file name; never used by native chats |
| Active legacy snapshot id | In-memory in `store/list-filter.js` (`setActiveSnapshotFileName`), re-derived on `chat_loaded`/`chat_changed` from `chat_metadata.st_floor` |

## Invariants (delta)

| ID | Invariant |
|----|-----------|
| B10 | Every snapshot file name embeds the `[FA]` marker; native (non-snapshot) chats never carry it. |
| B11 | The fetch filter hides marker snapshots from ST's list endpoints; internal scans opt out via `X-StFloor-Internal: 1`. |
| B12 | A legacy (unmarked) snapshot that is currently open is not renamed; it is hidden by id and renamed when it becomes inactive. |
| B13 | Duplicate branch ids are deduped at scan time; the marker-named file wins; a redundant unmarked source is deleted only when it is provably the same branch (same id + snapshot kind). |

## Degradation Without the Plugin

- Snapshots are still ordinary, valid ST chat files; uninstalling the plugin
  simply makes them visible again as normal chats (names contain `[FA]`).
- `chat_metadata.st_floor` is preserved by native export/import "as is".


<!-- VERSION 3 -->
## v3 - 2026-08-02 02:57:42 - snapshot-before-mutation: back up current chat in panel instead of jumping to a new chat

## Overview

Storage unit is the **ST native chat file**. Every destructive operation
(roll / delete / edit) follows a snapshot-before-mutation pattern:

1. The FULL current chat state is copied into a **snapshot backup node**
   (an ST chat file) and registered in the plugin panel.
2. The native ST operation then proceeds IN PLACE in the current chat - no
   automatic chat switch, no interruption of normal usage.
3. Rollback is user-initiated from the panel: clicking a snapshot/branch
   switches the active chat to that file.

The branch tree (which file forked from which floor, plus every snapshot) is
plugin-owned and rendered in the plugin panel.

## Entities

| Entity | Fields |
|--------|--------|
| `Branch` | `id` (`br_201`), `fileName` (ST chat file), `parentBranchId`, `sourceFloor`, `reason` (`root`/`roll`/`delete`/`edit`/`rescue`), `kind` (`active`/`snapshot`), `createdAt`, `title?` |
| `Floor` | Ordinal position of a message inside a branch (1..N); the same floor number across branches is the semantic fork point |
| `BranchMeta` | Per-file record stored in `chat_metadata.st_floor` (schema + this branch's own fields) |
| `PanelIndex` | Derived aggregation of all branch files of the same character/group: tree, active branches, snapshots; rebuildable at any time |

## Storage Mapping

| Concept | Location |
|---------|----------|
| Branch identity + parent + source floor + kind | `chat_metadata.st_floor` of each branch file (`schema`, `branch`) |
| Message content | Standard `mes` / `swipes` / `send_date` fields; no per-message anchor fields |
| Truncated/reasoning source text | `extra.reasoning` (read-only source for rescue) |
| Branch tree / panel state | Derived by scanning branch files; cached in extension storage (localStorage/IndexedDB) |

## JSONL Example (per branch file)

Root branch (the original chat):

```json
{"chat_metadata": {
  "st_floor": { "schema": 3, "branch": { "id": "br_200", "kind": "active", "parent": null, "source_floor": null, "reason": "root" } }
}}
```

Snapshot created BEFORE a roll at floor 5 (registered in the panel; the
current chat br_200 continues untouched while the user rolls in place):

```json
{"chat_metadata": {
  "st_floor": { "schema": 3, "branch": { "id": "br_201", "kind": "snapshot", "parent": "br_200", "source_floor": 5, "reason": "roll", "created_at": "..." } }
}}
```

The snapshot is a full copy of br_200 at the moment before the roll and is
immutable afterwards. The user stays in br_200; rollback = switching to
br_201 from the panel.

## Key Operations

| Operation | Behavior |
|-----------|----------|
| Roll at floor N | 1) snapshot current chat -> `br_x` (kind=snapshot, reason=roll, source_floor=N), register in panel; 2) native roll proceeds in place; no chat switch |
| Delete at floor N | 1) snapshot current chat -> `br_x` (kind=snapshot, reason=delete, source_floor=N), register in panel; 2) native delete proceeds in place; no chat switch |
| Edit at floor N | 1) snapshot current chat -> `br_x` (kind=snapshot, reason=edit, source_floor=N), register in panel; 2) native edit proceeds in place |
| Thinking rescue | New message floor appended in the CURRENT branch (pure addition, no history rewritten; no snapshot needed) |
| Rollback | User clicks a snapshot/branch in the panel -> switch the active chat to that file; no copy/merge |
| Revert delete/roll | Switch back to the pre-mutation snapshot from the panel |

## Invariants

| ID | Invariant |
|----|-----------|
| B1 | Every branch/snapshot file carries `chat_metadata.st_floor` with a unique branch id. |
| B2 | `parent` links to an existing branch id, or `null` for the root. |
| B3 | A snapshot is a full copy of the chat taken IMMEDIATELY BEFORE a mutation and is immutable afterwards. |
| B4 | Mutations proceed in place in the current chat; no automatic chat switch (UX preserved). |
| B5 | Rollback = user-initiated switch to a snapshot/branch file (no copy/merge). |
| B6 | Branch ids are stable and survive native export/import (`chat_metadata` is preserved). |
| B7 | `PanelIndex` is derived data; it can be rebuilt from the branch files at any time. |
| B8 | `source_floor` and `kind` are recorded at creation so the panel can render fork points and backups. |
| B9 | Snapshot retention is panel-managed (prune setting); snapshots never mutate. |

## Degradation Without the Plugin

- Every branch and snapshot is an ordinary, valid ST chat file; ST's own chat
  management lists and opens them as usual (no hidden messages, no bloat
  inside a file). Snapshots use a panel-managed naming/flag convention.
- `chat_metadata.st_floor` is preserved by native export/import "as is".
- Reinstalling the extension rebuilds the `PanelIndex` by scanning the files;
  nothing is reconstructed from backups.
