/**
 * Branch/snapshot panel. Renders the PanelIndex as a tree; switching a node
 * is the rollback operation (switch chat). Snapshots can be pruned.
 */
import { parseBranchId } from '../model/branches.js';
import { wireTauriMobileLayout } from './mobile-layout.js';

export function createBranchPanel({ onRefresh, onSwitch, onDelete, onAddMessage, onClose } = {}) {
  const root = document.createElement('div');
  root.id = 'stfloor-panel';
  root.className = 'stfloor-panel';
  root.style.display = 'none';

  root.innerHTML = `
    <div class="stfloor-panel-header">
      <span class="stfloor-panel-title">Floor Anchor</span>
      <button class="stfloor-panel-btn stfloor-panel-gohome" title="Return to the main root chat (you are on a branch snapshot)" style="display: none;">&#10554;&#32;Main</button>
      <input class="stfloor-panel-search" type="search" placeholder="Search branches..." title="Filter by id / reason / preview text">
      <button class="stfloor-panel-btn stfloor-add-message" title="New character message floor (paste text stuck in thinking)">+</button>
      <button class="stfloor-panel-btn stfloor-refresh" title="Rescan branch files">Refresh</button>
      <button class="stfloor-panel-btn stfloor-close" title="Close panel">X</button>
    </div>
    <div class="stfloor-panel-body"></div>
  `;

  const body = root.querySelector('.stfloor-panel-body');
  const goHomeBtn = root.querySelector('.stfloor-panel-gohome');
  root.querySelector('.stfloor-add-message').addEventListener('click', () => showComposer());
  root.querySelector('.stfloor-refresh').addEventListener('click', () => onRefresh?.());
  goHomeBtn.addEventListener('click', () => {
    if (currentRootFileName && onSwitch) onSwitch(currentRootFileName);
  });
  root.querySelector('.stfloor-close').addEventListener('click', () => { root.style.display = 'none'; onClose?.(); });

  // Tree navigation state: per-chat collapse sets. Every chat's root shares
  // the id `br_000`, so collapse state must be scoped to the chat currently
  // rendered, otherwise collapsing root in chat A would also collapse chat
  // B's tree. `currentScope` is the chat file name the panel last rendered.
  const collapsedByScope = new Map();
  let currentScope = null;
  let currentRootFileName = null;
  let searchTerm = '';
  let currentIndex = null;
  const searchInput = root.querySelector('.stfloor-panel-search');
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value;
    if (currentIndex) render(currentIndex, currentScope);
  });

  // ---------- floating window: centered by default, draggable via header ----------
  const header = root.querySelector('.stfloor-panel-header');
  let panelPos = null; // { left, top } in px (viewport-relative); null = centered
  let dragState = null;

  function getPanelInsets() {
    const cs = getComputedStyle(root);
    const read = (name, fallback) => {
      const raw = cs.getPropertyValue(name);
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      left: read('--stfloor-left', 8),
      top: read('--stfloor-top', 8),
      right: read('--stfloor-right', 8),
      bottom: read('--stfloor-bot', 8),
    };
  }

  function clampToViewport(left, top) {
    const rect = root.getBoundingClientRect();
    const insets = getPanelInsets();
    const m = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minLeft = insets.left + m;
    const minTop = insets.top + m;
    const maxLeft = Math.max(minLeft, vw - insets.right - rect.width - m);
    const maxTop = Math.max(minTop, vh - insets.bottom - rect.height - m);
    return {
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, minTop), maxTop),
    };
  }

  function applyPosition(pos) {
    if (!pos) return;
    const clamped = clampToViewport(pos.left, pos.top);
    panelPos = clamped;
    root.style.left = `${clamped.left}px`;
    root.style.top = `${clamped.top}px`;
    root.style.transform = 'none'; // JS takes over from the CSS centering
  }

  function centerPanel() {
    const rect = root.getBoundingClientRect();
    applyPosition({
      left: (window.innerWidth - rect.width) / 2,
      top: (window.innerHeight - rect.height) / 2,
    });
  }

  header.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input, textarea, select')) return;
    if (typeof event.button === 'number' && event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseLeft: rect.left,
      baseTop: rect.top,
      moved: false,
    };
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      // Non-fatal.
    }
    event.preventDefault();
    document.body.classList.add('stfloor-dragging');
  });

  header.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    dragState.moved = true;
    applyPosition({ left: dragState.baseLeft + dx, top: dragState.baseTop + dy });
  });

  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState = null;
    document.body.classList.remove('stfloor-dragging');
  }
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => {
    if (panelPos && root.style.display !== 'none') applyPosition(panelPos);
  });

  /**
   * Enable the marquee only when the text really overflows the box, and bound
   * the scroll range by the box edges: translateX(0) shows the text start at
   * the left boundary, the final state shows the text end at the right
   * boundary (no blank overscroll). Must run while the panel is visible -
   * display:none reports zero sizes.
   */
  function applyPreviewScroll() {
    for (const row of body.querySelectorAll('.stfloor-node')) {
      const box = row.querySelector('.stfloor-node-preview');
      const inner = row.querySelector('.stfloor-node-preview-inner');
      if (!box || !inner) continue;
      // border(1) + padding-left(6) are not part of the content area.
      // 2px tolerance avoids marquee flicker on borderline fits (sub-pixel).
      // Content area = clientWidth minus left/right borders (1+1) and
      // left/right padding (8+8).
      const distance = (box.clientWidth - 18) - (inner.textContent ? inner.scrollWidth : 0);
      if (distance < -2) {
        inner.classList.add('stfloor-marquee');
        inner.style.setProperty('--stfloor-scroll-distance', `${distance}px`);
      } else {
        inner.classList.remove('stfloor-marquee');
        inner.style.removeProperty('--stfloor-scroll-distance');
      }
    }
  }

  function render(index, scopeKey = currentScope ?? '', rootFileName = currentRootFileName ?? null) {
    // New chat tree: start with a clean view (search + collapse per chat).
    if (scopeKey !== currentScope) {
      currentScope = scopeKey;
      searchTerm = '';
      searchInput.value = '';
    }
    currentRootFileName = rootFileName;
    // The "back to main root" escape hatch is only useful while the user is
    // on a branch snapshot (the current scope differs from the tree's root).
    goHomeBtn.style.display = currentRootFileName && currentScope && currentScope !== currentRootFileName ? '' : 'none';
    const collapsed = collapsedByScope.get(currentScope) ?? new Set();
    if (!index) {
      body.innerHTML = '<div class="stfloor-empty">No branch data yet.<br>Roll or delete a message to create a snapshot.</div>';
      return;
    }
    const nodes = [...index.nodes.values()];
    if (!nodes.length) {
      body.innerHTML = '<div class="stfloor-empty">No branch data yet.<br>Roll or delete a message to create a snapshot.</div>';
      return;
    }

    const list = document.createElement('div');
    list.className = 'stfloor-tree';

    // children map for expand/collapse toggles.
    const childrenByParent = new Map();
    for (const node of nodes) {
      const key = node.parent ?? '';
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(node.id);
    }
    const hasChildren = (id) => (childrenByParent.get(id ?? '')?.length ?? 0) > 0;

    // Tree order: roots first (top), then every branch's children below it,
    // siblings sorted by their numeric path - never the file-list order.
    const compareIds = (a, b) => {
      const pa = parseBranchId(a);
      const pb = parseBranchId(b);
      if (!pa && !pb) return String(a).localeCompare(String(b));
      if (!pa) return 1;
      if (!pb) return -1;
      if (pa.root !== pb.root) return Number(pa.root) - Number(pb.root);
      const len = Math.min(pa.segments.length, pb.segments.length);
      for (let i = 0; i < len; i++) {
        if (pa.segments[i] !== pb.segments[i]) return pa.segments[i] - pb.segments[i];
      }
      return pa.segments.length - pb.segments.length;
    };
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const orderedNodes = [];
    const seen = new Set();
    const visit = (id) => {
      if (seen.has(id) || !byId.has(id)) return;
      seen.add(id);
      orderedNodes.push(byId.get(id));
      const kids = (childrenByParent.get(id) ?? []).slice().sort(compareIds);
      for (const kid of kids) visit(kid);
    };
    for (const rootId of (childrenByParent.get('') ?? []).slice().sort(compareIds)) visit(rootId);
    for (const node of nodes) {
      if (!seen.has(node.id)) visit(node.id); // orphans / unlinked nodes
    }

    // Search: matching nodes plus their ancestors (collapse ignored).
    const query = searchTerm.trim().toLowerCase();
    const matched = new Set();
    if (query) {
      for (const node of nodes) {
        const hay = `${node.id} ${node.reason} ${node.sourceFloor ?? ''} ${node.preview ?? ''}`.toLowerCase();
        if (!hay.includes(query)) continue;
        let cursor = node;
        while (cursor) {
          matched.add(cursor.id);
          cursor = cursor.parent ? index.get(cursor.parent) : null;
        }
      }
    }

    // Visibility: without search, a node is hidden only when one of its
    // ANCESTORS is explicitly collapsed (the collapsed node itself stays
    // visible as the subtree's header). During search, matched nodes and
    // their ancestors are always shown (collapse ignored).
    const visible = new Set();
    for (const node of orderedNodes) {
      if (query) {
        if (matched.has(node.id)) visible.add(node.id);
        continue;
      }
      let cursor = node.parent ? index.get(node.parent) : null;
      let hidden = false;
      while (cursor) {
        if (collapsed.has(cursor.id)) {
          hidden = true;
          break;
        }
        cursor = cursor.parent ? index.get(cursor.parent) : null;
      }
      if (!hidden) visible.add(node.id);
    }

    for (const node of orderedNodes) {
      if (!visible.has(node.id)) continue;
      const depth = index.getPath(node.id).length - 1;
      const row = document.createElement('div');
      row.className = 'stfloor-node';
      row.style.marginLeft = `${depth * 14}px`;
      row.dataset.branchId = node.id;

      const isCollapsed = collapsed.has(node.id);
      const toggle = document.createElement('button');
      toggle.className = 'stfloor-node-toggle';
      toggle.title = isCollapsed ? 'Expand subtree' : 'Collapse subtree';
      toggle.textContent = hasChildren(node.id) ? (isCollapsed ? '▸' : '▾') : '';
      if (hasChildren(node.id)) {
        toggle.addEventListener('click', () => {
          const set = collapsedByScope.get(currentScope) ?? new Set();
          collapsedByScope.set(currentScope, set);
          if (set.has(node.id)) set.delete(node.id);
          else set.add(node.id);
          render(index, currentScope);
        });
      } else {
        toggle.disabled = true;
      }

      const icon = node.kind === 'snapshot' ? '&#128190;' : '&#128172;'; // 💾 / 💬
      const isActive = !!currentScope && node.fileName === currentScope;
      if (isActive) row.classList.add('stfloor-node-active');
      const label = document.createElement('span');
      label.className = 'stfloor-node-label';
      label.innerHTML = `${icon} <b>${node.id}</b>${isActive ? ' <span class="stfloor-node-active-badge">current</span>' : ''}` +
        ` <span class="stfloor-node-reason">${node.reason}</span>` +
        (node.sourceFloor ? ` <span class="stfloor-node-floor">@floor ${node.sourceFloor}</span>` : '');

      const preview = document.createElement('span');
      preview.className = 'stfloor-node-preview';
      const previewInner = document.createElement('span');
      previewInner.className = 'stfloor-node-preview-inner';
      previewInner.textContent = node.preview || '';
      if (node.preview) preview.title = node.preview;
      preview.append(previewInner);

      const actions = document.createElement('span');
      actions.className = 'stfloor-node-actions';

      const switchBtn = document.createElement('button');
      switchBtn.className = 'stfloor-node-btn stfloor-switch';
      switchBtn.title = 'Rollback: switch to this chat';
      switchBtn.innerHTML = '<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>';
      switchBtn.addEventListener('click', () => {
        if (node.fileName) {
          onSwitch?.(node.fileName);
        } else {
          console.warn(`[Floor Anchor] cannot switch: no file name for branch ${node.id}`);
        }
      });

      // Only snapshots can be pruned. The active root is the live chat file;
      // offering Prune there (especially for unmanaged chats shown as br_000)
      // would let a misclick delete the conversation itself.
      if (node.kind === 'snapshot') {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'stfloor-node-btn stfloor-delete';
        deleteBtn.title = 'Prune this snapshot file';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>';
        deleteBtn.addEventListener('click', () => {
          if (node.fileName) showPruneConfirm(node.id, node.fileName, node.parent);
        });
        actions.append(switchBtn, deleteBtn);
      } else {
        actions.append(switchBtn);
      }
      // Preview grows between the label and the buttons, so both vertical
      // divider lines stay close to their neighbours (label on the left,
      // buttons on the right).
      row.append(toggle, label, preview, actions);
      list.append(row);
    }

    body.replaceChildren(list);
    applyPreviewScroll();
    // The window auto-fits the tree (bounded by max-height): after the size
    // changes, keep a dragged position clamped inside the viewport (a
    // centered panel stays centered via the CSS transform).
    if (root.style.display !== 'none' && panelPos) {
      applyPosition(panelPos);
      requestAnimationFrame(() => {
        if (root.style.display !== 'none' && panelPos) applyPosition(panelPos);
      });
    }
  }

  /**
   * Secondary prune-confirmation panel.
   * Layout (per user spec): a small subtle confirm button on top, the
   * question in the middle, and a large red-white Cancel button at the
   * bottom. The destructive action stays deliberately understated while the
   * escape route (Cancel) is prominent.
   */
  function showPruneConfirm(branchId, fileName, parentId) {
    const overlay = document.createElement('div');
    overlay.className = 'stfloor-confirm-overlay';

    const panel = document.createElement('div');
    panel.className = 'stfloor-confirm-panel';
    // TauriTavern mobile: the overlay mask is a backdrop; the small centered
    // dialog explicitly opts out of host geometry (fullscreen-window would
    // force it to fill the safe frame).
    overlay.dataset.ttMobileSurface = 'backdrop';
    panel.dataset.ttMobileSurface = 'none';

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
    }

    // Step 1: subtle "确认删除" on top, question in the middle, big red
    // "取消" below. Step 2 (final): small "返回" on top, second question,
    // big red "最终删除" below - only this button performs the deletion.
    function renderStep(step) {
      if (step === 1) {
        panel.innerHTML = `
          <button class="stfloor-confirm-yes" title="确认删除该快照">确认删除</button>
          <div class="stfloor-confirm-text">是否确认删除 ${branchId}？</div>
          <button class="stfloor-confirm-cancel">取消</button>
        `;
        panel.querySelector('.stfloor-confirm-yes').addEventListener('click', () => renderStep(2));
        panel.querySelector('.stfloor-confirm-cancel').addEventListener('click', close);
      } else {
        panel.innerHTML = `
          <button class="stfloor-confirm-yes stfloor-confirm-yes-left" title="最终确认删除该快照（位置已移动，防止误触）">确认删除</button>
          <div class="stfloor-confirm-text">再次确认：删除 ${branchId} 后无法恢复，确定最终删除？</div>
          <button class="stfloor-confirm-cancel">取消</button>
        `;
        panel.querySelector('.stfloor-confirm-yes').addEventListener('click', () => {
          close();
          if (fileName) onDelete?.(branchId, fileName, parentId);
        });
        panel.querySelector('.stfloor-confirm-cancel').addEventListener('click', close);
      }
    }
    renderStep(1);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    overlay.append(panel);
    document.body.append(overlay);
  }

  /**
   * Composer for a new character (assistant) message floor. Lets the user
   * paste content that got stuck in the reasoning chain and add it as a
   * fresh editable char floor (ST keeps such messages non-editable).
   * Non-destructive, so the primary action (Add floor) is prominent.
   */
  function showComposer() {
    const overlay = document.createElement('div');
    overlay.className = 'stfloor-confirm-overlay';
    const panel = document.createElement('div');
    panel.className = 'stfloor-composer-panel';
    overlay.dataset.ttMobileSurface = 'backdrop';
    panel.dataset.ttMobileSurface = 'none';
    panel.innerHTML = `
      <div class="stfloor-composer-title">New character message</div>
      <textarea class="stfloor-composer-input" rows="6" placeholder="Paste the text that got stuck in thinking... (Ctrl+Enter to add, Esc to cancel)"></textarea>
      <div class="stfloor-composer-actions">
        <button class="stfloor-composer-cancel" type="button">Cancel</button>
        <button class="stfloor-composer-add" type="button" disabled>Add floor</button>
      </div>
    `;
    const input = panel.querySelector('.stfloor-composer-input');
    const addBtn = panel.querySelector('.stfloor-composer-add');
    const cancelBtn = panel.querySelector('.stfloor-composer-cancel');
    let busy = false;

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    async function confirmAdd() {
      const value = input.value.trim();
      if (!value || busy) return;
      busy = true;
      addBtn.disabled = true;
      addBtn.textContent = 'Adding...';
      try {
        await onAddMessage?.(value);
        close();
      } catch (error) {
        // Keep the composer open with the text so nothing is lost on failure.
        console.error('[Floor Anchor] failed to add character message:', error);
        busy = false;
        addBtn.disabled = false;
        addBtn.textContent = 'Add floor';
        cancelBtn.disabled = false;
      }
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        confirmAdd();
      }
    }

    input.addEventListener('input', () => {
      addBtn.disabled = input.value.trim().length === 0;
    });
    addBtn.addEventListener('click', confirmAdd);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    overlay.append(panel);
    document.body.append(overlay);
    input.focus();
  }

  function show() {
    markStMobileShell();
    root.style.display = 'flex';
    if (panelPos) {
      // Re-clamp a dragged position: the viewport may have changed while the
      // panel was hidden (rotation, resize, TauriTavern IME inset).
      applyPosition(panelPos);
    } else {
      centerPanel();
    }
    requestAnimationFrame(applyPreviewScroll);
    setTimeout(applyPreviewScroll, 150); // settle after layout/scrollbars
    console.log('[Floor Anchor] panel shown');
  }
  function hide() {
    root.style.display = 'none';
    console.log('[Floor Anchor] panel hidden');
  }
  function toggle() {
    if (root.style.display === 'none') show();
    else hide();
  }

  document.body.append(root);
  // ST mobile turns body into a fixed viewport shell; switch our floating UI
  // to absolute-in-body so it can never anchor to a zero-height fixed box.
  // Re-check on show (and once after load) because the mobile CSS can be
  // injected slightly later than our boot.
  function markStMobileShell() {
    try {
      if (getComputedStyle(document.body).position === 'fixed') {
        document.body.classList.add('stfloor-mobile-shell');
      }
    } catch {
      // Non-fatal.
    }
  }
  markStMobileShell();
  setTimeout(markStMobileShell, 1000);
  // Mobile-safe positioning on TauriTavern (no-op elsewhere). Fire-and-forget:
  // cleanup is only needed if the panel is ever torn down.
  void wireTauriMobileLayout(root);
  return { root, render, show, hide, toggle };
}
