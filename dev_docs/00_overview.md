# Overview

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

## Problem

SillyTavern stores chats as a flat JSONL array of message objects. Every
conversation mutation is destructive at the data level:

- **Roll / swipe**: only the message-level `swipes` array keeps prior drafts,
  and only for the last message. Old content of intermediate floors and the
  old continuation tail are not tracked in a recoverable way.
- **Delete**: messages are physically removed from the file. Recovery relies
  on opaque whole-file snapshots in `data/<user>/backups/`, which are
  throttled, rotated, and require manual file surgery.
- **Edit**: edits overwrite the message text in place. There is no per-message
  revision history, no undo, and no diff between versions.
- **Truncated reasoning**: when generation stops inside the thinking block and
  the body is empty, the message is effectively locked/unusable. Users need a
  way to create a new character floor and move that content into it.
- **Import/export**: any new storage scheme must remain compatible with the
  native ST JSONL import/export so chats never become hostage to the plugin.

## Goals

| ID | Goal |
|----|------|
| G1 | Floor-based chat model: every message belongs to a numbered floor; floors form the canonical sequence of a chat. |
| G2 | Non-destructive roll/delete/edit: pre-change content is kept as child anchors at the same floor; "rollback" only switches the active pointer. |
| G3 | Diff-branch storage: a roll/delete stores only the affected floor segment (old content + continuation pointer), sharing the unchanged prefix with the current branch. |
| G4 | Character floor editor with thinking rescue: users can create a new character message floor and fill it with content (e.g. rescued from a truncated reasoning block). |
| G5 | Import/export compatibility: native ST JSONL round-trip with zero data loss; degraded gracefully when the extension is absent; a full-format export preserves the complete anchor tree. |

## Scope

- Pure SillyTavern **UI extension** (browser context). No server plugin, no ST
  core patch, no `enableServerPlugins` requirement.
- Solo chats first; group chats are a follow-up milestone.
- Target SillyTavern 1.12+ (native hide-message feature), verified behavior on
  1.15/1.16 line.
- Data layer written as pure, framework-free JavaScript so it is unit-testable
  outside the browser.

## Non-Goals (v1)

- No fork or patch of SillyTavern core.
- No full DAG with merges, rebases, or 3-way conflict resolution.
- No cross-device sync or cloud storage.
- No LLM-powered rewriting (the thinking-rescue flow only moves user-visible
  text into a new floor; it never calls a model).
- No general backup manager; export exists to guarantee data portability.

## Stakeholders

- End users who reroll/delete/edit frequently and want every version back.
- Extension authors who want a stable `extra.st_floor` schema to build on.
- ST maintainers: our format must stay valid native JSONL and never break
  import/export, `swipes`, hidden messages, or backups.


<!-- VERSION 2 -->
## v2 - 2026-08-02 02:51:51 - switch to ST-native branch-file storage; rollback = chat switch

## Problem

SillyTavern stores chats as flat JSONL files. Destructive operations lose
history:

- **Roll / swipe** and **delete** overwrite or remove content; recovery relies
  on opaque, rotated whole-file backups in `data/<user>/backups/`.
- **Edit** overwrites text in place with no revision history.
- ST's native branch/checkpoint feature already preserves pre-mutation states
  as separate chat files, but it is manual, unstructured, and has no tree
  overview: users cannot see which file forked from which floor, and
  maintaining dozens of files inside ST's own chat manager becomes clutter.
- **Truncated reasoning**: when generation stops inside the thinking block and
  the body is empty, the message is effectively locked/unusable. Users need a
  way to create a new character floor and move that content into it.
- **Import/export**: any new storage scheme must remain compatible with the
  native ST JSONL import/export so chats never become hostage to the plugin.

## Goals

| ID | Goal |
|----|------|
| G1 | Floor-based chat model: every message belongs to a numbered floor; floors form the canonical sequence of a chat. |
| G2 | Non-destructive roll/delete/edit: every mutation creates a NEW ST branch session; the source file is never modified; rollback is switching back to the source branch. |
| G3 | Branch-file storage: a mutation copies only the unchanged prefix into the new session and applies the change there; no in-file version accumulation, no hidden-message bloat. |
| G4 | Character floor editor with thinking rescue: users can create a new character message floor and fill it with content (e.g. rescued from a truncated reasoning block). |
| G5 | Import/export compatibility: each branch file is ordinary ST JSONL (native round-trip works out of the box); a full bundle export preserves the complete branch tree; degraded gracefully when the extension is absent. |

## Scope

- Pure SillyTavern **UI extension** (browser context). No server plugin, no ST
  core patch, no `enableServerPlugins` requirement.
- The branch TREE lives in the plugin panel; ST's own chat management keeps
  treating each branch as a normal chat file and stays clean.
- Solo chats first; group chats are a follow-up milestone.
- Target SillyTavern 1.15/1.16 line (native branching, checkpoint links).
- Data layer written as pure, framework-free JavaScript so it is unit-testable
  outside the browser.

## Non-Goals (v1)

- No fork or patch of SillyTavern core.
- No full DAG with merges, rebases, or 3-way conflict resolution.
- No in-file multi-version storage (no anchor messages hidden inside one chat
  file; versions live in separate branch files).
- No cross-device sync or cloud storage.
- No LLM-powered rewriting (the thinking-rescue flow only moves user-visible
  text into a new floor; it never calls a model).
- No general backup manager; export exists to guarantee data portability.

## Stakeholders

- End users who reroll/delete/edit frequently and want every version back
  without drowning in an unstructured chat-file list.
- Extension authors who want a stable `chat_metadata.st_floor` schema.
- ST maintainers: our format must stay valid native JSONL and never break
  import/export, branching, or backups.


<!-- VERSION 3 -->
## v3 - 2026-08-02 02:57:42 - snapshot-before-mutation: back up current chat in panel instead of jumping to a new chat

## Problem

SillyTavern stores chats as flat JSONL files. Destructive operations lose
history:

- **Roll / swipe** and **delete** overwrite or remove content; recovery relies
  on opaque, rotated whole-file backups in `data/<user>/backups/`.
- **Edit** overwrites text in place with no revision history.
- ST's native branch/checkpoint feature preserves pre-mutation states as
  separate chat files, but it is manual, unstructured, and switching to a new
  file on every action interrupts normal use. Users cannot see which file
  forked from which floor, and dozens of files inside ST's own chat manager
  become clutter.
- **Truncated reasoning**: when generation stops inside the thinking block and
  the body is empty, the message is effectively locked/unusable. Users need a
  way to create a new character floor and move that content into it.
- **Import/export**: any new storage scheme must remain compatible with the
  native ST JSONL import/export so chats never become hostage to the plugin.

## Goals

| ID | Goal |
|----|------|
| G1 | Floor-based chat model: every message belongs to a numbered floor; floors form the canonical sequence of a chat. |
| G2 | Non-destructive roll/delete/edit with no UX interruption: the pre-mutation chat state is snapshotted into a panel-managed backup, then the native operation proceeds in place; rollback = switching to a snapshot/branch from the panel. |
| G3 | Snapshot storage: snapshots are full chat-file copies taken immediately before a mutation; no in-file version accumulation, no hidden-message bloat; retention is panel-managed. |
| G4 | Character floor editor with thinking rescue: users can create a new character message floor and fill it with content (e.g. rescued from a truncated reasoning block). |
| G5 | Import/export compatibility: each branch/snapshot file is ordinary ST JSONL (native round-trip works out of the box); a full bundle export preserves the complete branch tree; degraded gracefully when the extension is absent. |

## Scope

- Pure SillyTavern **UI extension** (browser context). No server plugin, no ST
  core patch, no `enableServerPlugins` requirement.
- The branch/snapshot TREE lives in the plugin panel; ST's own chat
  management keeps treating each file as a normal chat and stays clean.
- Normal usage is never interrupted: no automatic chat switch on roll/delete;
  switching happens only when the user explicitly picks a snapshot/branch in
  the panel.
- Solo chats first; group chats are a follow-up milestone.
- Target SillyTavern 1.15/1.16 line (native branching, checkpoint links).
- Data layer written as pure, framework-free JavaScript so it is unit-testable
  outside the browser.

## Non-Goals (v1)

- No fork or patch of SillyTavern core.
- No full DAG with merges, rebases, or 3-way conflict resolution.
- No in-file multi-version storage (no anchor messages hidden inside one chat
  file; versions live in separate snapshot/branch files).
- No cross-device sync or cloud storage.
- No LLM-powered rewriting (the thinking-rescue flow only moves user-visible
  text into a new floor; it never calls a model).
- No general backup manager; export exists to guarantee data portability.

## Stakeholders

- End users who reroll/delete/edit frequently and want every version back
  without being interrupted or drowning in an unstructured chat-file list.
- Extension authors who want a stable `chat_metadata.st_floor` schema.
- ST maintainers: our format must stay valid native JSONL and never break
  import/export, branching, or backups.
