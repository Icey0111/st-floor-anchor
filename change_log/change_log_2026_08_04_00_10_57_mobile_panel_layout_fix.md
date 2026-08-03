# mobile_panel_layout_fix

- Date: 2026-08-04 00:10:57
- Session: User reported the panel window runs off the top of the screen and
  overflows on mobile (TauriTavern / SillyTavern mobile).

## Problem / Requirement
On mobile the Floor Anchor panel is misplaced: the window jumps to the very
top of the screen and the panel exceeds the viewport. The desktop layout
(`position: fixed; top: 70px; right: 20px; width: 470px; max-height: 70vh`)
is not safe on phones and ignores safe areas / the TauriTavern mobile
layout ABI.

## Purpose of Change
Make the panel (and the prune confirm dialog) always fully visible on mobile
in both SillyTavern and TauriTavern: respect safe-area insets, cap the size to
the viewport, and opt into TauriTavern's `data-tt-mobile-surface` + layout
snapshot contract so the host cannot push it off-screen.

## How It Was Changed
- [D:\stplugin\src\ui\mobile-layout.js L1-L80](file:///D:/stplugin/src/ui/mobile-layout.js#L1) - new module: gated on `window.__TAURITAVERN__?.api?.layout` (never imports on plain ST), marks the panel `data-tt-mobile-surface="fullscreen-window"`, subscribes to layout snapshots and clamps the panel via `--stfloor-*` custom properties (safe frame + IME bottom inset)
- [D:\stplugin\src\ui\branch-panel.js L220-L260](file:///D:/stplugin/src/ui/branch-panel.js#L220) - prune confirm overlay/panel declare `data-tt-mobile-surface` (`backdrop` / `fullscreen-window`)
- [D:\stplugin\src\ui\branch-panel.js L280-L310](file:///D:/stplugin/src/ui/branch-panel.js#L280) - `markStMobileShell()`: when ST mobile CSS has made `body` a fixed viewport shell (which zeroes the fixed containing block under `html { -webkit-transform: translateZ(0) }`), add `stfloor-mobile-shell` to body so the panel anchors to the fixed shell instead; checked at boot, at panel show, and once after 1s
- [D:\stplugin\src\style.css L1-L30](file:///D:/stplugin/src/style.css#L1) - `box-sizing: border-box` on panel and confirm panel
- [D:\stplugin\src\style.css L130-L230](file:///D:/stplugin/src/style.css#L130) - mobile media query (`max-width: 640px` / `max-height: 640px`): bottom-anchored sheet layout using `--stfloor-*` (JS), `env(safe-area-inset-*)` and TauriTavern `--tt-inset-*` / `--tt-viewport-bottom-inset`; `body.stfloor-mobile-shell` switches the panel and overlay to `position: absolute` (relative to the fixed body shell)
- [D:\stplugin\.regression\mobile-layout-check.mjs L1-L180](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L1) - new gitignored harness: mobile portrait (390x844) and landscape (844x390) viewports assert the panel and prune confirm dialog stay inside the viewport
- [D:\stplugin\manifest.json L2](file:///D:/stplugin/manifest.json#L2) - version bumped to 0.1.1

## Result
- Unit tests: 32/32 pass.
- Mobile layout regression: 11/11 pass (portrait + landscape panel fully
  inside viewport, bottom-anchored, confirm dialog contained, no console
  errors; throwaway test character cleaned up).
- Desktop regression: 21/21 pass (no behavior change on desktop).
- Root cause documented: ST mobile CSS sets `body { position: fixed }` while
  `html` keeps `-webkit-transform: translateZ(0)`, making `position: fixed`
  descendants anchor to a zero-height html box; bottom/right-anchored panels
  therefore render above the screen. ST's own top-anchored fixed elements are
  unaffected, which is why the app itself looked fine.
- Released as v0.1.1.

---

# Mobile panel footprint reduced to ~half the screen

- Date: 2026-08-04 00:14:30
- Session: Same conversation; after v0.1.1 the mobile panel fills the whole
  phone screen, user asked to shrink it to about half the screen.

## Problem / Requirement
On mobile the bottom-anchored sheet spans the full width and up to ~90% of
the viewport height, so with many branch nodes it occupies the entire phone
screen. The user wants the panel footprint reduced to roughly half the screen.

## Purpose of Change
Cap the mobile panel at half the viewport height (full width retained, content
scrolls inside), keeping it inside safe areas and the TauriTavern layout
clamp. The prune-confirm dialog stays full-screen as a modal.

## How It Was Changed
- [D:\stplugin\src\style.css L130-L190](file:///D:/stplugin/src/style.css#L130) - mobile `max-height` now `min(50dvh, var(--stfloor-max-h, calc(...)))` (with a 50vh fallback line), so the panel never exceeds half the viewport height even when TauriTavern's JS clamp supplies a taller safe-frame value
- [D:\stplugin\.regression\mobile-layout-check.mjs L90-L110](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L90) - assertions extended: computed `max-height` <= 55% of viewport and panel area <= ~62% of the screen
- [D:\stplugin\manifest.json L2](file:///D:/stplugin/manifest.json#L2) - version bumped to 0.1.2

## Result
- Unit tests: 32/32 pass.
- Mobile layout regression: 13/13 pass - portrait computed max-height 422px
  (50dvh of 844), landscape 195px (50dvh of 390); panel fully inside viewport
  and bottom-anchored in both orientations.
- Desktop regression: 21/21 pass (no behavior change).
- Released as v0.1.2.

---

# v0.1.3: panel no longer fullscreen on TauriTavern mobile (surface fix)

- Date: 2026-08-04 00:30:00
- Session: Same conversation; after v0.1.2 the panel still filled the whole
  phone screen on TauriTavern.

## Problem / Requirement
Even with the 50dvh cap, TauriTavern mobile kept showing the panel fullscreen.
The panel was declared `data-tt-mobile-surface="fullscreen-window"`; the host's
mobile geometry firewall forces such elements to fill the whole safe frame
with `max-height: none !important`, which cancels our half-screen cap.

## Purpose of Change
Stop declaring the panel (and the small confirm dialog) as fullscreen surfaces
so TauriTavern never overrides their geometry: the panel becomes
`free-window` (host has no geometry rules for it) and the confirm dialog
explicitly opts out with `none`. The wiring now talks to
`window.__TAURITAVERN__.api.layout` directly instead of importing
`/scripts/tauritavern/layout-kit.js`, so the clamp is testable and does not
depend on a TT-only module path.

## How It Was Changed
- [D:\stplugin\src\ui\mobile-layout.js L30-L80](file:///D:/stplugin/src/ui/mobile-layout.js#L30) - surface changed to `free-window`; removed the dynamic import of layout-kit.js (uses the ABI directly, waits on `abi.ready`); keeps subscribing to layout snapshots for safe-frame/IME clamping
- [D:\stplugin\src\ui\branch-panel.js L220-L235](file:///D:/stplugin/src/ui/branch-panel.js#L220) - confirm dialog surface changed from `fullscreen-window` to `none` (overlay stays `backdrop`)
- [D:\stplugin\.regression\mobile-layout-check.mjs L20-L80](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L20) - new `tt-mobile` scenario: injects a fake `window.__TAURITAVERN__` layout ABI and a copy of the host firewall CSS, then asserts the panel stays `free-window`, keeps the 50dvh cap and receives the ABI clamp (bottom inset 34px)
- [D:\stplugin\manifest.json L2](file:///D:/stplugin/manifest.json#L2) - version bumped to 0.1.3

## Result
- Unit tests: 32/32 pass.
- Mobile layout regression: 22/22 pass - including the simulated-TauriTavern
  scenario where the host firewall is present: panel surface `free-window`,
  max-height still capped at 50dvh (422px portrait), bottom anchored at the
  ABI-reported inset (34px), confirm dialog surface `none`, everything inside
  the viewport.
- Desktop regression: 21/21 pass (no behavior change).
- Released as v0.1.3.

---

# v0.1.4: centered + draggable floating panel

- Date: 2026-08-04 00:45:00
- Session: Same conversation; user asked the panel window to be centered on
  the screen and draggable.

## Problem / Requirement
The panel was a fixed-position window anchored to a corner/edge. The user
wants the window centered on the screen by default and draggable (mouse and
touch), while keeping the half-screen mobile footprint and all previous
mobile/TauriTavern fixes.

## Purpose of Change
Turn the panel into a true floating window: CSS centers it on first open
(`left/top: 50%` + `translate(-50%, -50%)`), and JS pointer handling drags it
by the header, clamping it inside the viewport / TauriTavern safe frame. The
dragged position is kept for the current session; opening again before a
reload re-centers only if it was never dragged.

## How It Was Changed
- [D:\stplugin\src\style.css L1-L40](file:///D:/stplugin/src/style.css#L1) - panel defaults to centered (`top/left: 50%`, `translate(-50%,-50%)`); header becomes a drag handle (`touch-action: none`, `cursor: grab`, `user-select: none`, inputs re-enabled); `body.stfloor-dragging` blocks text selection while dragging
- [D:\stplugin\src\style.css L130-L175](file:///D:/stplugin/src/style.css#L130) - mobile media query simplified: panel keeps `width: min(92dvw, 470px)` and the 50dvh cap; edge anchoring removed (JS owns left/top now)
- [D:\stplugin\src\ui\branch-panel.js L30-L110](file:///D:/stplugin/src/ui/branch-panel.js#L30) - floating-window logic: `getPanelInsets()` reads the TauriTavern `--stfloor-*` safe-frame vars, `clampToViewport()` bounds the window, `applyPosition()` writes inline left/top, `centerPanel()` centers on first open; pointerdown/move/up with `setPointerCapture` implements mouse+touch dragging; resize handler re-clamps
- [D:\stplugin\.regression\mobile-layout-check.mjs L150-L205](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L150) - assertions: panel centered on first open (+-3px), drag by the title moves the window down while keeping it inside the viewport/safe frame
- [D:\stplugin\manifest.json L2](file:///D:/stplugin/manifest.json#L2) - version bumped to 0.1.4

## Result
- Unit tests: 32/32 pass.
- Mobile layout regression: 28/28 pass - centered on first open in portrait,
  landscape and simulated-TauriTavern scenarios; drag moves the window and it
  stays inside the viewport; free-window surface and confirm-dialog opt-out
  still verified; no console errors.
- Desktop regression: 21/21 pass (desktop unchanged behaviorally, window now
  opens centered instead of top-right).
- Released as v0.1.4.

---

# v0.1.5: per-chat undo-tree isolation

- Date: 2026-08-04 01:00:00
- Session: Same conversation; user asked whether the plugin isolates chat
  history - i.e. switching chats in ST's built-in chat list should show a new
  undo tree per chat.

## Problem / Requirement
The plugin did not isolate chats: every chat was adopted with the same root id
(`br_000`), and `scanBranches()` aggregated ALL chat files of a character into
one tree. Switching chats therefore collided on the root id (the second chat
was skipped as a "duplicate") and its snapshots were attached to the first
chat's tree - a single mixed tree instead of one undo tree per chat.

## Purpose of Change
Give every ST chat its own independent undo tree. The panel always shows only
the tree the currently open chat belongs to; switching chats in ST's native
chat list swaps the panel to that chat's tree. Root id `br_000` remains shared
(ids are scoped per chat), so membership is carried explicitly.

## How It Was Changed
- [D:\stplugin\src\model\branches.js L40-L95](file:///D:/stplugin/src/model/branches.js#L40) - new pure `filterMetasToCurrentTree()`: root chats match by file name, snapshots match by the `main_chat` recorded on them; `createBranchIdCounter.reset()` added so per-chat numbering restarts on chat switch
- [D:\stplugin\src\store\helpers.js L163-L175](file:///D:/stplugin/src/store/helpers.js#L163) - `metaFromChatJson()` now also reads `chat_metadata.main_chat` into the meta
- [D:\stplugin\src\store\chat-api.js L160-L180](file:///D:/stplugin/src/store/chat-api.js#L160) - snapshots now record `main_chat` = the undo-tree root file (inherited by recursive branches), not just the immediate chat
- [D:\stplugin\src\store\chat-api.js L191-L300](file:///D:/stplugin/src/store/chat-api.js#L191) - `scanBranches()` filters to the current chat's tree before migration/dedupe/build; id counters reset per tree; the orphan fallback now exposes only the current plain chat
- [D:\stplugin\src\store\chat-api.js L300-L330](file:///D:/stplugin/src/store/chat-api.js#L300) - `renumberSnapshotsAfterPrune()` renumbers within the current tree only
- [D:\stplugin\tests\model.test.js L260-L320](file:///D:/stplugin/tests/model.test.js#L260) - unit test: two chats sharing the root id stay isolated; opening a snapshot resolves to its own tree; plain chats yield an empty tree
- [D:\stplugin\.regression\regression.mjs L385-L445](file:///D:/stplugin/.regression/regression.mjs#L385) - integration checks: seed a second chat with its own tree, switch to it (panel shows only that tree), switch back (original tree restored)
- [D:\stplugin\manifest.json L2](file:///D:/stplugin/manifest.json#L2) - version bumped to 0.1.5

## Result
- Unit tests: 33/33 pass (new isolation test included).
- Desktop regression: 24/24 pass - including "switching chats shows the new
  chat's isolated undo tree (br_000,br_000-1)" and "switching back restores
  the original tree (br_000,br_000-1,br_000-2)".
- Mobile layout regression: 28/28 pass (no layout regression).
- Released as v0.1.5.

---

# v0.1.6: JS-enforced half-screen cap (panel no longer covers chat bubbles)

- Date: 2026-08-04 01:40:00
- Session: Same conversation; user reported the little triangle next to the
  message bubble is gone on mobile and sent a screenshot.

## Problem / Requirement
The screenshot showed the Floor Anchor panel covering roughly 70% of the
screen, with the message bubble squeezed to a sliver at the bottom - the
bubble's side triangle is hidden behind the panel. The CSS half-screen cap
(`min(50dvh, ...)`) relies on `min()`/`dvh`, which older mobile WebViews
(e.g. TauriTavern on Android) do not support; those declarations are dropped
and the panel falls back to the base `70vh`, covering the chat.

## Purpose of Change
Enforce the half-screen cap with an inline `max-height` from JS, which always
wins over stylesheet rules regardless of CSS unit support. The panel then can
never cover more than the top half of the viewport on mobile, leaving the chat
bubbles (and their triangles) visible.

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L100-L125](file:///D:/stplugin/src/ui/branch-panel.js#L100) - `applyMobileCap()` sets `root.style.maxHeight` inline to 50% of `innerHeight` when the viewport matches the mobile query, and clears it on desktop; called at init, on show, and on resize
- [D:\stplugin\.regression\mobile-layout-check.mjs L155-L180](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L155) - new assertion: the inline `max-height` is present and equals ~50% of the viewport in every mobile scenario
- [D:\stplugin\manifest.json L2](file:///D:/stplugin/manifest.json#L2) - version bumped to 0.1.6

## Result
- Unit tests: 33/33 pass.
- Mobile layout regression: 31/31 pass - inline cap is exactly 422px on a
  844px-tall phone (50%); panel stays inside the viewport and draggable.
- Desktop regression: 24/24 pass (inline cap cleared on desktop; 70vh CSS
  unchanged).
- Leftover probe test characters cleaned up from the local ST instance.
- Released as v0.1.6.

---

# Rollback: v0.1.6 reverted back to v0.1.5 behavior

- Date: 2026-08-04 02:00:00
- Session: Same conversation; user asked to revert the v0.1.6 change (the
  JS-enforced half-screen cap) back to 0.1.5.

## Problem / Requirement
The v0.1.6 change (inline `max-height` = 50% viewport set from JS) was not
wanted after testing. The user asked to restore the v0.1.5 behavior, where the
mobile half-screen cap comes purely from the CSS media query
(`min(50dvh, var(--stfloor-max-h, 50dvh))`) with no JS inline override.

## Purpose of Change
Restore the exact v0.1.5 code state for the panel sizing while keeping the
audit trail: the v0.1.6 change-log entry stays as immutable history, and this
entry documents the correction (per project-docs-workflow append-only rules).

## How It Was Changed
- [D:\stplugin\src\ui\branch-panel.js L125-L150](file:///D:/stplugin/src/ui/branch-panel.js#L125) - removed `applyMobileCap()` and `MOBILE_QUERY` (added in v0.1.6); resize listener, `show()` and init no longer set an inline max-height
- [D:\stplugin\.regression\mobile-layout-check.mjs L155-L195](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L155) - removed the inline-cap assertion added in v0.1.6 (harness back to the v0.1.5 checks)
- [D:\stplugin\manifest.json L2](file:///D:/stplugin/manifest.json#L2) - version back to 0.1.5
- GitHub: v0.1.6 release + tag deleted; v0.1.5 remains the published version

## Result
- Unit tests: 33/33 pass.
- Mobile layout regression: 28/28 pass (back to the v0.1.5 assertion set).
- Desktop regression: 24/24 pass.
- Deployed copy under `D:\SillyTavern` synced back to the v0.1.5 code.

---

# v0.1.6: unified br_000 display + verified per-character/per-chat isolation

- Date: 2026-08-04 01:00:58
- Session: Same conversation; user reported that switching to another
  character card shows the chat record's raw name instead of br_000, and asked
  to unify the display and verify isolation across character cards / different
  chats of the same card.

## Problem / Requirement
When opening a plain ST chat (no `st_floor` metadata yet), `scanBranches()`
inserted a fallback node with the id `orphan_<current-file-name>`, so the panel
showed the raw chat record name (e.g. `orphan_以太界 - 2026-05-05@...`) instead
of the unified root id `br_000`. The user also asked to confirm the plugin
really isolates undo trees per character card and per chat (different users of
the same card).

## Purpose of Change
Every chat root is now always displayed as `br_000` regardless of whether the
chat was adopted yet, so the panel never leaks raw chat file names. At the same
time the active root (the live chat) can no longer be pruned from the panel -
previously the unmanaged node offered a Prune button that would delete the
current conversation. Isolation is re-verified at both the unit and browser
level, including two character cards sharing the exact same chat file name.

## How It Was Changed
- [src/model/branches.js L15-L40](file:///D:/stplugin/src/model/branches.js#L15-L40) - new pure `createOrphanRootMeta(fileName)` factory: unmanaged chats build an active root node with the unified id `br_000` while keeping the file name for rollback
- [src/store/chat-api.js L260-L280](file:///D:/stplugin/src/store/chat-api.js#L260-L280) - `scanBranches()` orphan fallback now uses `createOrphanRootMeta(currentFileName)` instead of `orphan_<fileName>`
- [src/ui/branch-panel.js L180-L205](file:///D:/stplugin/src/ui/branch-panel.js#L180-L205) - Prune button rendered only for `kind === 'snapshot'`; active roots get Switch only (safety: pruning the root would delete the live chat)
- [tests/model.test.js L90-L110](file:///D:/stplugin/tests/model.test.js#L90-L110) - unit test: orphan root meta uses `br_000`, builds a valid single-root `PanelIndex`, no `orphan_` id
- [.regression/regression.mjs L30-L95](file:///D:/stplugin/.regression/regression.mjs#L30-L95) - setup seeds a plain chat (`test-plain`, no st_floor) and a second character whose chat file is deliberately named `test-main` (same as character A) with a smaller tree
- [.regression/regression.mjs L430-L520](file:///D:/stplugin/.regression/regression.mjs#L430-L520) - browser checks: plain chat shows exactly `['br_000']` (no orphan_ prefix); active root has no Prune button; switching to character B's same-name chat shows only its own tree (`br_000,br_000-1`); switching back to character A restores its own tree (`br_000,br_000-1,br_000-2`); both characters cleaned up
- [.regression/mobile-layout-check.mjs L60-L90](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L60-L90) - seeds a snapshot (`br_000-1`) so the prune-confirm check targets a real snapshot row
- [.regression/mobile-layout-check.mjs L215-L235](file:///D:/stplugin/.regression/mobile-layout-check.mjs#L215-L235) - mobile harness asserts the active root has no Prune button and clicks Prune on the snapshot row instead
- [manifest.json L2-L2](file:///D:/stplugin/manifest.json#L2-L2) - version bumped to 0.1.6

## Result
- Unit tests: 34/34 pass (new orphan-root test included).
- Desktop regression: 30/30 pass - including "plain chat displays unified
  br_000 root (no orphan_ prefix)", "active root cannot be pruned", "character
  B with same chat name shows its own isolated tree", and "switching back to
  character A restores its own tree".
- Mobile layout regression: 30/30 pass - root Prune button absent in portrait
  and simulated-TauriTavern scenarios; prune confirm still contained.
- Deployed copy under `D:\SillyTavern` synced (manifest 0.1.6).
- Isolation model confirmed: per-character via avatar-scoped chat scans, and
  per-chat within a character via `main_chat` + file-name filtering
  (`filterMetasToCurrentTree`); ST user profiles are separated by data folder.
- Not released to GitHub yet (local dev version 0.1.6; publish on request).

---

# Plain-chat root now shows the body preview after switching character cards

- Date: 2026-08-04 01:06:39
- Session: Same conversation; after the unified br_000 display shipped, the
  user reported that switching to another character card shows no body
  preview (正文预览) for the current chat.

## Problem / Requirement
When the currently open chat is a plain ST chat (no `st_floor` metadata yet),
`scanBranches()` renders it through the orphan fallback. The fallback meta was
created from scratch without a preview, so the panel showed `br_000` with an
empty preview area - the body text used to tell branches apart was missing
until the chat was adopted (debounced metadata save) and re-scanned.

## Purpose of Change
Give the unmanaged `br_000` root the same derived body preview as managed
roots, so switching to any character card immediately shows the current
chat's last message text in the panel.

## How It Was Changed
- [src/model/branches.js L15-L40](file:///D:/stplugin/src/model/branches.js#L15-L40) - `createOrphanRootMeta(fileName, preview)` now accepts an optional display-only preview
- [src/store/chat-api.js L65-L105](file:///D:/stplugin/src/store/chat-api.js#L65-L105) - `fetchAllBranchMetas()` computes the preview for every chat file (not only st_floor-managed ones) and returns a `previews` map keyed by file name
- [src/store/chat-api.js L265-L285](file:///D:/stplugin/src/store/chat-api.js#L265-L285) - orphan fallback passes the current chat's preview into `createOrphanRootMeta`
- [tests/model.test.js L90-L115](file:///D:/stplugin/tests/model.test.js#L90-L115) - unit test covers the optional preview on orphan root metas
- [.regression/regression.mjs L505-L515](file:///D:/stplugin/.regression/regression.mjs#L505-L515) - browser check: the plain chat's `br_000` row shows the body preview ("Assistant reply ...")

## Result
- Unit tests: 34/34 pass.
- Desktop regression: 31/31 pass - new "plain chat root shows body preview"
  assertion passes.
- Mobile layout regression: 30/30 pass (no layout change).
- Deployed copy under `D:\SillyTavern` synced; committed and pushed to GitHub
  (main).
