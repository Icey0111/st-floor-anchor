/**
 * TauriTavern mobile layout ABI wiring (best-effort, optional).
 *
 * On plain SillyTavern (or desktop) this module is a no-op: the CSS
 * env(safe-area-inset-*) + media-query fallback already keeps the panel on
 * screen. On TauriTavern (Android/iOS) the host exposes
 * `window.__TAURITAVERN__.api.layout`; we opt the panel into the host's
 * surface taxonomy and clamp it to the host-reported safe frame so it can
 * never be pushed off-screen.
 *
 * IMPORTANT: the panel must be declared `free-window`, NOT
 * `fullscreen-window`. TauriTavern's mobile geometry firewall forces
 * `fullscreen-window` elements to fill the whole safe frame with
 * `max-height: none !important`, which would defeat our half-screen cap.
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
 * the host ABI is simply absent.
 */
export async function wireTauriMobileLayout(root) {
  const abi = typeof window === 'undefined' ? null : window.__TAURITAVERN__;
  const layout = abi?.api?.layout;
  if (!layout?.subscribe) {
    return () => {};
  }

  try {
    try {
      await (abi.ready ?? Promise.resolve());
    } catch {
      // Non-fatal: subscribe below may still work.
    }

    // Explicit opt-in as a floating window: the host's geometry firewall has
    // no free-window rules, so our own CSS sizing (half-screen cap, safe
    // areas) keeps full control.
    root.setAttribute('data-tt-mobile-surface', 'free-window');

    let unsubscribe = null;
    try {
      unsubscribe = await layout.subscribe((snap) => clampRect(root, snap));
    } catch {
      // Non-fatal: CSS fallbacks still apply.
    }
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
