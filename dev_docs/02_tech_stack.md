# Tech Stack

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

## Choices

| Area | Choice | Rationale |
|------|--------|-----------|
| Language | JavaScript (ES Modules) | SillyTavern UI extensions load plain JS in the browser context; no compile step required |
| UI | Vanilla JS + jQuery (provided by ST) + CSS | ST exposes `$` globally; avoids bundling a framework and keeps the extension lightweight |
| Data layer | Pure JS modules with no DOM/ST imports | Unit-testable in Node without a browser shim |
| Tests | Node built-in test runner (`node --test`) + JSONL fixtures | Zero-dependency testability for the model/store/io layers |
| Build | None for v1 (ST loads the folder directly) | Simpler install (Extensions -> Install from URL); a webpack build may be added later if needed |
| Docs | `dev_docs/` + `change_log/` workflow (project-docs-workflow skill) | Append-only design and change history with no process overhead |
| Version control | git | Standard local history; pairs with `change_log/` |

## Compatibility Targets

- SillyTavern >= 1.12 for the native hide-message feature.
- Behavior verified on the 1.15/1.16 line (macros, reasoning blocks, unified
  group metadata); group-chat support lands in a later milestone.
- Data format is a strict superset of native JSONL: all added fields live in
  `chat_metadata.st_floor` and `extra.st_floor`; no existing ST field is
  repurposed except `is_hidden`, which is applied to non-active anchors
  exactly as the native hide action would.

## Key Risks in the Stack

- ST event names and message action internals change between releases; the
  `actions/` layer must be the only place touching those internals.
- Hidden-message semantics (display + context) must be confirmed per release;
  if context filtering changes, `store/` falls back to stripping non-active
  anchors before the prompt is built.


<!-- VERSION 2 -->
## v2 - 2026-08-02 02:53:40 - align with ST-native branch-file storage; rollback = chat switch

## Choices

| Area | Choice | Rationale |
|------|--------|-----------|
| Language | JavaScript (ES Modules) | SillyTavern UI extensions load plain JS in the browser context; no compile step required |
| UI | Vanilla JS + jQuery (provided by ST) + CSS | ST exposes `$` globally; avoids bundling a framework and keeps the extension lightweight |
| Data layer | Pure JS modules with no DOM/ST imports | Unit-testable in Node without a browser shim |
| Tests | Node built-in test runner (`node --test`) + JSONL fixtures | Zero-dependency testability for the model/io layers |
| Build | None for v1 (ST loads the folder directly) | Simpler install (Extensions -> Install from URL); a webpack build may be added later if needed |
| Docs | `dev_docs/` + `change_log/` workflow (project-docs-workflow skill) | Append-only design and change history with no process overhead |
| Version control | git | Standard local history; pairs with `change_log/` |

## Compatibility Targets

- SillyTavern 1.15/1.16 line: native chat branching, checkpoint links,
  reasoning blocks, chat-file APIs.
- Group-chat support lands in a later milestone.
- Data format is a strict superset of native JSONL: the ONLY added field is
  `chat_metadata.st_floor` (branch identity). No ST field is repurposed; no
  `is_hidden` usage, no per-message anchor fields. Branch files are ordinary
  ST chats and work without the extension.

## Key Risks in the Stack

- ST event names, chat-file APIs, and the branch/checkpoint creation path
  change between releases; `actions/` and `store/` are the only layers
  touching them.
- Reading all chat files to build the panel index (Timelines-style) is proven
  to work; creating/switching files from a UI extension must be verified in
  M2, with a documented fallback (instruct the user to use native "Create
  Branch" and have the panel adopt the file afterwards).
