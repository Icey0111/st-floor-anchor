/**
 * Register chat lifecycle handlers with an explicit preparation barrier.
 *
 * SillyTavern emits CHAT_LOADED followed by CHAT_CHANGED for one navigation.
 * CHAT_CHANGED must refresh only after CHAT_LOADED's storage preparation has
 * settled, otherwise a catalog scan can race an id/name migration.
 */
export function installChatEventHandlers({
  eventSource,
  eventTypes,
  readActiveSnapshotFileName,
  setActiveSnapshotFileName,
  prepareCurrentChatStorage,
  refreshPanel,
  onPreparationError = () => {},
  onRefreshError = () => {},
} = {}) {
  if (!eventSource?.on || !eventTypes?.CHAT_LOADED || !eventTypes?.CHAT_CHANGED) {
    throw new TypeError('chat event source and event types are required');
  }

  let preparationTail = Promise.resolve();

  function syncActiveSnapshot() {
    setActiveSnapshotFileName?.(readActiveSnapshotFileName?.() ?? null);
  }

  async function onChatLoaded() {
    syncActiveSnapshot();
    preparationTail = preparationTail
      .then(() => prepareCurrentChatStorage?.())
      .catch((error) => {
        onPreparationError(error);
      });
    await preparationTail;
    return refreshPanel?.();
  }

  function onChatChanged() {
    syncActiveSnapshot();
    const refresh = preparationTail.then(() => refreshPanel?.());
    void refresh.catch((error) => {
      onRefreshError(error);
    });
    return refresh;
  }

  eventSource.on(eventTypes.CHAT_LOADED, onChatLoaded);
  eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);

  return { onChatLoaded, onChatChanged };
}
