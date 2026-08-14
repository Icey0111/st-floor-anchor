export const extension_settings = {};

export function saveMetadataDebounced() {
  // The host-facing tests assert durable API calls, not ST's debounce timer.
}

export function resetExtensionSettings() {
  for (const key of Object.keys(extension_settings)) delete extension_settings[key];
}
