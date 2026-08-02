/**
 * Snapshot-before-mutation hooks.
 *
 * ST (1.18.0) binds its own message actions via jQuery bubble-phase delegated
 * handlers (e.g. $(document).on('click', '.last_mes .swipe_right', ...)).
 * We attach native CAPTURE-phase listeners, which run BEFORE those handlers,
 * and clone `chat` synchronously so the snapshot reflects the pre-mutation
 * state even though the async save happens later.
 */
import { chat, getCurrentChatId } from '/script.js';
import { createSnapshotDedupe } from '../store/helpers.js';

export function installHooks({ createSnapshot, onSnapshot = () => {} } = {}) {
  if (typeof document === 'undefined') return;
  const isDupe = createSnapshotDedupe(400);

  function fire(reason, sourceFloor = null) {
    const chatId = getCurrentChatId() ?? 'none';
    console.log(`[Floor Anchor] snapshot trigger: ${reason} (chat=${chatId}, floor=${sourceFloor})`);
    if (isDupe(chatId, reason)) {
      console.log('[Floor Anchor] ...skipped (dedupe)');
      return;
    }
    if (!Array.isArray(chat) || chat.length === 0) {
      console.log('[Floor Anchor] ...skipped (empty chat)');
      return;
    }
    const capturedChat = structuredClone(chat); // synchronous pre-mutation clone
    createSnapshot({ reason, sourceFloor, capturedChat })
      .then((result) => {
        if (result?.skipped) {
          console.log(`[Floor Anchor] ...skipped (${result.reason})`);
          return;
        }
        if (result) onSnapshot(result);
      })
      .catch((error) => console.error('[Floor Anchor] snapshot failed:', error));
  }

  function onCaptureClick(selector, reason) {
    document.addEventListener('click', (event) => {
      const target = event.target.closest(selector);
      if (!target) return;
      const mes = target.closest('.mes');
      const floor = mes && Number.isInteger(Number(mes.getAttribute('mesid')))
        ? Number(mes.getAttribute('mesid')) + 1
        : null;
      fire(reason, floor);
    }, true);
  }

  // Roll entry points: swipe arrows on the last message, the "regenerate"
  // button, and the swipe picker.
  onCaptureClick('.last_mes .swipe_left, .last_mes .swipe_right, #option_regenerate, .mes_swipe_picker', 'roll');
  // Edit entry (pencil). Snapshot at edit START covers all commit paths
  // (done button, Ctrl+Enter, auto-save).
  onCaptureClick('.mes_edit', 'edit');
  // Delete (edit-mode delete button).
  onCaptureClick('.mes_edit_delete', 'delete');

  // Delete-mode confirm: "..." menu -> Delete message -> select a floor -> OK.
  // ST binds `#dialogue_del_mes_ok` in the bubble phase and truncates `chat`
  // synchronously (chat.length = this_del_mes), so the capture-phase listener
  // below clones the chat while it is still intact. Guard: only snapshot when
  // a message is actually selected (checked checkbox); OK with no selection
  // deletes nothing and would otherwise create a spurious snapshot.
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#dialogue_del_mes_ok')) return;
    const checked = document.querySelector('#chat .del_checkbox:checked');
    if (!checked) return;
    const selected = checked.closest('.mes');
    const floor = selected && Number.isInteger(Number(selected.getAttribute('mesid')))
      ? Number(selected.getAttribute('mesid')) + 1
      : null;
    fire('delete', floor);
  }, true);

  // Keyboard swipes (ArrowLeft/ArrowRight hotkeys) do not go through clicks.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const textarea = document.querySelector('#send_textarea');
    if (!textarea) return;
    if (textarea.value.trim().length > 0) return;
    const editorVisible = document.querySelector('.mes_edit_buttons')?.style?.display === 'inline-flex';
    if (editorVisible) return;
    fire('roll');
  }, true);
}
