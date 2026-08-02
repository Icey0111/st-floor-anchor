# remove — Read This First

> ⚠️ MANDATORY: Before reading or writing ANY file in `remove/`, read this file
> completely. It defines how destructive actions are backed up. If this file and
> any external guidance disagree, this file wins.

## Purpose

`remove/` is a pre-destruction backup vault. BEFORE any destructive action, a
verbatim backup of the affected content is saved here, so every deletion or
overwrite is recoverable.

Back up BEFORE (never after) the action, for all of these cases:

- deleting a file;
- deleting code inside a file;
- overwriting a file;
- overwriting source code inside a file.

## Whole-File Snapshots

Always snapshot the ENTIRE pre-change source file — even when only a few lines
are deleted or overwritten. Whole-file snapshots restore reliably; partial
diffs do not. `dev_docs/` has its own in-file versioning, so it is NOT backed
up here.

## One Directory Per Action

Each destructive action produces exactly ONE timestamped entry directory:

    remove/remove_<YYYY>_<MM>_<DD>_<HH>_<MM>_<SS>_<slug>/
    ├── manifest.md                 # what/why/original paths/how to restore
    └── files/<original/relative/path>   # verbatim backup, original path preserved

- The timestamp MUST be real system time, never invented.
- The original relative path is preserved under `files/` so restore is exact.
- If one action touches several files, back them all up in the same entry.

## Manifest Required Fields

Each `manifest.md` must record:

1. Action type (delete / overwrite).
2. Reason (why the content is being removed).
3. Original paths backed up.
4. Restore instructions.
5. Related `change_log/` entry.

## Append-Only History

`remove/` is immutable. Never edit or delete an existing entry — that would
defeat the safety net. Superseded backups simply remain.

## Scope

Back up source, text, and user content. Do NOT back up `.git/`, build
artifacts, `node_modules/`, caches, or large binaries.

## Relationship to Git

This vault is a within-session safety net that also protects uncommitted
overwrites and projects without Git. It complements, and does not replace,
version control.

## Restore

Restore an entry with the helper script (it refuses to clobber existing files
unless forced):

    python <skill>/scripts/restore_remove.py <entry-name> --root <project-root>
