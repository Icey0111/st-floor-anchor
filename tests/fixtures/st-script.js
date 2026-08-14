export const chat = [];
export const chat_metadata = {};
export const characters = [];
export let this_chid = 0;

export const hostState = {
  currentChatId: 'root',
  saveChatImpl: async () => {},
  openCharacterChatImpl: async () => {},
  addOneMessageImpl: () => {},
  metadataSaveCount: 0,
  settingsSaveCount: 0,
  characterSaveCount: 0,
};

export function resetHostState({ avatar = 'avatar.png', chatId = 'root' } = {}) {
  chat.splice(0);
  for (const key of Object.keys(chat_metadata)) delete chat_metadata[key];
  characters.splice(0, characters.length, {
    name: 'Test Character',
    avatar,
    chat: chatId,
  });
  this_chid = 0;
  hostState.currentChatId = chatId;
  hostState.saveChatImpl = async () => {};
  hostState.openCharacterChatImpl = async () => {};
  hostState.addOneMessageImpl = () => {};
  hostState.metadataSaveCount = 0;
  hostState.settingsSaveCount = 0;
  hostState.characterSaveCount = 0;
}

export function getRequestHeaders() {
  return { 'Content-Type': 'application/json' };
}

export function getCurrentChatDetails() {
  return { sessionName: hostState.currentChatId };
}

export function getCurrentChatId() {
  return hostState.currentChatId;
}

export function saveChat(options) {
  return hostState.saveChatImpl(options);
}

export function openCharacterChat(fileName) {
  return hostState.openCharacterChatImpl(fileName);
}

export function addOneMessage(message) {
  return hostState.addOneMessageImpl(message);
}

export function saveCharacterDebounced() {
  hostState.characterSaveCount += 1;
}

export function saveSettingsDebounced() {
  hostState.settingsSaveCount += 1;
}

resetHostState();
