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
