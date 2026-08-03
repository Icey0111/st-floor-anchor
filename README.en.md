# ST Floor Anchor

> Floor-level chat snapshots & rollback panel · a SillyTavern / TauriTavern frontend extension

Automatically backs up the current chat **before** every regenerate (roll), delete, or edit — then roll back to any historical branch from a panel with one click. Backups are stored as native chat files (marked `[FA]` in the file name) and hidden from SillyTavern's built-in chat lists, so they never clutter your normal chat management.

- Language: [中文](README.md)
- Version: v0.1.7 (SillyTavern 1.18+, TauriTavern mobile compatible)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Screenshots

![Branch panel](docs/screenshot-panel.png)

![New character message floor](docs/screenshot-composer.png)

## Features

- **Automatic snapshots** before regenerate / delete / edit, with content fingerprint dedupe (a failed roll while the API is disconnected won't create junk backups).
- **Branch tree panel** with recursive ids (`br_000` → `br_000-1` → `br_000-1-1`) so rollback paths are easy to read.
- **One-click rollback** — Switch to any historical snapshot (rollback is just switching chats).
- **Snapshot management** — Prune removes unwanted snapshots (ids are renumbered automatically) with a two-step confirmation.
- **Per-chat isolation** — every chat gets its own independent undo tree; switching chats or character cards never mixes trees.
- **Body previews** — each branch shows the last message body (marquee scroll for long text); preset status bars / thinking tags can be filtered out.
- **New character message floor** — when a reply gets stuck in thinking with no body (the floor becomes non-editable), create a fresh character floor with the recovered text (a `rescue` snapshot is created automatically).

## Installation

### SillyTavern (desktop)

1. Open **Extensions → Install extension**.
2. Paste the repository URL:

   ```
   https://github.com/Icey0111/st-floor-anchor
   ```

3. Refresh the page after installation.

Or install from a direct zip link:

```
https://github.com/Icey0111/st-floor-anchor/archive/refs/heads/main.zip
```

### TauriTavern (mobile)

Paste the same repository URL in the extension installer. Mobile is fully adapted: centered, draggable, half-screen footprint, safe-area and IME avoidance.

## Usage

1. Open the panel via the small icon in a message's action row (between the pencil and the "…" menu).
2. Every regenerate / delete / edit automatically creates a snapshot, and a new branch appears in the panel.
3. Click **Switch** (history icon) to roll back to a snapshot; click **Prune** (trash icon) to delete a snapshot.
4. Use the **+** button (top-right) to create a new character message floor: paste text that got stuck in thinking and click Add floor (or Ctrl+Enter).
5. Settings (Extensions panel → Floor Anchor drawer): preview length and XML tags to filter out of previews.

## Branch id scheme

| Id | Meaning |
|----|---------|
| `br_000` | Root of the current chat |
| `br_000-1` / `br_000-2` | Snapshots under the root |
| `br_000-1-1` | Recursive branch created from snapshot `br_000-1` |

Every chat numbers independently from `br_000`; the panel always shows the tree of the currently open chat.

## FAQ

**Where are the backups stored?**
As native chat files in the character's chat directory, marked with `[FA]`, hidden from SillyTavern's native chat lists.

**Why does the root node have no Prune button?**
The root is the live chat itself; deleting it would delete the whole conversation. Prune is snapshot-only.

**Are group chats supported?**
Not yet (v1 is solo chats only); no snapshots are created in group chats.

**How do I uninstall and clean up backups?**
Remove the extension in ST's extension manager, then delete the `.jsonl` files with `[FA]` in their names from the chat directory.

**The preview shows thinking instead of the body?**
Previews only use the message body (`mes`); the reasoning chain is never previewed. If a preset wraps the body in custom tags, add those tags to the filter list in settings.

## Compatibility

- SillyTavern 1.18+ (desktop)
- TauriTavern (mobile, safe-area / IME aware)
- Pure frontend extension, no Node backend

## For developers

- Design docs: `dev_docs/`
- Unit tests: `npm test`
- Browser regression scripts: `.regression/` (local only, not committed)

Feedback and suggestions are welcome via [GitHub Issues](https://github.com/Icey0111/st-floor-anchor/issues).
