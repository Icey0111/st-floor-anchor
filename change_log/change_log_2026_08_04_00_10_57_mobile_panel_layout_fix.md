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
