/**
 * TauriTavern mobile layout ABI wiring (best-effort, optional).
 *
 * On plain SillyTavern (or desktop) this module is a no-op: the CSS
 * env(safe-area-inset-*) + media-query fallback already keeps the panel on
 * screen. On TauriTavern (Android/iOS) the host exposes
 * `window.__TAURITAVERN__.api.layout`; we opt the panel into the host's
 * safe-area / IME contract (`data-tt-mobile-surface`) and clamp it to the
 * host-reported safe frame so it can never be pushed off-screen.
 */

function clampRect(root, snap) {
  if (!root || !snap?.safeFrame) return;
  const pad = 10;
  const top = Math.max(pad, Number(snap.safeInsets?.top) || 0);
  const bottom = Math.max(
    pad,
    Number(snap.ime?.viewportBottomInset) || Number(snap.safeInsets?.bottom) || 0,
  );
  const left = Math.max(pad, Number(snap.safeInsets?.left) || 0);
  const right = Math.max(pad, Number(snap.safeInsets?.right) || 0);
  const maxHeight = Math.max(120, Number(snap.safeFrame?.height) - pad * 2);

  root.style.setProperty('--stfloor-top', `${top}px`);
  root.style.setProperty('--stfloor-bot', `${bottom}px`);
  root.style.setProperty('--stfloor-left', `${left}px`);
  root.style.setProperty('--stfloor-right', `${right}px`);
  root.style.setProperty('--stfloor-max-h', `${maxHeight}px`);
}

/**
 * Wire the panel into TauriTavern's mobile layout contract when available.
 * Resolves to a cleanup function; on plain ST / desktop this is a no-op and
 * the layout API is never imported (avoids a 404 in the console).
 */
export async function wireTauriMobileLayout(root) {
  if (typeof window === 'undefined' || !window.__TAURITAVERN__?.api?.layout) {
    return () => {};
  }

  try {
    const kit = await import('/scripts/tauritavern/layout-kit.js');
    const layout = kit.getHostAbi?.()?.api?.layout ?? window.__TAURITAVERN__.api.layout;
    if (!layout?.subscribe) return () => {};

    // Explicit opt-in: the host's overlay classifier treats the panel as an
    // IME/safe-area-aware interactive window instead of guessing its role.
    root.setAttribute('data-tt-mobile-surface', 'fullscreen-window');

    try {
      await kit.waitForHostReady?.();
    } catch {
      // Non-fatal: subscribe below may still work once ready.
    }

    let unsubscribe = null;
    unsubscribe = await layout.subscribe((snap) => clampRect(root, snap));
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // Idempotent cleanup.
      }
    };
  } catch {
    return () => {};
  }
}
